import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { comparePassword, hashPassword, isStrongPassword } from "../lib/password";
import { signPlatformToken } from "../lib/jwt";
import { AppError } from "../lib/errors";
import { asyncHandler } from "../middleware/error-handler";
import { requirePlatformAuth, requirePlatformRole } from "../middleware/platform-auth";
import { PLANS as STATIC_PLANS } from "../lib/plans";

export const platformRouter = Router();

// Catatan urutan: POST /auth/login didaftarkan SEBELUM requirePlatformAuth
// (Express menjalankan middleware sesuai urutan definisi). Sisanya wajib auth.
// Cookie memakai nama "platform_token" agar tak tertukar sesi tenant.

async function recordAudit(
  platformAdminId: number,
  businessId: number | null,
  action: string,
  before: unknown,
  after: unknown
) {
  try {
    await prisma.platformAuditLog.create({
      data: { platformAdminId, businessId, action, before: (before ?? {}) as object, after: (after ?? {}) as object },
    });
  } catch (e) {
    console.error("[platform audit] gagal mencatat:", e);
  }
}

// ================= Auth =================

const platformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const platformLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan login, coba lagi nanti" },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip as string)}-${String((req.body as { email?: string })?.email || "").toLowerCase()}`,
});

// POST /api/platform/auth/login — publik (tanpa auth). Cookie "platform_token".
platformRouter.post(
  "/auth/login",
  platformLoginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = platformLoginSchema.parse(req.body);

    const admin = await prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin || !admin.active) {
      throw AppError.unauthorized("Email atau password salah");
    }

    const valid = await comparePassword(password, admin.passwordHash);
    if (!valid) {
      throw AppError.unauthorized("Email atau password salah");
    }

    const token = signPlatformToken({ adminId: admin.id, role: admin.role as "superadmin" | "support" });
    const maxAge = 12 * 60 * 60 * 1000;
    res.cookie("platform_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge,
      path: "/",
    });

    res.json({
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    });
  })
);

// Semua route di bawah garis ini wajib login platform admin.
// Token tenant (scope tenant/tanpa scope) DITOLAK di sini — isolasi sesi PRD §8.2.
platformRouter.use(requirePlatformAuth);

platformRouter.get(
  "/auth/me",
  asyncHandler(async (req, res) => {
    const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin!.adminId } });
    if (!admin) throw AppError.notFound("Admin tidak ditemukan");
    res.json({ id: admin.id, name: admin.name, email: admin.email, role: admin.role, active: admin.active });
  })
);

platformRouter.post(
  "/auth/logout",
  asyncHandler(async (_req, res) => {
    res.clearCookie("platform_token", { path: "/" });
    res.json({ status: "ok" });
  })
);

// ================= Tenants =================

const tenantQuerySchema = z.object({
  plan: z.string().optional(),
  status: z.string().optional(),
  q: z.string().max(100).optional(),
});

// GET /api/platform/tenants — daftar + agregat order 30 hari (bukan detail struk)
platformRouter.get(
  "/tenants",
  asyncHandler(async (req, res) => {
    const { plan, status, q } = tenantQuerySchema.parse(req.query);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const businesses = await prisma.business.findMany({
      where: {
        ...(q
          ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] }
          : {}),
        ...(plan ? { currentPlan: { code: plan } } : {}),
      },
      include: {
        currentPlan: true,
        subscriptions: { orderBy: { createdAt: "desc" }, take: 1, include: { plan: true } },
        users: { where: { role: "owner", active: true }, select: { id: true, name: true, email: true }, take: 1 },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const orderCounts = await prisma.order.groupBy({
      by: ["businessId"],
      where: { businessId: { in: businesses.map((b) => b.id) }, createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    });
    const countByBusiness = new Map(orderCounts.map((r) => [r.businessId, r._count.id]));

    const rows = businesses
      .map((b) => {
        const sub = b.subscriptions[0] ?? null;
        return {
          id: b.id,
          name: b.name,
          slug: b.slug,
          email: b.email,
          phone: b.phone,
          plan: b.currentPlan?.code ?? sub?.plan.code ?? null,
          planName: b.currentPlan?.name ?? sub?.plan.name ?? null,
          subscriptionStatus: sub?.status ?? null,
          isPlatformSuspended: b.isPlatformSuspended,
          owner: b.users[0] ?? null,
          orders30d: countByBusiness.get(b.id) ?? 0,
          totalOrders: b._count.orders,
          onboardedAt: b.onboardedAt,
          createdAt: b.createdAt,
        };
      })
      .filter((r) => (status ? r.subscriptionStatus === status : true));

    res.json({ tenants: rows });
  })
);

const onboardSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug hanya huruf kecil, angka, dan strip"),
  ownerName: z.string().min(1).max(100),
  ownerEmail: z.string().email().max(150),
  ownerPassword: z.string().min(1),
  planCode: z.enum(["starter", "pro", "enterprise"]),
});

// POST /api/platform/tenants — onboarding: business + owner + subscription active.
// Langsung aktif sejak dibuat, TANPA trial (PRD §4.2, §5.1).
platformRouter.post(
  "/tenants",
  asyncHandler(async (req, res) => {
    const data = onboardSchema.parse(req.body);
    if (!isStrongPassword(data.ownerPassword)) {
      throw AppError.badRequest("Password owner minimal 8 karakter, mengandung huruf, angka, dan simbol");
    }
    const plan = await prisma.plan.findUnique({ where: { code: data.planCode } });
    if (!plan) throw AppError.badRequest("Paket tidak dikenal");

    const existingSlug = await prisma.business.findUnique({ where: { slug: data.slug } });
    if (existingSlug) throw AppError.badRequest("Slug sudah dipakai bisnis lain");
    const existingEmail = await prisma.user.findUnique({ where: { email: data.ownerEmail } });
    if (existingEmail) throw AppError.badRequest("Email owner sudah terdaftar");

    const business = await prisma.business.create({
      data: {
        name: data.name,
        slug: data.slug,
        email: data.ownerEmail,
        currentPlanId: plan.id,
        onboardedAt: new Date(),
        status: "active",
      },
    });
    const owner = await prisma.user.create({
      data: {
        businessId: business.id,
        name: data.ownerName,
        email: data.ownerEmail,
        passwordHash: await hashPassword(data.ownerPassword),
        role: "owner",
      },
    });
    const subscription = await prisma.subscription.create({
      data: {
        businessId: business.id,
        planId: plan.id,
        status: "active",
        currentPeriodStart: new Date(),
      },
    });

    await recordAudit(req.platformAdmin!.adminId, business.id, "tenant_created", null, {
      businessId: business.id,
      slug: business.slug,
      planCode: plan.code,
      ownerEmail: owner.email,
    });

    res.status(201).json({
      business: { id: business.id, name: business.name, slug: business.slug },
      owner: { id: owner.id, name: owner.name, email: owner.email },
      subscription: { id: subscription.id, planCode: plan.code, status: subscription.status },
    });
  })
);

// GET /api/platform/tenants/:id — detail + agregat (bukan isi struk individual)
platformRouter.get(
  "/tenants/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const business = await prisma.business.findUnique({
      where: { id },
      include: {
        currentPlan: true,
        subscriptions: { orderBy: { createdAt: "desc" }, take: 5, include: { plan: true } },
        users: { where: { active: true }, select: { id: true, name: true, email: true, role: true } },
      },
    });
    if (!business) throw AppError.notFound("Tenant tidak ditemukan");

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [staffCount, tableCount, orders30d, revenue30d] = await Promise.all([
      prisma.user.count({ where: { businessId: id, active: true } }),
      prisma.cafeTable.count({ where: { businessId: id, isActive: true } }),
      prisma.order.count({ where: { businessId: id, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.order.aggregate({
        where: { businessId: id, paymentStatus: "paid", createdAt: { gte: thirtyDaysAgo } },
        _sum: { total: true },
      }),
    ]);
    const auditLogs = await prisma.platformAuditLog.findMany({
      where: { businessId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { platformAdmin: { select: { name: true, email: true } } },
    });

    res.json({
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        email: business.email,
        phone: business.phone,
        address: business.address,
        status: business.status,
        isPlatformSuspended: business.isPlatformSuspended,
        onboardedAt: business.onboardedAt,
        createdAt: business.createdAt,
        featureOverrides: business.featureOverrides,
        platformFee: {
          enabled: business.platformFeeEnabled,
          mode: business.platformFeeMode,
          percent: business.platformFeePercent,
          flat: business.platformFeeFlat,
          bearer: business.platformFeeBearer,
        },
      },
      plan: business.currentPlan,
      subscriptions: business.subscriptions,
      staff: business.users,
      usage: {
        staffCount,
        tableCount,
        orders30d,
        revenue30d: revenue30d._sum.total ?? 0,
      },
      auditLogs,
    });
  })
);

const changePlanSchema = z.object({
  planCode: z.enum(["starter", "pro", "enterprise"]),
});

// PATCH /api/platform/tenants/:id/plan — upgrade/downgrade, data historis TIDAK dihapus
platformRouter.patch(
  "/tenants/:id/plan",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { planCode } = changePlanSchema.parse(req.body);
    const business = await prisma.business.findUnique({
      where: { id },
      include: { currentPlan: true, subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!business) throw AppError.notFound("Tenant tidak ditemukan");
    const plan = await prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw AppError.badRequest("Paket tidak dikenal");

    const before = { planCode: business.currentPlan?.code ?? null };
    const current = business.subscriptions[0];
    if (current) {
      await prisma.subscription.update({ where: { id: current.id }, data: { planId: plan.id } });
    } else {
      await prisma.subscription.create({ data: { businessId: id, planId: plan.id, status: "active" } });
    }
    await prisma.business.update({ where: { id }, data: { currentPlanId: plan.id } });

    await recordAudit(req.platformAdmin!.adminId, id, "plan_changed", before, { planCode });
    res.json({ status: "ok", planCode });
  })
);

const changeStatusSchema = z.object({
  status: z.enum(["active", "past_due", "suspended", "canceled"]),
});

// PATCH /api/platform/tenants/:id/status — suspend/aktifkan (kill-switch independen)
platformRouter.patch(
  "/tenants/:id/status",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { status } = changeStatusSchema.parse(req.body);
    const business = await prisma.business.findUnique({
      where: { id },
      include: { subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!business) throw AppError.notFound("Tenant tidak ditemukan");

    const before = {
      subscriptionStatus: business.subscriptions[0]?.status ?? null,
      isPlatformSuspended: business.isPlatformSuspended,
    };
    const current = business.subscriptions[0];
    if (current) {
      await prisma.subscription.update({ where: { id: current.id }, data: { status } });
    } else {
      const fallbackPlan =
        (business.currentPlanId && (await prisma.plan.findUnique({ where: { id: business.currentPlanId } }))) ??
        (await prisma.plan.findUnique({ where: { code: "starter" } }));
      if (fallbackPlan) {
        await prisma.subscription.create({ data: { businessId: id, planId: fallbackPlan.id, status } });
      }
    }
    await prisma.business.update({
      where: { id },
      data: { isPlatformSuspended: status === "suspended" },
    });

    await recordAudit(req.platformAdmin!.adminId, id, "status_changed", before, {
      subscriptionStatus: status,
      isPlatformSuspended: status === "suspended",
    });
    res.json({ status: "ok", subscriptionStatus: status });
  })
);

const resetPasswordSchema = z.object({
  newPassword: z.string().min(1),
});

// POST /api/platform/tenants/:id/reset-owner-password — bantuan darurat (superadmin only)
platformRouter.post(
  "/tenants/:id/reset-owner-password",
  requirePlatformRole("superadmin"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { newPassword } = resetPasswordSchema.parse(req.body);
    if (!isStrongPassword(newPassword)) {
      throw AppError.badRequest("Password minimal 8 karakter, mengandung huruf, angka, dan simbol");
    }
    const owner = await prisma.user.findFirst({ where: { businessId: id, role: "owner", active: true } });
    if (!owner) throw AppError.notFound("Owner aktif tidak ditemukan");
    await prisma.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(newPassword) } });

    // Password TIDAK pernah masuk audit log.
    await recordAudit(req.platformAdmin!.adminId, id, "owner_password_reset", { ownerEmail: owner.email }, { ownerEmail: owner.email });
    res.json({ status: "ok" });
  })
);

const overridesSchema = z.object({
  // null = hapus key (kembali ke flag paket). Contoh: { selfOrder: true, inventory: false }
  overrides: z.record(z.string(), z.boolean().nullable()),
});

// PATCH /api/platform/tenants/:id/feature-overrides — pengecualian per-key (superadmin + support)
// Keputusan: kedua role boleh toggle fitur (bukan hanya superadmin).
platformRouter.patch(
  "/tenants/:id/feature-overrides",
  requirePlatformRole("superadmin", "support"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { overrides } = overridesSchema.parse(req.body);
    const business = await prisma.business.findUnique({ where: { id } });
    if (!business) throw AppError.notFound("Tenant tidak ditemukan");

    const before = business.featureOverrides;
    const merged = { ...((business.featureOverrides as Record<string, boolean> | null) ?? {}) };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    await prisma.business.update({ where: { id }, data: { featureOverrides: merged } });

    await recordAudit(req.platformAdmin!.adminId, id, "feature_override_changed", before, merged);
    res.json({ status: "ok", featureOverrides: merged });
  })
);

// DELETE /api/platform/tenants/:id/feature-overrides — hapus semua override (superadmin + support)
platformRouter.delete(
  "/tenants/:id/feature-overrides",
  requirePlatformRole("superadmin", "support"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const business = await prisma.business.findUnique({ where: { id } });
    if (!business) throw AppError.notFound("Tenant tidak ditemukan");
    await prisma.business.update({ where: { id }, data: { featureOverrides: {} } });
    await recordAudit(req.platformAdmin!.adminId, id, "feature_override_changed", business.featureOverrides, {});
    res.json({ status: "ok", featureOverrides: {} });
  })
);

const platformFeeSchema = z.object({
  // Config platform fee self-order non-tunai, per kafe (hasil kerja sama).
  // Dua mode: percent (% dari subtotal) atau flat (rupiah per transaksi).
  // Bearer adalah keputusan owner (di halaman Pajak & Biaya) — admin tidak mengubahnya.
  platformFeeEnabled: z.boolean().optional(),
  platformFeeMode: z.enum(["percent", "flat"]).optional(),
  platformFeePercent: z.coerce.number().min(0).max(100).optional(),
  platformFeeFlat: z.coerce.number().min(0).optional(),
});

// PATCH /api/platform/tenants/:id/platform-fee — atur platform fee kafe (superadmin + support).
// Tiap kafe bisa beda (hasil kerja sama). Fee hanya berlaku self_order non-tunai.
// Perubahan dicatat di audit log; order lama TIDAK berubah (snapshot saat dibuat).
platformRouter.patch(
  "/tenants/:id/platform-fee",
  requirePlatformRole("superadmin", "support"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = platformFeeSchema.parse(req.body);
    if (Object.keys(data).length === 0) throw AppError.badRequest("Tidak ada field platform fee yang diubah");
    const business = await prisma.business.findUnique({ where: { id } });
    if (!business) throw AppError.notFound("Tenant tidak ditemukan");

    const before = {
      platformFeeEnabled: business.platformFeeEnabled,
      platformFeeMode: business.platformFeeMode,
      platformFeePercent: business.platformFeePercent,
      platformFeeFlat: business.platformFeeFlat,
    };
    const updated = await prisma.business.update({ where: { id }, data });
    const after = {
      platformFeeEnabled: updated.platformFeeEnabled,
      platformFeeMode: updated.platformFeeMode,
      platformFeePercent: updated.platformFeePercent,
      platformFeeFlat: updated.platformFeeFlat,
    };
    await recordAudit(req.platformAdmin!.adminId, id, "platform_fee_changed", before, after);
    res.json({ status: "ok", platformFee: after });
  })
);

// ================= Plans =================

// GET /api/platform/plans — definisi paket dari DB (+ jumlah tenant per paket)
platformRouter.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const plans = await prisma.plan.findMany({ orderBy: { id: "asc" } });
    const counts = await prisma.business.groupBy({ by: ["currentPlanId"], _count: { id: true } });
    const countByPlan = new Map(counts.map((r) => [r.currentPlanId, r._count.id]));
    res.json({
      plans: plans.map((p) => ({ ...p, tenantCount: countByPlan.get(p.id) ?? 0 })),
      // Fallback statis bila DB belum di-seed — kontrak sama dengan GET /api/public/plans.
      staticFallback: STATIC_PLANS,
    });
  })
);

const updatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  price: z.number().nonnegative().optional(),
  billingCycle: z.enum(["monthly", "yearly", "custom"]).optional(),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  limits: z.record(z.string(), z.number().nullable()).optional(),
  isActive: z.boolean().optional(),
});

// PUT /api/platform/plans/:code — ubah paket (superadmin + support, langsung memengaruhi gating)
platformRouter.put(
  "/plans/:code",
  requirePlatformRole("superadmin", "support"),
  asyncHandler(async (req, res) => {
    const data = updatePlanSchema.parse(req.body);
    const plan = await prisma.plan.findUnique({ where: { code: req.params.code } });
    if (!plan) throw AppError.notFound("Paket tidak dikenal");
    const before = { name: plan.name, price: plan.price, billingCycle: plan.billingCycle, featureFlags: plan.featureFlags, limits: plan.limits, isActive: plan.isActive };
    const updated = await prisma.plan.update({ where: { id: plan.id }, data });
    await recordAudit(req.platformAdmin!.adminId, null, "plan_changed", { code: plan.code, ...before }, { code: plan.code, ...data });
    res.json(updated);
  })
);

// ================= Invoices (manual — MVP, superadmin for write) =================

const invoiceQuerySchema = z.object({
  businessId: z.coerce.number().int().optional(),
  status: z.enum(["unpaid", "paid", "overdue", "void"]).optional(),
});

platformRouter.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const { businessId, status } = invoiceQuerySchema.parse(req.query);
    const invoices = await prisma.invoice.findMany({
      where: { ...(businessId ? { businessId } : {}), ...(status ? { status } : {}) },
      include: { business: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ invoices });
  })
);

const createInvoiceSchema = z.object({
  businessId: z.number().int(),
  amount: z.number().positive(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  dueDate: z.string().optional(),
  note: z.string().max(500).optional(),
});

function buildInvoiceNumber(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `INV-${ym}-${rand}`;
}

platformRouter.post(
  "/invoices",
  requirePlatformRole("superadmin"),
  asyncHandler(async (req, res) => {
    const data = createInvoiceSchema.parse(req.body);
    const business = await prisma.business.findUnique({
      where: { id: data.businessId },
      include: { subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!business) throw AppError.notFound("Tenant tidak ditemukan");

    let invoiceNumber = buildInvoiceNumber();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const invoice = await prisma.invoice.create({
          data: {
            businessId: data.businessId,
            subscriptionId: business.subscriptions[0]?.id ?? null,
            invoiceNumber,
            amount: data.amount,
            status: "unpaid",
            periodStart: data.periodStart ? new Date(data.periodStart) : null,
            periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
          },
        });
        return res.status(201).json(invoice);
      } catch {
        invoiceNumber = buildInvoiceNumber();
      }
    }
    throw AppError.badRequest("Gagal membuat nomor invoice unik, coba lagi");
  })
);

const payInvoiceSchema = z.object({
  paidNote: z.string().max(500).optional(),
});

// PATCH /api/platform/invoices/:id/pay — tandai lunas manual (superadmin only)
platformRouter.patch(
  "/invoices/:id/pay",
  requirePlatformRole("superadmin"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { paidNote } = payInvoiceSchema.parse(req.body);
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw AppError.notFound("Invoice tidak ditemukan");
    if (invoice.status === "paid") throw AppError.badRequest("Invoice sudah lunas");

    const before = { status: invoice.status };
    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: "paid", paidAt: new Date(), paidNote: paidNote ?? null },
    });
    await recordAudit(req.platformAdmin!.adminId, invoice.businessId, "invoice_marked_paid", before, {
      status: "paid",
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
    });
    res.json(updated);
  })
);

// GET /api/platform/invoices/export.csv — export CSV (pola export analytics Fase 2)
platformRouter.get(
  "/invoices/export.csv",
  asyncHandler(async (req, res) => {
    const { businessId } = invoiceQuerySchema.parse(req.query);
    const invoices = await prisma.invoice.findMany({
      where: { ...(businessId ? { businessId } : {}) },
      include: { business: { select: { name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      "invoice_number,business,slug,amount,status,period_start,period_end,due_date,paid_at,created_at",
      ...invoices.map((i) =>
        [
          i.invoiceNumber,
          i.business.name,
          i.business.slug,
          i.amount,
          i.status,
          i.periodStart?.toISOString().slice(0, 10),
          i.periodEnd?.toISOString().slice(0, 10),
          i.dueDate?.toISOString().slice(0, 10),
          i.paidAt?.toISOString(),
          i.createdAt.toISOString(),
        ]
          .map(esc)
          .join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"invoices.csv\"");
    res.send(lines.join("\n"));
  })
);

// ================= Landing content (CMS ringan) =================

platformRouter.get(
  "/landing-content",
  asyncHandler(async (_req, res) => {
    const sections = await prisma.landingSection.findMany({ orderBy: { sortOrder: "asc" } });
    res.json({ sections });
  })
);

const upsertContentSchema = z.object({
  sections: z
    .array(
      z.object({
        sectionKey: z.enum(["hero", "features", "faq", "cta", "contact", "services", "home"]),
        content: z.record(z.string(), z.unknown()),
        sortOrder: z.number().int().optional(),
        isPublished: z.boolean().optional(),
      })
    )
    .min(1),
});

// PUT /api/platform/landing-content — simpan + publish konten landing
platformRouter.put(
  "/landing-content",
  asyncHandler(async (req, res) => {
    const { sections } = upsertContentSchema.parse(req.body);
    const before = await prisma.landingSection.findMany();
    for (const s of sections) {
      await prisma.landingSection.upsert({
        where: { sectionKey: s.sectionKey },
        create: {
          sectionKey: s.sectionKey,
          content: s.content as object,
          sortOrder: s.sortOrder ?? 0,
          isPublished: s.isPublished ?? true,
          updatedByAdminId: req.platformAdmin!.adminId,
        },
        update: {
          content: s.content as object,
          ...(s.sortOrder !== undefined ? { sortOrder: s.sortOrder } : {}),
          ...(s.isPublished !== undefined ? { isPublished: s.isPublished } : {}),
          updatedByAdminId: req.platformAdmin!.adminId,
        },
      });
    }
    const after = await prisma.landingSection.findMany();
    await recordAudit(req.platformAdmin!.adminId, null, "landing_content_updated", before, after);
    res.json({ sections: after });
  })
);

// ================= Analytics & audit & leads =================

// GET /api/platform/analytics/overview — tenant per paket, baru per bulan, MRR
platformRouter.get(
  "/analytics/overview",
  asyncHandler(async (_req, res) => {
    const [perPlan, activeSubs, recentBusinesses] = await Promise.all([
      prisma.business.groupBy({ by: ["currentPlanId"], _count: { id: true } }),
      prisma.subscription.findMany({ where: { status: "active" }, include: { plan: true } }),
      prisma.business.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) } },
        select: { createdAt: true },
      }),
    ]);
    const plans = await prisma.plan.findMany();
    const nameById = new Map(plans.map((p) => [p.id, p.code]));
    const byMonth = new Map<string, number>();
    for (const b of recentBusinesses) {
      const key = b.createdAt.toISOString().slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }
    let mrr = 0;
    for (const s of activeSubs) {
      if (s.plan.billingCycle === "yearly") mrr += Number(s.plan.price) / 12;
      else if (s.plan.billingCycle === "monthly") mrr += Number(s.plan.price);
    }
    res.json({
      tenantsPerPlan: perPlan.map((r) => ({ planCode: r.currentPlanId ? (nameById.get(r.currentPlanId) ?? null) : null, count: r._count.id })),
      newTenantsByMonth: [...byMonth.entries()].sort().map(([month, count]) => ({ month, count })),
      mrr: Math.round(mrr),
      activeSubscriptions: activeSubs.length,
    });
  })
);

const auditQuerySchema = z.object({
  businessId: z.coerce.number().int().optional(),
  action: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

platformRouter.get(
  "/audit-logs",
  asyncHandler(async (req, res) => {
    const { businessId, action, limit } = auditQuerySchema.parse(req.query);
    const logs = await prisma.platformAuditLog.findMany({
      where: { ...(businessId ? { businessId } : {}), ...(action ? { action } : {}) },
      include: {
        platformAdmin: { select: { name: true, email: true } },
        business: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit ?? 100,
    });
    res.json({ logs });
  })
);

// GET /api/platform/leads — tinjau lead masuk (PRD §5.1)
platformRouter.get(
  "/leads",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const leads = await prisma.lead.findMany({
      where: { ...(status ? { status } : {}) },
      include: { interestedPlan: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ leads });
  })
);

const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "onboarded", "rejected"]),
});

platformRouter.patch(
  "/leads/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { status } = updateLeadSchema.parse(req.body);
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw AppError.notFound("Lead tidak ditemukan");
    const updated = await prisma.lead.update({ where: { id }, data: { status } });
    await recordAudit(req.platformAdmin!.adminId, null, "lead_status_changed", { leadId: id, status: lead.status }, { leadId: id, status });
    res.json(updated);
  })
);
