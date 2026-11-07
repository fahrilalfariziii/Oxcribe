import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { toPublicGatewayStatus, toPublicOrder } from "../lib/public-order";
import { AppError } from "../lib/errors";
import { FEATURES, getBusinessFeatures, isFeatureOn, requirePublicFeature } from "../lib/feature-gate";
import { PLANS, getPlanByCode } from "../lib/plans";
import { asyncHandler } from "../middleware/error-handler";
import { createOrder } from "../services/order.service";
import { resolveDokuConfig } from "../services/doku.service";
import { ensureQrisCharge, pollQrisOrder, storeDokuNotification } from "../services/payment-lifecycle.service";
import { cancelOrder } from "../services/order.service";
import { handleStream } from "../lib/realtime";

const publicOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak order, coba lagi sebentar" },
});

const dokuNotificationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak notifikasi" },
});

export const publicRouter = Router();

// GET /api/stream — realtime Server-Sent Events (pengganti Socket.io).
// Staff:   /api/stream?token=JWT
// Pelanggan: /api/stream?qrToken=table-01
// Resume: header Last-Event-ID (EventSource otomatis). Rate-limit longgar
// karena reconnect berkala adalah perilaku normal SSE.
const streamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak koneksi stream, coba lagi sebentar" },
});
publicRouter.get("/stream", streamLimiter, (req, res) => {
  handleStream(req, res).catch((e) => {
    console.error("[stream] gagal:", e);
    if (!res.headersSent) res.status(500).json({ error: "Gagal membuka stream" });
  });
});

// GET /api/public/tables/:qrToken
// Dipanggil saat pelanggan scan QR — resolve meja + info bisnis (untuk header & kalkulasi pajak/service di cart).
publicRouter.get(
  "/tables/:qrToken",
  asyncHandler(async (req, res) => {
    const table = await prisma.cafeTable.findUnique({
      where: { qrToken: req.params.qrToken },
      include: { business: true },
    });

    if (!table || !table.isActive) {
      throw AppError.notFound("QR meja tidak valid atau tidak aktif");
    }

    const dokuConfigured = Boolean(resolveDokuConfig());
    // Flag granular OFF = paksa komponen NOL di response publik
    // agar cart self-order hitung total murni untuk komponen itu.
    // Sertakan flags penuh agar FE bisa tampilkan state "Self-order nonaktif" dkk.
    let flags: Record<string, boolean> = {};
    try {
      flags = (await getBusinessFeatures(table.businessId)).flags;
    } catch {
      flags = {};
    }
    const taxOn = isFeatureOn(flags, FEATURES.TAX_FEES);
    const svcOn = isFeatureOn(flags, FEATURES.SERVICE_CHARGE);
    res.json({
      table: {
        id: table.id,
        tableNumber: table.tableNumber,
        area: table.area,
        qrConfig: table.qrConfig,
      },
      business: {
        id: table.business.id,
        name: table.business.name,
        tagline: table.business.tagline,
        logoUrl: table.business.logoUrl,
        taxEnabled: taxOn ? table.business.taxEnabled : false,
        taxLabel: table.business.taxLabel,
        taxRate: taxOn ? table.business.taxRate : 0,
        taxBearer: table.business.taxBearer,
        serviceChargeEnabled: svcOn ? table.business.serviceChargeEnabled : false,
        serviceChargeRate: svcOn ? table.business.serviceChargeRate : 0,
        serviceChargeMode: (table.business as unknown as { serviceChargeMode?: string }).serviceChargeMode ?? "percent",
        serviceChargeFlat: svcOn ? ((table.business as unknown as { serviceChargeFlat?: unknown }).serviceChargeFlat ?? 0) : 0,
        // Config platform fee self-order non-tunai (per kafe, dari Platform Admin).
        platformFeeEnabled: (table.business as unknown as { platformFeeEnabled?: boolean }).platformFeeEnabled ?? false,
        platformFeeMode: (table.business as unknown as { platformFeeMode?: string }).platformFeeMode ?? "percent",
        platformFeePercent: (table.business as unknown as { platformFeePercent?: unknown }).platformFeePercent ?? 0,
        platformFeeFlat: (table.business as unknown as { platformFeeFlat?: unknown }).platformFeeFlat ?? 0,
        platformFeeBearer: (table.business as unknown as { platformFeeBearer?: string }).platformFeeBearer ?? "customer",
        features: flags,
        enabledPaymentMethods: (Array.isArray(table.business.enabledPaymentMethods) ? table.business.enabledPaymentMethods : ["cash", "qris"]).filter((method) => method === "cash" || method === "qris"),
        paymentSettings: (table.business as unknown as { paymentSettings?: unknown }).paymentSettings ?? {},
        dokuMode: "global",
        dokuConfigured,
        theme: (table.business as unknown as { theme?: unknown }).theme ?? null,
      },
    });
  })
);
// GET /api/public/businesses/:businessId/catalog
// Katalog untuk pelanggan: hanya kategori aktif & produk yang tersedia.
publicRouter.get(
  "/businesses/:businessId/catalog",
  asyncHandler(async (req, res) => {
    const businessId = Number(req.params.businessId);

    const categories = await prisma.category.findMany({
      where: { businessId, isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        products: {
          include: { options: { where: { isActive: true } } },
        },
      },
    });

    res.json(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        products: c.products.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          imageUrl: p.imageUrl,
          isAvailable: p.isAvailable,
          badge: p.badge,
          options: p.options,
        })),
      }))
    );
  })
);

// GET /api/public/plans — daftar paket SaaS untuk Landing Page (publik, tanpa login).
// Sumber utama tabel `plans` (dikelola Platform Admin); fallback statis src/lib/plans.ts
// bila DB belum di-seed agar landing tetap render.
publicRouter.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const dbPlans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
    if (dbPlans.length > 0) return res.json({ plans: dbPlans });
    res.json({ plans: PLANS });
  })
);

// GET /api/public/landing-content — konten CMS landing (publik, tanpa login).
// Hanya section published. Pricing tetap dari /plans, bukan dari sini (PRD §4.2).
publicRouter.get(
  "/landing-content",
  asyncHandler(async (_req, res) => {
    const sections = await prisma.landingSection.findMany({
      where: { isPublished: true },
      orderBy: { sortOrder: "asc" },
    });
    const byKey: Record<string, unknown> = {};
    for (const s of sections) byKey[s.sectionKey] = s.content;
    res.json({ sections, byKey });
  })
);

const createLeadSchema = z.object({
  businessName: z.string().min(1).max(100),
  ownerName: z.string().min(1).max(100),
  email: z.string().email().max(150),
  phone: z.string().max(30).optional().nullable(),
  // Lead jasa website bukan paket SaaS -> interestedPlan boleh null (tanpa default pro).
  interestedPlan: z.enum(["starter", "pro", "enterprise"]).optional().nullable(),
  // Field tambahan form konsultasi sales (/hubungi-sales) — semuanya opsional
  // agar request lama (bisnis/owner/email/phone/plan) tetap valid.
  jobRole: z.string().max(100).optional().nullable(),
  outletCount: z.string().max(100).optional().nullable(),
  needCategory: z.string().max(100).optional().nullable(),
  message: z.string().max(2000).optional().nullable(),
});

const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak pendaftaran, coba lagi sebentar" },
});

// POST /api/public/leads — form konsultasi sales Landing Page (publik, tanpa login).
// Dipakai halaman /hubungi-sales (nama, jabatan, email, WA, nama kafe, skala outlet,
// kategori kebutuhan, pesan). Tersimpan di tabel `leads` untuk ditinjau Platform Admin.
publicRouter.post(
  "/leads",
  leadLimiter,
  asyncHandler(async (req, res) => {
    const data = createLeadSchema.parse(req.body);
    // needCategory "Jasa Website" -> bukan paket SaaS, interestedPlanId null.
    const planCode = data.interestedPlan ?? (data.needCategory === "Jasa Website" ? null : "pro");
    const plan = planCode
      ? (await prisma.plan.findUnique({ where: { code: planCode } })) ?? getPlanByCode(planCode)
      : null;

    const lead = await prisma.lead.create({
      data: {
        businessName: data.businessName,
        ownerName: data.ownerName,
        email: data.email,
        phone: data.phone ?? null,
        interestedPlanId: plan?.id ?? null,
        jobRole: data.jobRole ?? null,
        outletCount: data.outletCount ?? null,
        needCategory: data.needCategory ?? null,
        message: data.message ?? null,
      },
      include: { interestedPlan: true },
    });

    res.status(201).json({ ...lead, interestedPlan: planCode });
  })
);

const createSelfOrderSchema = z.object({
  qrToken: z.string().min(1),
  clientOrderId: z.string().uuid().optional(),
  customerName: z.string().min(1),
  paymentMethod: z.enum(["cash", "qris"]),
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

// POST /api/public/orders — checkout dari Self-Order pelanggan.
// Di-gate flag selfOrder: paket Starter (tanpa self-order) ditolak 403.
// Kasir manual (POST /api/orders) TIDAK di-gate — selalu tersedia semua paket.
publicRouter.post(
  "/orders",
  publicOrderLimiter,
  requirePublicFeature(FEATURES.SELF_ORDER),
  asyncHandler(async (req, res) => {
    const data = createSelfOrderSchema.parse(req.body);

    const table = await prisma.cafeTable.findUnique({ where: { qrToken: data.qrToken } });
    if (!table || !table.isActive) {
      throw AppError.badRequest("QR meja tidak valid atau tidak aktif");
    }

    const order = await createOrder({
      businessId: table.businessId,
      clientOrderId: data.clientOrderId ?? crypto.randomUUID(),
      tableId: table.id,
      customerName: data.customerName,
      source: "self_order",
      paymentMethod: data.paymentMethod,
      items: data.items,
    });

    if (order.paymentMethod === "qris") return res.status(201).json(toPublicOrder(await ensureQrisCharge(order.id)));

    res.status(201).json(toPublicOrder(order));
  })
);

// GET /api/public/orders/:clientOrderId — polling status live order (fallback selain socket)
publicRouter.get(
  "/orders/:clientOrderId",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { clientOrderId: req.params.clientOrderId },
      include: { items: true, payments: true, statusLogs: { orderBy: { createdAt: "asc" } } },
    });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    res.json(toPublicOrder(order));
  })
);

// GET /api/public/orders/by-client/:clientOrderId/status — poll DOKU (fallback webhook)
// Lookup via clientOrderId UUID — partnerReferenceNo unik per charge tersimpan di gatewayData.
publicRouter.get(
  "/orders/by-client/:clientOrderId/status",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { clientOrderId: req.params.clientOrderId }, include: { items: true, payments: true } });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    const doku = order.paymentMethod === "qris" ? await pollQrisOrder(order.id) : null;
    const refreshed = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, payments: true } });
    const publicStatus = toPublicGatewayStatus(doku);
    res.json({ order: toPublicOrder(refreshed ?? order), doku: publicStatus, midtrans: publicStatus });
  })
);

// Alias by-number DINONAKTIFKAN (410 Gone) — orderNumber sekuensial mudah dienumerasi
// dan handler lama bisa memicu markOrderPaid anonim. Polling publik wajib memakai
// /orders/by-client/:clientOrderId/status (clientOrderId UUID tak tertebak).
publicRouter.get(
  "/orders/by-number/:orderNumber/status",
  asyncHandler(async (_req, res) => {
    res.status(410).json({ error: "Endpoint by-number dinonaktifkan. Gunakan /api/public/orders/by-client/:clientOrderId/status" });
  })
);

// Checkout and recharge share the durable attempt; uncertain requests are queried by the worker.
publicRouter.post(
  "/orders/by-client/:clientOrderId/recharge",
  publicOrderLimiter,
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { clientOrderId: req.params.clientOrderId },
      include: { items: true, payments: true },
    });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    if (order.paymentStatus !== "pending") throw AppError.badRequest("Order sudah tidak pending");
    if (order.paymentMethod === "cash") throw AppError.badRequest("Cash tidak perlu recharge DOKU");

    // Gate self-order: recharge milik paket tanpa self-order ditolak 403.
    const { getBusinessFeatures: getBF, isFeatureOn: isOn } = await import("../lib/feature-gate");
    const { flags: rechargeFlags } = await getBF(order.businessId);
    if (!isOn(rechargeFlags, FEATURES.SELF_ORDER)) {
      throw AppError.forbidden(
        "Fitur ini tidak termasuk paket kafe Anda (selfOrder). Hubungi tim sales untuk upgrade."
      );
    }

    res.json(toPublicOrder(await ensureQrisCharge(order.id)));
  })
);

// POST /api/public/orders/by-client/:clientOrderId/cancel — pelanggan membatalkan
// ordernya sendiri (mis. ganti metode bayar). Hanya bila belum lunas & belum selesai.
// Memakai cancelOrder yang sama dengan kasir: expire QRIS DOKU + paymentStatus canceled.
publicRouter.post(
  "/orders/by-client/:clientOrderId/cancel",
  publicOrderLimiter,
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { clientOrderId: req.params.clientOrderId } });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    if (order.paymentStatus === "paid") throw AppError.badRequest("Order yang sudah lunas tidak bisa dibatalkan");
    if (order.status === "selesai" || order.status === "batal") throw AppError.badRequest("Order sudah selesai atau dibatalkan");
    const cancelled = await cancelOrder(order.businessId, order.id);
    res.json(toPublicOrder(cancelled));
  })
);

// Verified events are durable before acknowledging DOKU; the worker processes them.
publicRouter.post(
  "/doku/notification",
  dokuNotificationLimiter,
  asyncHandler(async (req, res) => {
    await storeDokuNotification((req.body ?? {}) as Record<string, unknown>, req.headers);
    res.json({ responseCode: "2002600", responseMessage: "Successful" });
  })
);
