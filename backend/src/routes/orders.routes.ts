import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import { asyncHandler } from "../middleware/error-handler";
import { requireAuth, requireRole } from "../middleware/auth";
import { createOrder, updateOrderStatus, markOrderPaid, cancelOrder } from "../services/order.service";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const listQuerySchema = z.object({
  status: z.enum(["diterima", "diproses", "siap", "selesai"]).optional(),
  source: z.enum(["self_order", "pos"]).optional(),
  paymentStatus: z.enum(["pending", "paid", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// GET /api/orders — feed order Frontoffice, bisa difilter
ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const orders = await prisma.order.findMany({
      where: {
        businessId: req.auth!.businessId,
        status: query.status,
        source: query.source,
        paymentStatus: query.paymentStatus,
      },
      include: { items: true, payments: true, table: true },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });
    res.json(orders);
  })
);

// GET /api/orders/:id
ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const order = await prisma.order.findFirst({
      where: { id, businessId: req.auth!.businessId },
      include: { items: true, payments: true, statusLogs: true, table: true },
    });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    res.json(order);
  })
);

const createManualOrderSchema = z.object({
  clientOrderId: z.string().min(1).optional(),
  tableId: z.number().int().optional().nullable(),
  customerName: z.string().optional(),
  paymentMethod: z.enum(["cash", "qris", "bank_transfer"]),
  selectedBank: z.enum(["bca", "mandiri", "bni", "bri"]).optional(),
  // recordOnly: pencatatan kasir murni — lewati DOKU untuk SEMUA metode,
  // payment pending (dilunasi via Tandai Lunas), gateway "manual".
  recordOnly: z.boolean().optional().default(false),
  // Uang diterima (cash). Kembalian dihitung server & disimpan di gatewayData.
  tendered: z.coerce.number().min(0).optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        quantity: z.number().int().min(1),
        selectedOptionIds: z.array(z.number().int()).optional(),
      })
    )
    .min(1),
});

// POST /api/orders — input pesanan manual oleh kasir/barista (Frontoffice)
ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createManualOrderSchema.parse(req.body);

    const order = await createOrder({
      businessId: req.auth!.businessId,
      clientOrderId: data.clientOrderId ?? crypto.randomUUID(),
      tableId: data.tableId ?? null,
      userId: req.auth!.userId,
      customerName: data.customerName ?? null,
      source: "pos",
      paymentMethod: data.paymentMethod,
      items: data.items,
    });

    // Mode kasir record-only: tanpa DOKU, simpan tendered/change, tetap pending.
    if (data.recordOnly) {
      const total = Number(order.total);
      if (data.paymentMethod === "cash" && data.tendered !== undefined && data.tendered < total) {
        // Batalkan order yang baru dibuat agar tidak ada transaksi gantung
        await prisma.order.delete({ where: { id: order.id } });
        throw AppError.badRequest("Uang diterima kurang dari total");
      }
      const change = data.tendered !== undefined ? Math.max(0, data.tendered - total) : undefined;
      await prisma.payment.updateMany({
        where: { orderId: order.id },
        data: {
          gateway: "manual",
          gatewayData: { recordOnly: true, tendered: data.tendered ?? null, change: change ?? null } as unknown as object,
        },
      });
      const recorded = await prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true, payments: true, statusLogs: true, table: true },
      });
      return res.status(201).json(recorded ?? order);
    }

    // Sama seperti public: non-cash SELALU via DOKU SNAP (global)
    if ((data.paymentMethod as string) !== "cash") {
      try {
        const { createDokuChargeForMethod } = await import("../services/doku.service");
        const charge = await createDokuChargeForMethod({
          method: data.paymentMethod as "qris" | "bank_transfer",
          orderNumber: order.orderNumber,
          grossAmount: Number(order.total),
          customerName: data.customerName ?? undefined,
          selectedBank: (data as { selectedBank?: string }).selectedBank,
        });
        if (charge) {
          await prisma.payment.updateMany({ where: { orderId: order.id }, data: { gateway: "doku", reference: charge.referenceNo ?? charge.partnerReferenceNo, gatewayData: charge as unknown as object } });
          const refreshed = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, payments: true, statusLogs: true, table: true } });
          if (refreshed) return res.status(201).json(refreshed);
        }
      } catch (e) {
        console.error("[DOKU manual charge] gagal:", e);
      }
    }

    res.status(201).json(order);
  })
);

const statusSchema = z.object({ status: z.enum(["diterima", "diproses", "siap", "selesai", "batal"]) });

// PATCH /api/orders/:id/status
ordersRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { status } = statusSchema.parse(req.body);
    const updated = await updateOrderStatus(req.auth!.businessId, id, status);
    res.json(updated);
  })
);

const paySchema = z.object({
  method: z.enum(["cash", "qris", "bank_transfer"]).optional(),
  reference: z.string().optional(),
});

// PATCH /api/orders/:id/cancel — batalkan order belum lunas (otomatis masuk riwayat)
ordersRouter.patch(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const updated = await cancelOrder(req.auth!.businessId, id);
    res.json(updated);
  })
);

// PATCH /api/orders/:id/pay — hanya owner/kasir; non-cash wajib lewat DOKU webhook/polling
ordersRouter.patch(
  "/:id/pay",
  requireRole("owner", "kasir"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = paySchema.parse(req.body);
    const updated = await markOrderPaid(req.auth!.businessId, id, data);
    res.json(updated);
  })
);
