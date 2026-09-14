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
import { buildMidtransItemDetails, createMidtransChargeForMethod, getMidtransTransactionStatus, midtransOrderIdFromPayments, verifyMidtransSignature } from "../services/midtrans.service";
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

const midtransNotificationLimiter = rateLimit({
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

    const midtransMode = (table.business as unknown as { midtransMode?: string }).midtransMode ?? "global";
    const hasCustomKey = Boolean((table.business as unknown as { midtransServerKeyEnc?: string }).midtransServerKeyEnc);
    // Flag Pajak & Biaya OFF = paksa pajak & service NOL di response publik
    // agar cart self-order selalu hitung total = subtotal murni.
    // Sertakan flags penuh agar FE bisa tampilkan state "Self-order nonaktif" dkk.
    let flags: Record<string, boolean> = {};
    try {
      flags = (await getBusinessFeatures(table.businessId)).flags;
    } catch {
      flags = {};
    }
    const taxAndFeesOn = isFeatureOn(flags, FEATURES.TAX_AND_FEES);
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
        taxEnabled: taxAndFeesOn ? table.business.taxEnabled : false,
        taxLabel: table.business.taxLabel,
        taxRate: taxAndFeesOn ? table.business.taxRate : 0,
        taxBearer: table.business.taxBearer,
        serviceChargeEnabled: table.business.serviceChargeEnabled,
        serviceChargeRate: table.business.serviceChargeRate,
        serviceChargeMode: (table.business as unknown as { serviceChargeMode?: string }).serviceChargeMode ?? "percent",
        serviceChargeFlat: (table.business as unknown as { serviceChargeFlat?: unknown }).serviceChargeFlat ?? 0,
        // Config platform fee self-order non-tunai (per kafe, dari Platform Admin).
        platformFeeEnabled: (table.business as unknown as { platformFeeEnabled?: boolean }).platformFeeEnabled ?? false,
        platformFeeMode: (table.business as unknown as { platformFeeMode?: string }).platformFeeMode ?? "percent",
        platformFeePercent: (table.business as unknown as { platformFeePercent?: unknown }).platformFeePercent ?? 0,
        platformFeeFlat: (table.business as unknown as { platformFeeFlat?: unknown }).platformFeeFlat ?? 0,
        platformFeeBearer: (table.business as unknown as { platformFeeBearer?: string }).platformFeeBearer ?? "customer",
        features: flags,
        enabledPaymentMethods: (table.business as unknown as { enabledPaymentMethods?: unknown }).enabledPaymentMethods ?? ["cash", "qris"],
        paymentSettings: (table.business as unknown as { paymentSettings?: unknown }).paymentSettings ?? {},
        midtransMode,
        hasMidtransCustomKey: hasCustomKey,
        midtransQrisAcquirer: (table.business as unknown as { midtransQrisAcquirer?: string }).midtransQrisAcquirer ?? null,
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

    // Metode non-cash SELALU via Midtrans (default paksa; nilai gateway lama diabaikan)
    if ((data.paymentMethod as string) !== "cash") {
      try {
        const business = await prisma.business.findUnique({ where: { id: table.businessId } });
        if (business) {
          const charge = await createMidtransChargeForMethod({
            business: business as unknown as Parameters<typeof createMidtransChargeForMethod>[0]["business"],
            method: data.paymentMethod as "qris" | "bank_transfer",
            orderNumber: order.orderNumber,
            grossAmount: Number(order.total),
            customerName: data.customerName,
            paymentSettings: (business.paymentSettings as Record<string, { acquirer?: string; bank?: string; channel?: string; wallets?: string[] }>) ?? {},
            selectedBank: (data as { selectedBank?: string }).selectedBank,
            itemDetails: buildMidtransItemDetails({
              items: order.items.map((i) => ({ productId: i.productId, productName: i.productName, price: i.price, quantity: i.quantity, optionsLabel: i.optionsLabel })),
              serviceCharge: order.serviceCharge,
              tax: order.tax,
              taxLabel: order.taxLabel,
              platformFee: (order as unknown as { platformFee?: unknown }).platformFee ?? 0,
            }),
          });
          if (charge) {
            await prisma.payment.updateMany({
              where: { orderId: order.id },
              data: { gateway: "midtrans", reference: charge.transactionId, gatewayData: charge as unknown as object },
            });
            const refreshed = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, payments: true, statusLogs: true, table: true } });
            if (refreshed) return res.status(201).json(refreshed);
          }
        }
      } catch (e) {
        console.error("[Midtrans charge] gagal:", e);
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

// GET /api/public/orders/by-client/:clientOrderId/status — poll Midtrans status (fallback webhook)
// Opsi A: lookup via clientOrderId UUID (tidak bisa ditebak) — orderNumber tetap untuk Midtrans order_id.
publicRouter.get(
  "/orders/by-client/:clientOrderId/status",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { clientOrderId: req.params.clientOrderId }, include: { items: true, payments: true } });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    const business = await prisma.business.findUnique({ where: { id: order.businessId } });
    if (!business) throw AppError.notFound("Bisnis tidak ditemukan");
    // Pakai ID Midtrans unik per charge (tersimpan di gatewayData), bukan nomor struk
    // yang boleh berulang — QRIS menolak order_id duplikat.
    const midtransOrderId = midtransOrderIdFromPayments(
      order.payments as unknown as Array<{ gatewayData?: unknown }>,
      order.orderNumber
    );
    const midtransStatus = await getMidtransTransactionStatus(business as unknown as Parameters<typeof getMidtransTransactionStatus>[0], midtransOrderId);
    if (!midtransStatus) return res.json({ order, midtrans: null });
    // Fallback rekonstruksi qrUrl QRIS bila gatewayData lama terlanjur tertimpa webhook
    // (pola resmi Midtrans: GET /v2/qris/:transaction_id/qr-code).
    try {
      const payment = (order as unknown as { payments?: Array<{ gatewayData?: Record<string, unknown>; reference?: string | null }> }).payments?.[0];
      const gd = (payment?.gatewayData ?? {}) as Record<string, unknown>;
      if (order.paymentMethod === "qris" && !gd.qrUrl) {
        const txId = String((midtransStatus.transaction_id as string) || payment?.reference || "");
        if (txId) {
          const isProd = (process.env.MIDTRANS_IS_PRODUCTION || "false").toLowerCase() === "true";
          const base = isProd ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
          (midtransStatus as Record<string, unknown>).fallbackQrUrl = `${base}/v2/qris/${txId}/qr-code`;
        }
      }
    } catch {}
    const txStatus = (midtransStatus.transaction_status as string) || "";
    // Auto-sync jika sudah settlement di Midtrans tapi lokal masih pending
    if ((txStatus === "settlement" || txStatus === "capture") && order.paymentStatus !== "paid") {
      try {
        const updated = await markOrderPaid(business.id, order.id, { reference: (midtransStatus.transaction_id as string) || undefined }, { allowNonCash: true });
        emitOrderPaymentUpdate(business.id, updated);
        return res.json({ order: updated, midtrans: midtransStatus });
      } catch {}
    }
    if ((txStatus === "expire" || txStatus === "deny" || txStatus === "cancel") && order.paymentStatus === "pending") {
      await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "failed" } });
      await prisma.payment.updateMany({ where: { orderId: order.id }, data: { status: "failed" } });
      // Auto-batal: order gagal bayar keluar dari tab aktif POS dan masuk riwayat.
      try {
        const cancelled = await cancelOrder(business.id, order.id);
        emitOrderStatusUpdate(business.id, cancelled);
      } catch {}
      const failed = await prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true, payments: true, statusLogs: { orderBy: { createdAt: "asc" } } },
      });
      return res.json({ order: failed ?? order, midtrans: midtransStatus });
    }
    res.json({ order, midtrans: midtransStatus });
  })
);

// Deprecated alias — tetap dukung orderNumber sequential untuk backward compat, tapi log warning
publicRouter.get(
  "/orders/by-number/:orderNumber/status",
  asyncHandler(async (req, res) => {
    console.warn("[deprecated] GET /by-number/:orderNumber/status dipakai, ganti ke /by-client/:clientOrderId/status");
    const order = await prisma.order.findUnique({ where: { orderNumber: req.params.orderNumber }, include: { items: true, payments: true } });
    if (!order) throw AppError.notFound("Order tidak ditemukan");
    const business = await prisma.business.findUnique({ where: { id: order.businessId } });
    if (!business) throw AppError.notFound("Bisnis tidak ditemukan");
    const midtransOrderId = midtransOrderIdFromPayments(
      order.payments as unknown as Array<{ gatewayData?: unknown }>,
      order.orderNumber
    );
    const midtransStatus = await getMidtransTransactionStatus(business as unknown as Parameters<typeof getMidtransTransactionStatus>[0], midtransOrderId);
    if (!midtransStatus) return res.json({ order, midtrans: null });
    const txStatus = (midtransStatus.transaction_status as string) || "";
    if ((txStatus === "settlement" || txStatus === "capture") && order.paymentStatus !== "paid") {
      try {
        const updated = await markOrderPaid(business.id, order.id, { reference: (midtransStatus.transaction_id as string) || undefined }, { allowNonCash: true });
        emitOrderPaymentUpdate(business.id, updated);
        return res.json({ order: updated, midtrans: midtransStatus });
      } catch {}
    }
    res.json({ order, midtrans: midtransStatus });
  })
);

// POST /api/public/orders/by-client/:clientOrderId/recharge — terbitkan charge baru
// untuk order pending yang QR/VA-nya gagal terbit (mis. order_id duplikat di Midtrans).
// Setiap recharge memakai midtransOrderId unik yang baru, jadi selalu legal.
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
    if (order.paymentMethod === "cash") throw AppError.badRequest("Cash tidak perlu recharge Midtrans");

    const business = await prisma.business.findUnique({ where: { id: order.businessId } });
    if (!business) throw AppError.notFound("Bisnis tidak ditemukan");

    // Gate self-order: recharge milik paket tanpa self-order ditolak 403.
    const { getBusinessFeatures: getBF, isFeatureOn: isOn } = await import("../lib/feature-gate");
    const { flags: rechargeFlags } = await getBF(order.businessId);
    if (!isOn(rechargeFlags, FEATURES.SELF_ORDER)) {
      throw AppError.forbidden(
        "Fitur ini tidak termasuk paket kafe Anda (selfOrder). Hubungi tim sales Ordria untuk upgrade."
      );
    }

    // Idempoten: bila QR/VA/redirect valid SUDAH tersimpan, kembalikan apa adanya —
    // "muat ulang" tidak boleh membuat transaksi baru di Midtrans.
    const existingGateway = (order.payments?.[0]?.gatewayData ?? {}) as Record<string, unknown>;
    const hasUsablePayload =
      typeof existingGateway.qrUrl === "string" ||
      typeof existingGateway.qrString === "string" ||
      typeof existingGateway.vaNumber === "string" ||
      typeof existingGateway.redirectUrl === "string";
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

    const charge = await createMidtransChargeForMethod({
      business: business as unknown as Parameters<typeof createMidtransChargeForMethod>[0]["business"],
      method: order.paymentMethod as "qris" | "bank_transfer",
      orderNumber: order.orderNumber,
      grossAmount: Number(order.total),
      customerName: order.customerName ?? undefined,
      paymentSettings: (business.paymentSettings as Record<string, { acquirer?: string; bank?: string; channel?: string; wallets?: string[] }>) ?? {},
      selectedBank,
      itemDetails: buildMidtransItemDetails({
        items: order.items.map((i) => ({ productId: i.productId, productName: i.productName, price: i.price, quantity: i.quantity, optionsLabel: i.optionsLabel })),
        serviceCharge: order.serviceCharge,
        tax: order.tax,
        taxLabel: order.taxLabel,
        platformFee: (order as unknown as { platformFee?: unknown }).platformFee ?? 0,
      }),
    });
    if (!charge) throw AppError.badRequest("Midtrans tidak terkonfigurasi untuk bisnis ini");

    // Silsilah: ID charge lama disimpan agar notifikasi susulannya tetap dikenali
    // (pelanggan bisa saja membayar QR/VA lama). Merge, JANGAN timpa buta.
    const prevGateway = (order.payments?.[0]?.gatewayData ?? {}) as Record<string, unknown>;
    const prevIds = Array.isArray(prevGateway.previousOrderIds) ? (prevGateway.previousOrderIds as string[]) : [];
    const prevOrderId = typeof prevGateway.orderId === "string" ? (prevGateway.orderId as string) : null;
    const previousOrderIds = [...prevIds, ...(prevOrderId && prevOrderId !== charge.orderId ? [prevOrderId] : [])].slice(-10);
    await prisma.payment.updateMany({
      where: { orderId: order.id },
      data: {
        gateway: "midtrans",
        reference: charge.transactionId,
        gatewayData: { ...charge, previousOrderIds } as unknown as object,
      },
    });
    const refreshed = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true, payments: true, statusLogs: { orderBy: { createdAt: "asc" } } },
    });
    res.status(201).json({ ...(refreshed ?? order), reused: false });
  })
);

// POST /api/public/midtrans/notification — webhook Midtrans (public, verify signature)
publicRouter.post(
  "/midtrans/notification",
  midtransNotificationLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const orderId = String(body.order_id || "");
    const statusCode = String(body.status_code || "");
    const grossAmount = String(body.gross_amount || "");
    const signatureKey = String(body.signature_key || "");
    const transactionStatus = String(body.transaction_status || "");
    const transactionId = String(body.transaction_id || "");
    const paymentType = String(body.payment_type || "");

    if (!orderId) throw AppError.badRequest("order_id wajib");

    // body.order_id adalah midtransOrderId unik ("BE-9028-m3k9x1"). Cari order:
    // 1) cocok orderNumber persis (order lama sebelum ID unik),
    // 2) via gatewayData.orderId,
    // 3) via gatewayData.previousOrderIds (charge lama yang tertimpa recharge —
    //    pelanggan bisa saja membayar QR/VA lama, uangnya tetap harus tercatat).
    let order = await prisma.order.findUnique({ where: { orderNumber: orderId } });
    let paidVia: string | null = null;
    if (!order) {
      const payment = await prisma.payment.findFirst({
        where: { gatewayData: { path: ["orderId"], equals: orderId } },
      });
      if (payment) {
        order = await prisma.order.findUnique({ where: { id: payment.orderId } });
      }
    }
    if (!order) {
      const recent = await prisma.payment.findMany({
        orderBy: { id: "desc" },
        take: 100,
      });
      const hit = recent.find((p) => {
        const gd = p.gatewayData as unknown as { previousOrderIds?: unknown };
        return Array.isArray(gd?.previousOrderIds) && (gd.previousOrderIds as unknown[]).includes(orderId);
      });
      if (hit) {
        order = await prisma.order.findUnique({ where: { id: hit.orderId } });
        paidVia = orderId;
      }
    }
    if (!order) {
      // Praktik standar Midtrans: ID tak dikenal (test dashboard/retry basi/order DB lain)
      // dibalas 200 agar Midtrans BERHENTI retry, tapi dicatat agar bisa ditelusuri.
      console.warn(`[Midtrans notification] unknown order_id diabaikan: ${orderId} (type=${paymentType}, status=${transactionStatus})`);
      return res.json({ status: "ignored", reason: "unknown order_id" });
    }

    const business = await prisma.business.findUnique({ where: { id: order.businessId } });
    if (!business) throw AppError.notFound("Bisnis tidak ditemukan");

    // Resolve ServerKey untuk verifikasi signature
    const enc = (business as unknown as { midtransServerKeyEnc?: string }).midtransServerKeyEnc;
    let serverKey = process.env.MIDTRANS_SERVER_KEY || "";
    if ((business as unknown as { midtransMode?: string }).midtransMode === "custom" && enc) {
      try {
        const { decrypt } = await import("../lib/encryption");
        serverKey = decrypt(enc);
      } catch {}
    }
    if (!serverKey) {
      console.warn("[Midtrans notification] ServerKey tidak dikonfigurasi");
      return res.json({ status: "ignored", reason: "no server key" });
    }
    const valid = verifyMidtransSignature({ order_id: orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: signatureKey, serverKey });
    if (!valid) throw AppError.badRequest("signature_key tidak valid");

    // Merge agar qrUrl/qrString dari charge tidak hilang tertimpa body notifikasi.
    const existingPayments = await prisma.payment.findMany({ where: { orderId: order.id } });
    const existingGatewayData = (existingPayments[0]?.gatewayData as Record<string, unknown>) ?? {};
    const mergedGatewayData = {
      ...(typeof existingGatewayData === "object" && existingGatewayData !== null ? existingGatewayData : {}),
      lastNotification: body,
      lastStatus: transactionStatus,
      ...(paidVia ? { paidViaOrderId: paidVia } : {}),
      updatedAt: new Date().toISOString(),
    } as unknown as object;

    if (transactionStatus === "settlement" || transactionStatus === "capture") {
      if (order.paymentStatus !== "paid") {
        const updated = await markOrderPaid(business.id, order.id, { reference: transactionId || paymentType }, { allowNonCash: true });
        // update gatewayData paid flag (merge, jangan overwrite qrUrl)
        await prisma.payment.updateMany({ where: { orderId: order.id }, data: { gatewayData: mergedGatewayData } });
        emitOrderPaymentUpdate(business.id, updated);
      }
    } else if (transactionStatus === "expire" || transactionStatus === "deny" || transactionStatus === "cancel" || transactionStatus === "failure") {
      await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "failed" } });
      await prisma.payment.updateMany({ where: { orderId: order.id }, data: { status: "failed", gatewayData: mergedGatewayData } });
      const failedOrder = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, payments: true } });
      if (failedOrder) emitOrderPaymentUpdate(business.id, failedOrder);
      // Auto-batal: keluar dari tab aktif POS, masuk riwayat (kecuali sudah lunas/selesai).
      try {
        const cancelled = await cancelOrder(business.id, order.id);
        emitOrderStatusUpdate(business.id, cancelled);
      } catch {}
    } else if (transactionStatus === "pending") {
      // biarkan pending, simpan notifikasi tanpa hapus qrUrl/qrString charge
      await prisma.payment.updateMany({ where: { orderId: order.id }, data: { gatewayData: mergedGatewayData } });
    }

    res.json({ status: "ok" });
  })
);
