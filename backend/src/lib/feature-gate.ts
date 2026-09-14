import { NextFunction, Request, Response } from "express";
import { prisma } from "./prisma";
import { AppError } from "./errors";
import { PLANS as STATIC_PLANS } from "./plans";

// Flag fitur sesuai PRD SaaS §3 (kunci di plans.feature_flags).
// Kanon full kill-switch (offlineSync disengaja TIDAK di-gate: belum ada endpoint /sync khusus).
export const FEATURES = {
  SELF_ORDER: "selfOrder",
  TABLE_MANAGEMENT: "tableManagement",
  INVENTORY: "inventory",
  OFFLINE_SYNC: "offlineSync",
  ANALYTICS_FULL: "analyticsFull",
  SALES_TYPE: "salesType",
  PERFORMANCE_ITEM: "performanceItem",
  EXPORT_CSV: "exportCsv",
  THEME_PRESET: "themePreset",
  THEME_CUSTOM: "themeCustom",
  // Pajak & Biaya (tax + service charge). OFF = total murni subtotal.
  // Dikontrol Platform Admin via plans.feature_flags + featureOverrides.
  TAX_AND_FEES: "taxAndFees",
} as const;

export type ResolvedFeatures = {
  planCode: string | null;
  flags: Record<string, boolean>;
};

/**
 * Resolve flag fitur efektif tenant: plans.feature_flags + merge
 * businesses.feature_overrides (override menang per-key, PRD §4.2).
 * Tanpa paket (pra-SaaS) -> semua true agar operasional lama tidak terkunci.
 */
export async function getBusinessFeatures(businessId: number): Promise<ResolvedFeatures> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { currentPlan: true },
  });
  if (!business) throw AppError.notFound("Bisnis tidak ditemukan");
  if (business.isPlatformSuspended) {
    throw AppError.forbidden("Akun kafe dinonaktifkan. Hubungi tim Ordria.");
  }

  let flags: Record<string, boolean> = {};
  let planCode: string | null = null;
  if (business.currentPlan) {
    planCode = business.currentPlan.code;
    flags = { ...((business.currentPlan.featureFlags as Record<string, boolean>) ?? {}) };
  } else {
    // Fallback: paket Pro statis (perilaku pra-SaaS = semua fitur Fase 2 aktif).
    const pro = STATIC_PLANS.find((p) => p.code === "pro");
    flags = { ...(pro?.featureFlags ?? {}) };
    planCode = "pro";
  }

  const overrides = (business.featureOverrides as Record<string, boolean> | null) ?? {};
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "boolean") flags[key] = value;
  }
  return { planCode, flags };
}

function deny(flag: string) {
  return AppError.forbidden(
    `Fitur ini tidak termasuk paket kafe Anda (${flag}). Hubungi tim sales Ordria untuk upgrade.`
  );
}

/**
 * Cek flag efektif dengan semantik fail-open/closed yang disepakati:
 * - taxAndFees: fail-closed (hilang/undefined = OFF) agar total murni default.
 * - flag lain: fail-open (hilang/undefined = ON) agar tenant lama yang baris
 *   plans-nya belum punya key baru tidak tiba-tiba terkunci sebelum backfill.
 */
export function isFeatureOn(flags: Record<string, boolean>, flag: string): boolean {
  if (flag === FEATURES.TAX_AND_FEES) return flags[flag] === true;
  return flags[flag] !== false;
}

/**
 * Gate untuk router staff (setelah requireAuth): req.auth.businessId wajib punya flag.
 * Memakai isFeatureOn agar konsisten dengan semantik fail-open/closed.
 * Pola Express idiomatis (Context7 /expressjs/express): middleware reusable yang
 * meneruskan 403 via next() ke centralized error handler.
 */
export function requireFeature(flag: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) return next(AppError.unauthorized());
      const { flags } = await getBusinessFeatures(req.auth.businessId);
      if (!isFeatureOn(flags, flag)) return next(deny(flag));
      return next();
    } catch (e) {
      return next(e);
    }
  };
}

/**
 * Gate untuk checkout self-order publik: businessId di-resolve dari body.qrToken.
 * Dipakai POST /api/public/orders & recharge (kasir manual via /api/orders TIDAK di-gate).
 */
export function requirePublicFeature(flag: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const qrToken = (req.body as { qrToken?: unknown })?.qrToken;
      if (flag === FEATURES.SELF_ORDER && typeof qrToken === "string" && qrToken.length > 0) {
        const table = await prisma.cafeTable.findUnique({ where: { qrToken } });
        if (table) {
          const { flags } = await getBusinessFeatures(table.businessId);
          if (!isFeatureOn(flags, flag)) return next(deny(flag));
        }
      }
      return next();
    } catch (e) {
      return next(e);
    }
  };
}
