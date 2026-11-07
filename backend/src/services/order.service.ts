import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import { calculateOrderTotals } from "../lib/order-calc";
import { calcPlatformFee, estimateMdrFee } from "../lib/platform-fee";
import { FEATURES, getBusinessFeatures, isFeatureOn } from "../lib/feature-gate";
import { nextOrderNumber } from "./order-number.service";
import { expireDokuQris } from "./doku.service";
import { creditOrderInflow } from "./wallet.service";
import {
  emitNewOrder,
  emitOrderStatusUpdate,
  emitOrderPaymentUpdate,
} from "../lib/realtime";

export interface CreateOrderItemInput {
  productId: number;
  quantity: number;
  selectedOptionIds?: number[];
}

export type PaymentMethodInput = "cash" | "qris" | "bank_transfer";

export interface CreateOrderInput {
  businessId: number;
  clientOrderId: string; // idempotency key dari client (self-order / offline POS)
  tableId?: number | null;
  userId?: number | null; // staff yang input (untuk order manual dari POS)
  customerName?: string | null;
  source: "self_order" | "pos";
  paymentMethod: PaymentMethodInput;
  items: CreateOrderItemInput[];
}

function parseEnabledMethods(business: { enabledPaymentMethods?: unknown }): string[] | null {
  const raw = (business as unknown as { enabledPaymentMethods?: unknown }).enabledPaymentMethods;
  if (raw == null) return null; // kolom belum ada (belum migrate) -> skip validasi
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {}
  }
  return null;
}

const MAX_ORDER_NUMBER_RETRY = 5;

function checkoutFingerprint(input: CreateOrderInput) {
  const items = input.items.map((item) => ({ productId: item.productId, quantity: item.quantity, options: [...(item.selectedOptionIds ?? [])].sort((a, b) => a - b) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return crypto.createHash("sha256").update(JSON.stringify({ businessId: input.businessId, tableId: input.tableId ?? null, source: input.source, customerName: input.customerName ?? null, method: input.paymentMethod, items })).digest("hex");
}

function assertCheckoutReplay(order: { businessId: number; tableId: number | null; paymentMethod: string; source: string; payments: Array<{ gatewayData: unknown }> }, input: CreateOrderInput) {
  const data = order.payments[0]?.gatewayData as Record<string, unknown> | null;
  if (order.businessId !== input.businessId || order.tableId !== (input.tableId ?? null) || order.paymentMethod !== input.paymentMethod || order.source !== input.source || (typeof data?.checkoutFingerprint === "string" && data.checkoutFingerprint !== checkoutFingerprint(input))) {
    throw AppError.conflict("Referensi order sudah digunakan untuk checkout lain");
  }
}

export async function createOrder(input: CreateOrderInput) {
  if (input.source === "self_order" && !["cash", "qris"].includes(input.paymentMethod)) {
    throw AppError.badRequest("Self-Order hanya menerima tunai dan QRIS");
  }
  // Idempotency: kalau client_order_id sudah pernah dikirim (retry offline sync),
  // kembalikan order yang sudah ada, jangan buat transaksi kedua.
  const existing = await prisma.order.findUnique({
    where: { clientOrderId: input.clientOrderId },
    include: buildOrderInclude(),
  });
  if (existing) {
    assertCheckoutReplay(existing, input);
    return existing;
  }

  if (!input.items.length) {
    throw AppError.badRequest("Order harus memiliki minimal 1 item");
  }

  const business = await prisma.business.findUnique({ where: { id: input.businessId } });
  if (!business) throw AppError.notFound("Bisnis tidak ditemukan");

  // Flag granular Pajak & Biaya: taxFees OFF = paksa pajak NOL,
  // serviceCharge OFF = paksa service charge NOL di order baru.
  // Resolve via plans + overrides (+ alias legacy taxAndFees); fallback OFF bila gagal (fail-closed).
  // Memakai isFeatureOn (Context7: plans.featureFlags adalah Jsonirman — merge di getBusinessFeatures).
  let taxOn = false;
  let svcOn = false;
  try {
    const { flags } = await getBusinessFeatures(input.businessId);
    taxOn = isFeatureOn(flags, FEATURES.TAX_FEES);
    svcOn = isFeatureOn(flags, FEATURES.SERVICE_CHARGE);
  } catch {
    taxOn = false;
    svcOn = false;
  }

  const enabled = parseEnabledMethods(business);
  if (input.source === "self_order" && enabled && !enabled.includes(input.paymentMethod)) {
    throw AppError.badRequest(`Metode pembayaran "${input.paymentMethod}" tidak aktif untuk bisnis ini`);
  }

  if (input.tableId) {
    const table = await prisma.cafeTable.findFirst({
      where: { id: input.tableId, businessId: input.businessId },
    });
    if (!table) throw AppError.badRequest("Meja tidak valid untuk bisnis ini");
  }

  // Ambil semua produk + opsi yang relevan sekaligus (hindari N+1 query)
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, businessId: input.businessId },
    include: { options: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  const itemsToCreate: Prisma.OrderItemCreateManyOrderInput[] = [];

  for (const line of input.items) {
    const product = productMap.get(line.productId);
    if (!product) {
      throw AppError.badRequest(`Produk id=${line.productId} tidak ditemukan di bisnis ini`);
    }
    if (!product.isAvailable) {
      throw AppError.badRequest(`Produk "${product.name}" sedang Out of Stock`);
    }
    if (line.quantity < 1) {
      throw AppError.badRequest("Quantity item minimal 1");
    }

    const selectedOptions = (line.selectedOptionIds ?? []).map((optId) => {
      const opt = product.options.find((o) => o.id === optId && o.isActive);
      if (!opt) {
        throw AppError.badRequest(
          `Opsi id=${optId} tidak valid untuk produk "${product.name}"`
        );
      }
      return opt;
    });

    const optionsPriceAdd = selectedOptions.reduce((sum, o) => sum + Number(o.price), 0);
    const unitPrice = Number(product.price) + optionsPriceAdd;
    const itemSubtotal = round2(unitPrice * line.quantity);
    subtotal += itemSubtotal;

    const optionsJson: Record<string, string> = {};
    for (const o of selectedOptions) optionsJson[o.type] = o.name;

    itemsToCreate.push({
      productId: product.id,
      productName: product.name,
      price: unitPrice,
      quantity: line.quantity,
      options: optionsJson,
      optionsLabel: selectedOptions.map((o) => o.name).join(", "),
      subtotal: itemSubtotal,
    });
  }

  // Platform fee: hanya self_order non-tunai, config per kafe dari Platform Admin.
  // Cash & manual order (source pos) selalu 0.
  const { platformFee, platformFeeBearer } = calcPlatformFee(subtotal, {
    platformFeeEnabled: business.platformFeeEnabled,
    platformFeeMode: business.platformFeeMode,
    platformFeePercent: Number(business.platformFeePercent),
    platformFeeFlat: Number(business.platformFeeFlat),
    platformFeeBearer: business.platformFeeBearer,
  }, { source: input.source, paymentMethod: input.paymentMethod });

  const totals = calculateOrderTotals(subtotal, {
    // Flag granular OFF (default) = paksa komponen NOL agar total murni untuk komponen itu.
    // Menang atas nilai DB (data lama yang masih true tetap diabaikan untuk order baru).
    taxEnabled: taxOn ? business.taxEnabled : false,
    taxRate: taxOn ? Number(business.taxRate) : 0,
    taxLabel: business.taxLabel,
    taxBearer: business.taxBearer,
    serviceChargeEnabled: svcOn ? business.serviceChargeEnabled : false,
    serviceChargeRate: Number(business.serviceChargeRate),
    serviceChargeMode: business.serviceChargeMode,
    serviceChargeFlat: Number(business.serviceChargeFlat),
    platformFee,
    platformFeeBearer,
  });

  // Estimasi MDR dari gross yang di-charge (snapshot; label "estimasi" di UI).
  const mdrFee = input.source === "self_order" && input.paymentMethod === "qris"
    ? estimateMdrFee(totals.total, "qris").fee
    : 0;

  // Retry kalau order_number bentrok karena race condition antar request paralel.
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_RETRY; attempt++) {
    const orderNumber = await nextOrderNumber(business.id, business.name, attempt);
    try {
      const order = await prisma.order.create({
        data: {
          businessId: business.id,
          orderNumber,
          clientOrderId: input.clientOrderId,
          tableId: input.tableId ?? null,
          userId: input.userId ?? null,
          customerName: input.customerName ?? null,
          source: input.source,
          status: "diterima",
          paymentMethod: input.paymentMethod,
          paymentStatus: "pending",
          subtotal: totals.subtotal,
          serviceCharge: totals.serviceCharge,
          tax: totals.tax,
          taxLabel: totals.taxLabel,
          taxBearer: totals.taxBearer,
          platformFee: totals.platformFee,
          platformFeeBearer: totals.platformFeeBearer,
          mdrFee,
          total: totals.total,
          syncStatus: "synced",
          items: { createMany: { data: itemsToCreate } },
          statusLogs: { create: { status: "diterima" } },
          payments: {
            create: {
              businessId: business.id,
              method: input.paymentMethod,
              status: "pending",
              amount: totals.total,
              gatewayData: { checkoutFingerprint: checkoutFingerprint(input) },
            },
          },
        },
        include: buildOrderInclude(),
      });

      emitNewOrder(business.id, order);
      return order;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const replay = await prisma.order.findUnique({ where: { clientOrderId: input.clientOrderId }, include: buildOrderInclude() });
        if (replay) {
          assertCheckoutReplay(replay, input);
          return replay;
        }
        lastError = err;
        continue; // order_number atau client_order_id bentrok, coba nomor berikutnya
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : AppError.conflict("Gagal membuat nomor order unik");
}

const VALID_STATUSES = ["diterima", "diproses", "siap", "selesai", "batal"] as const;

export async function updateOrderStatus(
  businessId: number,
  orderId: number,
  status: string
) {
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw AppError.badRequest(`Status harus salah satu dari: ${VALID_STATUSES.join(", ")}`);
  }
  if (status === "batal") return cancelOrder(businessId, orderId);

  const order = await prisma.order.findFirst({ where: { id: orderId, businessId } });
  if (!order) throw AppError.notFound("Order tidak ditemukan");
  // Order batal bersifat final — tidak bisa dihidupkan kembali ke alur normal.
  if (order.status === "batal" && status !== "batal") {
    throw AppError.badRequest("Order yang dibatalkan tidak bisa diubah statusnya lagi");
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status,
      statusLogs: { create: { status } },
    },
    include: buildOrderInclude(),
  });

  emitOrderStatusUpdate(businessId, updated);
  return updated;
}

// Batalkan order (kasir/barista/owner). Hanya untuk order yang belum lunas &
// belum selesai — pembayaran yang sudah masuk tidak bisa dibatalkan dari sini
// (refund manual di luar sistem). Dipakai tombol Batal POS + auto-batal saat
// pembayaran gateway gagal/expired.
export async function cancelOrder(businessId: number, orderId: number) {
  const cancelled = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id: orderId, businessId }, include: { payments: true } });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    if (order.paymentStatus === "paid") throw AppError.badRequest("Order yang sudah lunas tidak bisa dibatalkan");
    if (["batal", "selesai"].includes(order.status)) throw AppError.badRequest("Order sudah selesai atau dibatalkan");
    for (const payment of order.payments) await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`;
    await tx.payment.updateMany({ where: { orderId, status: { not: "paid" } }, data: { status: "canceled" } });
    await tx.paymentAttempt.updateMany({ where: { paymentId: { in: order.payments.map((payment) => payment.id) }, status: { in: ["creating", "pending", "unknown"] } }, data: { status: "canceled" } });
    return tx.order.update({ where: { id: orderId }, data: { status: "batal", paymentStatus: "canceled", statusLogs: { create: { status: "batal" } } }, include: buildOrderInclude() });
  });
  // Gateway cancellation is outside the DB transaction; a late success is retained for review.
  for (const payment of cancelled.payments) {
    const gd = payment.gatewayData as Record<string, unknown> | null;
    if (payment.gateway === "doku" && payment.method === "qris" && typeof gd?.partnerReferenceNo === "string") {
      try { await expireDokuQris({ partnerReferenceNo: gd.partnerReferenceNo, referenceNo: typeof gd.referenceNo === "string" ? gd.referenceNo : undefined, reason: "Order canceled" }); }
      catch (error) { console.warn("[cancelOrder] DOKU cancellation requires follow-up", error); }
    }
  }
  emitOrderStatusUpdate(businessId, cancelled);
  emitOrderPaymentUpdate(businessId, cancelled);
  return cancelled;
}

export async function markOrderPaid(
  businessId: number,
  orderId: number,
  input: { method?: PaymentMethodInput; reference?: string },
  opts?: { allowNonCash?: boolean; tx?: Prisma.TransactionClient }
) {
  const transition = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id: orderId, businessId }, include: { payments: true } });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    if (order.paymentStatus === "paid") return tx.order.findUnique({ where: { id: orderId }, include: buildOrderInclude() });
    if (order.paymentStatus === "canceled" || order.status === "batal") throw AppError.badRequest("Order ini sudah dibatalkan; perlu rekonsiliasi pembayaran");
    const payment = order.payments[0];
    if (payment) await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`;
    if (order.paymentMethod !== "cash" && !opts?.allowNonCash && payment?.gateway !== "manual" && order.source !== "pos") {
      throw AppError.badRequest("Pembayaran QRIS gateway hanya dapat dilunasi melalui DOKU");
    }
    const changed = await tx.order.updateMany({ where: { id: orderId, businessId, paymentStatus: { not: "paid" }, status: { not: "batal" } }, data: { paymentStatus: "paid" } });
    if (!changed.count) throw AppError.conflict("Status pembayaran berubah");
    const data = { status: "paid", method: input.method ?? order.paymentMethod, reference: input.reference, paidAt: new Date() };
    payment
      ? await tx.payment.update({ where: { id: payment.id }, data })
      : await tx.payment.create({ data: { ...data, orderId, businessId, amount: order.total, gateway: "manual" } });
    if (payment?.gateway === "doku") {
      const gross = Number(order.total);
      await creditOrderInflow({
        businessId, paymentId: payment.id,
        netAmount: Math.max(0, gross - Number(order.platformFee ?? 0) - Number(order.mdrFee ?? 0)),
        orderNumber: order.orderNumber,
        description: `Pendapatan QRIS pesanan #${order.orderNumber}`,
      }, tx);
    }
    return tx.order.findUnique({ where: { id: orderId }, include: buildOrderInclude() });
  };
  const updated = opts?.tx ? await transition(opts.tx) : await prisma.$transaction(transition);
  if (!opts?.tx && updated) emitOrderPaymentUpdate(businessId, updated);
  return updated;
}

function buildOrderInclude() {
  return {
    items: true,
    payments: true,
    statusLogs: { orderBy: { createdAt: "asc" as const } },
    table: true,
  } satisfies Prisma.OrderInclude;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
