import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import { calculateOrderTotals } from "../lib/order-calc";
import { calcPlatformFee, estimateMdrFee } from "../lib/platform-fee";
import { FEATURES, getBusinessFeatures, isFeatureOn } from "../lib/feature-gate";
import { nextOrderNumber } from "./order-number.service";
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

export async function createOrder(input: CreateOrderInput) {
  // Idempotency: kalau client_order_id sudah pernah dikirim (retry offline sync),
  // kembalikan order yang sudah ada, jangan buat transaksi kedua.
  const existing = await prisma.order.findUnique({
    where: { clientOrderId: input.clientOrderId },
    include: buildOrderInclude(),
  });
  if (existing) return existing;

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
  if (enabled && !enabled.includes(input.paymentMethod)) {
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
  const mdrFee = estimateMdrFee(totals.total, input.paymentMethod).fee;

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
            },
          },
        },
        include: buildOrderInclude(),
      });

      emitNewOrder(business.id, order);
      return order;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
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
  const order = await prisma.order.findFirst({ where: { id: orderId, businessId } });
  if (!order) throw AppError.notFound("Order tidak ditemukan");
  if (order.status === "batal") throw AppError.badRequest("Order sudah dibatalkan");
  if (order.status === "selesai") throw AppError.badRequest("Order yang sudah selesai tidak bisa dibatalkan");
  if (order.paymentStatus === "paid") {
    throw AppError.badRequest("Order yang sudah lunas tidak bisa dibatalkan");
  }
  return updateOrderStatus(businessId, orderId, "batal");
}

export async function markOrderPaid(
  businessId: number,
  orderId: number,
  input: { method?: PaymentMethodInput; reference?: string },
  opts?: { allowNonCash?: boolean }
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: { payments: true },
  });
  if (!order) throw AppError.notFound("Order tidak ditemukan");
  if (order.paymentStatus === "paid") {
    throw AppError.conflict("Order ini sudah lunas");
  }
  if (order.paymentMethod !== "cash" && !opts?.allowNonCash) {
    throw AppError.badRequest(
      "Pembayaran non-tunai (qris/bank_transfer) hanya bisa dilunasi via DOKU (webhook /public/doku/notification atau poll /public/orders/by-client/:clientOrderId/status), bukan manual."
    );
  }

  const paidAt = new Date();
  const method = input.method ?? (order.paymentMethod as PaymentMethodInput);

  const [updatedOrder] = await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus: "paid" },
      include: buildOrderInclude(),
    }),
    order.payments[0]
      ? prisma.payment.update({
          where: { id: order.payments[0].id },
          data: { status: "paid", method, reference: input.reference, paidAt },
        })
      : prisma.payment.create({
          data: {
            businessId,
            orderId,
            method,
            status: "paid",
            amount: order.total,
            reference: input.reference,
            paidAt,
          },
        }),
  ]);

  emitOrderPaymentUpdate(businessId, updatedOrder);
  return updatedOrder;
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
