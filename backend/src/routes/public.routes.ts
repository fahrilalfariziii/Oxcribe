import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import { FEATURES, getBusinessFeatures, isFeatureOn, requirePublicFeature } from "../lib/feature-gate";
import { PLANS, getPlanByCode } from "../lib/plans";
import { asyncHandler } from "../middleware/error-handler";
import { createOrder } from "../services/order.service";
import { createDokuChargeForMethod, dokuReferenceFromPayments, getDokuQrisStatus, getDokuVAStatus, normalizeDokuStatus, verifyDokuNotification } from "../services/doku.service";
import { markOrderPaid, cancelOrder } from "../services/order.service";
import { emitOrderPaymentUpdate, emitOrderStatusUpdate } from "../lib/realtime";
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

    const dokuConfigured = Boolean(process.env.DOKU_CLIENT_ID && process.env.DOKU_MERCHANT_ID);
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
        enabledPaymentMethods: (table.business as unknown as { enabledPaymentMethods?: unknown }).enabledPaymentMethods ?? ["cash", "qris"],
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
  clientOrderId: z.string().min(1).optional(),
  customerName: z.string().min(1),
  paymentMethod: z.enum(["cash", "qris", "bank_transfer"]),
  selectedBank: z.enum(["bca", "mandiri", "bni", "bri"]).optional(),
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

    // Metode non-cash SELALU via DOKU SNAP (global; nilai gateway lama diabaikan)
    if ((data.paymentMethod as string) !== "cash") {
      try {
        const charge = await createDokuChargeForMethod({
          method: data.paymentMethod as "qris" | "bank_transfer",
          orderNumber: order.orderNumber,
          grossAmount: Number(order.total),
          customerName: data.customerName,
          selectedBank: (data as { selectedBank?: string }).selectedBank,
        });
        if (charge) {
          await prisma.payment.updateMany({
            where: { orderId: order.id },
            data: { gateway: "doku", reference: charge.referenceNo ?? charge.partnerReferenceNo, gatewayData: charge as unknown as object },
          });
          const refreshed = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, payments: true, statusLogs: true, table: true } });
          if (refreshed) return res.status(201).json(refreshed);
        }
      } catch (e) {
        console.error("[DOKU charge] gagal:", e);
        // tetap return order tanpa gatewayData — FE akan tampil retry
      }
    }

    res.status(201).json(order);
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
    res.json(order);
  })
);

// GET /api/public/orders/by-client/:clientOrderId/status — poll DOKU (fallback webhook)
// Lookup via clientOrderId UUID — partnerReferenceNo unik per charge tersimpan di gatewayData.
publicRouter.get(
  "/orders/by-client/:clientOrderId/status",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { clientOrderId: req.params.clientOrderId }, include: { items: true, payments: true } });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    const gd = ((order as unknown as { payments?: Array<{ gatewayData?: Record<string, unknown> }> }).payments?.[0]?.gatewayData ?? {}) as Record<string, unknown>;
    if (order.paymentMethod === "cash" || !gd.partnerReferenceNo) return res.json({ order, doku: null, midtrans: null });
    let dokuStatus: Record<string, unknown> | null = null;
    try {
      if (order.paymentMethod === "qris") {
        dokuStatus = await getDokuQrisStatus({ partnerReferenceNo: String(gd.partnerReferenceNo), referenceNo: typeof gd.referenceNo === "string" ? gd.referenceNo : undefined });
      } else {
        dokuStatus = await getDokuVAStatus({ partnerServiceId: typeof gd.partnerServiceId === "string" ? gd.partnerServiceId : undefined, customerNo: typeof gd.customerNo === "string" ? gd.customerNo : undefined, virtualAccountNo: typeof gd.vaNumber === "string" ? gd.vaNumber : undefined });
      }
    } catch {}
    if (!dokuStatus) return res.json({ order, doku: null, midtrans: null });
    const norm = normalizeDokuStatus(dokuStatus);
    if (norm === "paid" && order.paymentStatus !== "paid") {
      try {
        const ref = typeof (dokuStatus.referenceNo as string) === "string" ? (dokuStatus.referenceNo as string) : String(gd.partnerReferenceNo);
        const updated = await markOrderPaid(order.businessId, order.id, { reference: ref }, { allowNonCash: true });
        emitOrderPaymentUpdate(order.businessId, updated);
        return res.json({ order: updated, doku: dokuStatus, midtrans: dokuStatus });
      } catch {}
    }
    if (norm === "failed" && order.paymentStatus === "pending") {
      await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "failed" } });
      await prisma.payment.updateMany({ where: { orderId: order.id }, data: { status: "failed" } });
      try {
        const cancelled = await cancelOrder(order.businessId, order.id);
        emitOrderStatusUpdate(order.businessId, cancelled);
      } catch {}
      const failed = await prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true, payments: true, statusLogs: { orderBy: { createdAt: "asc" } } },
      });
      return res.json({ order: failed ?? order, doku: dokuStatus, midtrans: dokuStatus });
    }
    res.json({ order, doku: dokuStatus, midtrans: dokuStatus });
  })
);

// Deprecated alias by-number — tetap didukung, log warning
publicRouter.get(
  "/orders/by-number/:orderNumber/status",
  asyncHandler(async (req, res) => {
    console.warn("[deprecated] GET /by-number/:orderNumber/status dipakai, ganti ke /by-client/:clientOrderId/status");
    const order = await prisma.order.findUnique({ where: { orderNumber: req.params.orderNumber }, include: { items: true, payments: true } });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    const gd = ((order as unknown as { payments?: Array<{ gatewayData?: Record<string, unknown> }> }).payments?.[0]?.gatewayData ?? {}) as Record<string, unknown>;
    if (order.paymentMethod === "cash" || !gd.partnerReferenceNo) return res.json({ order, doku: null, midtrans: null });
    let dokuStatus: Record<string, unknown> | null = null;
    try {
      if (order.paymentMethod === "qris") {
        dokuStatus = await getDokuQrisStatus({ partnerReferenceNo: String(gd.partnerReferenceNo), referenceNo: typeof gd.referenceNo === "string" ? gd.referenceNo : undefined });
      } else {
        dokuStatus = await getDokuVAStatus({ partnerServiceId: typeof gd.partnerServiceId === "string" ? gd.partnerServiceId : undefined, customerNo: typeof gd.customerNo === "string" ? gd.customerNo : undefined, virtualAccountNo: typeof gd.vaNumber === "string" ? gd.vaNumber : undefined });
      }
    } catch {}
    if (!dokuStatus) return res.json({ order, doku: null, midtrans: null });
    const norm = normalizeDokuStatus(dokuStatus);
    if (norm === "paid" && order.paymentStatus !== "paid") {
      try {
        const updated = await markOrderPaid(order.businessId, order.id, { reference: String(gd.partnerReferenceNo) }, { allowNonCash: true });
        emitOrderPaymentUpdate(order.businessId, updated);
        return res.json({ order: updated, doku: dokuStatus, midtrans: dokuStatus });
      } catch {}
    }
    res.json({ order, doku: dokuStatus, midtrans: dokuStatus });
  })
);

// POST /api/public/orders/by-client/:clientOrderId/recharge — terbitkan charge DOKU baru
// untuk order pending yang QR/VA-nya gagal terbit. Setiap recharge memakai
// partnerReferenceNo unik yang baru, jadi selalu legal.
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

    // Idempoten: bila QR/VA SUDAH tersimpan, kembalikan apa adanya
    const existingGateway = (order.payments?.[0]?.gatewayData ?? {}) as Record<string, unknown>;
    const hasUsablePayload =
      typeof existingGateway.qrContent === "string" ||
      typeof existingGateway.vaNumber === "string";
    if (hasUsablePayload) {
      const asIs = await prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true, payments: true, statusLogs: { orderBy: { createdAt: "asc" } } },
      });
      return res.json({ ...(asIs ?? order), reused: true });
    }

    const body = (req.body ?? {}) as { selectedBank?: string };
    const allowedBanks = ["bca", "mandiri", "bni", "bri"] as const;
    const selectedBank = allowedBanks.includes(body.selectedBank as (typeof allowedBanks)[number])
      ? (body.selectedBank as string)
      : undefined;

    const charge = await createDokuChargeForMethod({
      method: order.paymentMethod as "qris" | "bank_transfer",
      orderNumber: order.orderNumber,
      grossAmount: Number(order.total),
      customerName: order.customerName ?? undefined,
      selectedBank,
    });
    if (!charge) throw AppError.badRequest("DOKU charge gagal — periksa kredensial/B2B token di log server");

    // Silsilah: reference lama disimpan agar notifikasi susulan tetap dikenali
    const prevGateway = (order.payments?.[0]?.gatewayData ?? {}) as Record<string, unknown>;
    const prevIds = Array.isArray(prevGateway.previousReferenceNos) ? (prevGateway.previousReferenceNos as string[]) : [];
    const prevRef = typeof prevGateway.partnerReferenceNo === "string" ? (prevGateway.partnerReferenceNo as string) : null;
    const previousReferenceNos = [...prevIds, ...(prevRef && prevRef !== charge.partnerReferenceNo ? [prevRef] : [])].slice(-10);
    await prisma.payment.updateMany({
      where: { orderId: order.id },
      data: {
        gateway: "doku",
        reference: charge.referenceNo ?? charge.partnerReferenceNo,
        gatewayData: { ...charge, previousReferenceNos } as unknown as object,
      },
    });
    const refreshed = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true, payments: true, statusLogs: { orderBy: { createdAt: "asc" } } },
    });
    res.status(201).json({ ...(refreshed ?? order), reused: false });
  })
);

// POST /api/public/doku/notification — HTTP Notification DOKU SNAP (public, verify X-SIGNATURE)
// Mendukung VA payment notification (virtualAccountNo/trxId) & QRIS/debit notify
// (originalPartnerReferenceNo + latestTransactionStatus). Balas 200 agar DOKU berhenti retry.
publicRouter.post(
  "/doku/notification",
  dokuNotificationLimiter,
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const getH = (k: string) => String(headers[k.toLowerCase()] ?? headers[k] ?? "");

    const candidates = [
      body.trxId, body.partnerReferenceNo,
      (body.virtualAccountData as Record<string, unknown> | undefined)?.trxId,
      body.originalPartnerReferenceNo, body.originalReferenceNo,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);

    let order: Awaited<ReturnType<typeof prisma.order.findUnique>> = null;
    let paidVia: string | null = null;
    for (const ref of candidates) {
      const byNumber = await prisma.order.findUnique({ where: { orderNumber: ref } });
      if (byNumber) { order = byNumber; break; }
      const pay = await prisma.payment.findFirst({ where: { gatewayData: { path: ["partnerReferenceNo"], equals: ref } } });
      if (pay) { order = await prisma.order.findUnique({ where: { id: pay.orderId } }); if (order) break; }
    }
    if (!order && candidates.length > 0) {
      const recent = await prisma.payment.findMany({ orderBy: { id: "desc" }, take: 100 });
      const hit = recent.find((p) => {
        const gd = p.gatewayData as unknown as { previousReferenceNos?: unknown } | null;
        return Array.isArray(gd?.previousReferenceNos) && candidates.some((c) => (gd.previousReferenceNos as unknown[]).includes(c));
      });
      if (hit) { order = await prisma.order.findUnique({ where: { id: hit.orderId } }); paidVia = candidates[0]; }
    }
    if (!order) {
      console.warn(`[DOKU notification] unknown reference diabaikan: ${candidates.join(",")}`);
      return res.json({ responseCode: "2002600", responseMessage: "Successful (ignored)" });
    }

    try {
      const signature = getH("x-signature");
      const timestamp = getH("x-timestamp");
      const authz = getH("authorization");
      const accessToken = authz.startsWith("Bearer ") ? authz.slice(7) : authz;
      if (signature && timestamp && process.env.DOKU_SECRET_KEY) {
        const path = "/api/public/doku/notification";
        const valid = verifyDokuNotification({ httpMethod: "POST", endpointPath: path, accessToken, body, timestamp, signature });
        if (!valid) throw AppError.badRequest("signature tidak valid");
      }
    } catch (e) {
      const st = (e as unknown as { status?: number }).status;
      if (st === 400) throw e;
      console.warn("[DOKU notification] verifikasi dilewati:", (e as Error).message);
    }

    const latest = String(body.latestTransactionStatus ?? "").toUpperCase();
    const vaData = body.virtualAccountData as Record<string, unknown> | undefined;
    const paidAmountRaw = (body.paidAmount as { value?: string } | undefined)?.value ?? (vaData?.paidAmount as { value?: string } | undefined)?.value;
    const isPaid = latest === "00" || latest === "SUCCESS" || (paidAmountRaw !== undefined && Number(paidAmountRaw) > 0) || Boolean(body.paymentRequestId);
    const isFailed = ["04", "05", "06", "07", "FAILED", "EXPIRED", "CANCELLED"].includes(latest);

    const existingPayments = await prisma.payment.findMany({ where: { orderId: order.id } });
    const existingGatewayData = (existingPayments[0]?.gatewayData as Record<string, unknown>) ?? {};
    const mergedGatewayData = {
      ...(typeof existingGatewayData === "object" && existingGatewayData !== null ? existingGatewayData : {}),
      lastNotification: body,
      lastStatus: latest || "notified",
      ...(paidVia ? { paidViaReference: paidVia } : {}),
      updatedAt: new Date().toISOString(),
    } as unknown as object;

    if (isPaid) {
      if (order.paymentStatus !== "paid") {
        const ref = String((body.referenceNo as string) || candidates[0] || order.orderNumber);
        const updated = await markOrderPaid(order.businessId, order.id, { reference: ref }, { allowNonCash: true });
        await prisma.payment.updateMany({ where: { orderId: order.id }, data: { gatewayData: mergedGatewayData } });
        emitOrderPaymentUpdate(order.businessId, updated);
      }
    } else if (isFailed) {
      await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "failed" } });
      await prisma.payment.updateMany({ where: { orderId: order.id }, data: { status: "failed", gatewayData: mergedGatewayData } });
      const failedOrder = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, payments: true } });
      if (failedOrder) emitOrderPaymentUpdate(order.businessId, failedOrder);
      try {
        const cancelled = await cancelOrder(order.businessId, order.id);
        emitOrderStatusUpdate(order.businessId, cancelled);
      } catch {}
    } else {
      await prisma.payment.updateMany({ where: { orderId: order.id }, data: { gatewayData: mergedGatewayData } });
    }

    res.json({ responseCode: "2002600", responseMessage: "Successful" });
  })
);
