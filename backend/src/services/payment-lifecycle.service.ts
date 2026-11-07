import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import { createDokuChargeForMethod, getDokuQrisStatus, makeDokuInvoiceId, normalizeDokuStatus, verifyDokuNotification } from "./doku.service";
import { markOrderPaid } from "./order.service";
import { emitOrderPaymentUpdate } from "../lib/realtime";

export function matchesQrisPayment(raw: Record<string, unknown>, attempt: { partnerReferenceNo: string; amount: unknown }): boolean {
  const ref = raw.originalPartnerReferenceNo ?? raw.partnerReferenceNo;
  const amount = (raw.amount ?? raw.paidAmount) as { value?: unknown; currency?: unknown } | undefined;
  const value = String(amount?.value ?? "");
  return ref === attempt.partnerReferenceNo && amount?.currency === "IDR" && /^\d+(?:\.0{1,2})?$/.test(value) && Number(value) === Number(attempt.amount);
}

export async function ensureQrisCharge(orderId: number) {
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true } });
    if (!order || order.paymentMethod !== "qris" || order.source !== "self_order") throw AppError.badRequest("Order bukan QRIS Self-Order");
    if (order.paymentStatus !== "pending" || order.status === "batal") return null;
    const payment = order.payments[0];
    if (!payment) throw AppError.conflict("Pembayaran tidak ditemukan");
    // Any persisted attempt may already exist at DOKU, including an HTTP timeout.
    const existing = await tx.paymentAttempt.findFirst({ where: { paymentId: payment.id }, orderBy: { id: "desc" } });
    if (existing && !(existing.status === "failed" && existing.error?.startsWith("NOT_SUBMITTED:"))) return null;
    const prior = payment.gatewayData as Record<string, unknown> | null;
    const historicalRef = !existing && typeof prior?.partnerReferenceNo === "string" ? prior.partnerReferenceNo : undefined;
    const attempt = await tx.paymentAttempt.create({ data: { paymentId: payment.id, partnerReferenceNo: historicalRef ?? makeDokuInvoiceId(order.orderNumber), amount: order.total, status: historicalRef ? "unknown" : "creating" } });
    await tx.payment.update({ where: { id: payment.id }, data: { gateway: "doku", gatewayData: { ...(prior ?? {}), partnerReferenceNo: attempt.partnerReferenceNo, chargeAttemptStatus: historicalRef ? "unknown" : "creating" } as Prisma.InputJsonValue } });
    return historicalRef ? null : { order, attempt, payment };
  });
  if (reserved) {
    const { order, attempt, payment } = reserved;
    let notSubmitted = false;
    try {
      const charge = await createDokuChargeForMethod({ method: "qris", orderNumber: order.orderNumber, grossAmount: Number(attempt.amount), invoiceId: attempt.partnerReferenceNo });
      if (!charge) { notSubmitted = true; throw new Error("NOT_SUBMITTED: QRIS request not sent; credentials/token unavailable"); }
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        const metadata = current.gatewayData as Record<string, unknown> | null;
        await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: { in: ["creating", "unknown"] } }, data: { status: "pending", response: charge as unknown as Prisma.InputJsonValue } });
        await tx.payment.update({ where: { id: payment.id }, data: { reference: current.reference ?? charge.referenceNo ?? charge.partnerReferenceNo, gatewayData: { ...charge, ...(metadata ?? {}), qrContent: charge.qrContent, chargeAttemptStatus: current.status === "pending" ? "pending" : current.status, chargeMessage: null } as unknown as Prisma.InputJsonValue } });
      });
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
        const changed = await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: "creating" }, data: { status: notSubmitted ? "failed" : "unknown", error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) } });
        if (changed.count !== 0) {
          const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
          await tx.payment.update({ where: { id: payment.id }, data: { gatewayData: { ...((current.gatewayData ?? {}) as Record<string, unknown>), chargeAttemptStatus: notSubmitted ? "not_submitted" : "unknown", chargeMessage: notSubmitted ? "QRIS belum dikirim. Coba lagi setelah layanan pembayaran tersedia." : "Status QRIS sedang diperiksa. Jangan membuat pembayaran baru; hubungi kasir." } as Prisma.InputJsonValue } });
        }
      });
    }
  }
  return prisma.order.findUnique({ where: { id: orderId }, include: { items: true, payments: true, statusLogs: true, table: true } });
}

export async function storeDokuNotification(body: Record<string, unknown>, headers: Record<string, string | string[] | undefined>) {
  const h = (key: string) => String(headers[key] ?? "");
  const signature = h("x-signature"), timestamp = h("x-timestamp");
  const authorization = h("authorization");
  if (!signature || !timestamp || !verifyDokuNotification({ httpMethod: "POST", endpointPath: "/api/public/doku/notification", accessToken: authorization.replace(/^Bearer /, ""), body, signature, timestamp })) throw AppError.unauthorized("Signature DOKU tidak valid");
  const eventKey = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  // Do not retain authorization tokens or signatures in the durable inbox.
  return prisma.paymentNotification.upsert({ where: { eventKey }, update: {}, create: { eventKey, payload: body as Prisma.InputJsonValue, headers: { timestamp, externalId: h("x-external-id") } } });
}

export async function applyQrisStatus(attemptId: number, raw: Record<string, unknown>) {
  const result = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { payment: true } });
    if (!snapshot) throw new Error("Referensi pembayaran belum ditemukan");
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${snapshot.payment.orderId} FOR UPDATE`;
    const attempt = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { payment: { include: { order: true } } } });
    const { payment } = attempt, { order } = payment;
    const status = normalizeDokuStatus(raw);
    if (status === "review" || (status === "paid" && (!matchesQrisPayment(raw, attempt) || order.status === "batal" || order.paymentStatus === "canceled"))) {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "review", response: raw as Prisma.InputJsonValue } });
      await tx.payment.update({ where: { id: payment.id }, data: { reviewReason: status === "review" ? "Gateway reports refund; reconcile manually" : "Late or mismatched QRIS payment; reconcile manually" } });
      return null;
    }
    if (status === "paid") {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "paid", response: raw as Prisma.InputJsonValue } });
      return markOrderPaid(order.businessId, order.id, { reference: String(raw.originalReferenceNo ?? raw.referenceNo ?? attempt.partnerReferenceNo) }, { allowNonCash: true, tx });
    }
    // A terminal gateway failure may never overwrite money already received.
    if (status === "failed" && matchesQrisPayment(raw, attempt) && order.paymentStatus !== "paid" && attempt.status !== "paid") {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "failed", response: raw as Prisma.InputJsonValue } });
      await tx.order.updateMany({ where: { id: order.id, paymentStatus: "pending" }, data: { paymentStatus: "failed" } });
      await tx.payment.updateMany({ where: { id: payment.id, status: "pending" }, data: { status: "failed" } });
    }
    return null;
  });
  if (result) emitOrderPaymentUpdate(result.businessId, result);
  return result;
}

export async function pollQrisOrder(orderId: number) {
  const payment = await prisma.payment.findFirst({ where: { orderId, gateway: "doku", method: "qris" } });
  if (!payment) return null;
  let attempts = await prisma.paymentAttempt.findMany({ where: { paymentId: payment.id } });
  if (!attempts.length) {
    const gd = payment.gatewayData as Record<string, unknown> | null;
    if (typeof gd?.partnerReferenceNo === "string") {
      await prisma.paymentAttempt.upsert({ where: { partnerReferenceNo: gd.partnerReferenceNo }, update: {}, create: { paymentId: payment.id, partnerReferenceNo: gd.partnerReferenceNo, amount: payment.amount, status: "unknown" } });
      attempts = await prisma.paymentAttempt.findMany({ where: { paymentId: payment.id } });
    }
  }
  let latest: Record<string, unknown> | null = null;
  for (const attempt of attempts) {
    if (attempt.status === "paid" || attempt.status === "review" || attempt.status === "failed") continue;
    const response = attempt.response as Record<string, unknown> | null;
    try {
      const raw = await getDokuQrisStatus({ partnerReferenceNo: attempt.partnerReferenceNo, referenceNo: typeof response?.referenceNo === "string" ? response.referenceNo : undefined });
      if (raw) { await applyQrisStatus(attempt.id, raw); latest = raw; }
    } finally {
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { updatedAt: new Date() } });
    }
  }
  return latest;
}
