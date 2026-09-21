import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
import { asyncHandler } from "../middleware/error-handler";
import { requireAuth, requireRole } from "../middleware/auth";
import { FEATURES, getBusinessFeatures, isFeatureOn } from "../lib/feature-gate";
import { encrypt, isEncrypted } from "../lib/encryption";
import { emitBusinessCashUpdate, emitBusinessUpdated } from "../lib/realtime";

export const businessRouter = Router();
businessRouter.use(requireAuth);

// GET /api/business — profil bisnis milik user yang login (semua role boleh baca)
businessRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const business = await prisma.business.findUnique({ where: { id: req.auth!.businessId } });
    if (!business) throw AppError.notFound("Bisnis tidak ditemukan");
    const { midtransServerKeyEnc: _enc, ...safe } = business as unknown as Record<string, unknown> & { midtransServerKeyEnc?: string };
    // Flag fitur efektif (untuk FE sembunyikan menu, mis. serviceCharge/taxFees).
    // Gagal resolve (mis. suspended) -> tetap kembalikan profil tanpa features.
    let features: Record<string, boolean> | undefined;
    try {
      const resolved = await getBusinessFeatures(req.auth!.businessId);
      features = resolved.flags;
    } catch {}
    res.json({ ...safe, hasMidtransCustomKey: Boolean(_enc), midtransServerKeyEnc: undefined, ...(features ? { features } : {}) });
  })
);

const paymentSettingsValueSchema = z.object({
  // Deprecated: non-cash SELALU via Midtrans (default paksa server) dan instruksi
  // pelanggan dihapus dari UI. Tetap diterima agar payload lama tidak error,
  // tapi DIABAIKAN backend.
  instruction: z.string().max(800).optional(),
  qrImageUrl: z.string().optional(),
  bankName: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  accountName: z.string().max(100).optional(),
  wallets: z.array(z.string()).optional(),
  gateway: z.enum(["manual", "midtrans"]).optional(),
  // Deprecated: tidak lagi dikirim ke Midtrans (ikut default gopay).
  // Tetap diterima agar payload lama tidak error, tapi diabaikan backend.
  acquirer: z.string().optional(),
  bank: z.enum(["bca", "mandiri", "bni", "bri"]).optional(),
  allowedBanks: z.array(z.enum(["bca", "mandiri", "bni", "bri"])).optional(),
  // Dormant: ewallet dihapus dari produk (tak ada UI). Tetap diterima agar payload lama tidak error.
  channel: z.enum(["gopay", "shopeepay"]).optional(),
});

const updateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  tagline: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  logoUrl: z.string().optional(),
  taxEnabled: z.boolean().optional(),
  taxLabel: z.enum(["PB1", "PBJT", "PPN"]).optional(),
  taxRate: z.number().min(0).max(100).optional(), // persen, mis. 10 = 10%
  taxBearer: z.enum(["customer", "cafe"]).optional(),
  serviceChargeEnabled: z.boolean().optional(),
  serviceChargeRate: z.number().min(0).max(100).optional(), // persen
  // Service charge independen dari pajak & flag: mode percent (% subtotal) / flat (Rp per transaksi).
  serviceChargeMode: z.enum(["percent", "flat"]).optional(),
  serviceChargeFlat: z.coerce.number().min(0).optional(),
  // Bearer platform fee boleh diubah owner (pilihan di halaman Pajak & Biaya),
  // tetapi hanya saat flag taxFees ON. Nilai persen/flat/enabled HANYA via Platform Admin.
  platformFeeBearer: z.enum(["customer", "cafe"]).optional(),
  soundEnabled: z.boolean().optional(),
  openingCash: z.number().min(0).optional(),
  qrTemplate: z.record(z.any()).nullable().optional(),
  theme: z.record(z.any()).nullable().optional(),
  enabledPaymentMethods: z
    .array(z.enum(["cash", "qris", "bank_transfer"]))
    .min(1, "Minimal 1 metode pembayaran harus aktif")
    .optional(),
  paymentSettings: z.record(paymentSettingsValueSchema).optional(),
  midtransMode: z.enum(["global", "custom"]).optional(),
  midtransServerKey: z.string().min(10).optional(),
  midtransClientKey: z.string().optional(),
  // Deprecated: tidak dipakai lagi (Midtrans default gopay). Tetap diterima opsional.
  midtransQrisAcquirer: z.string().optional(),
});

// PATCH /api/business/cash-settings — modal kas & suara (kasir/barista/owner).
// Dipisah dari PUT / (owner-only) agar kasir bisa buka-tutup shift tanpa bisa
// mengubah pajak, harga, maupun pengaturan pembayaran.
// - openingCash: set saat buka shift (sekaligus me-reset closing -> shift baru terbuka)
// - closingCash: set saat tutup shift (null = buka kembali shift)
const cashSettingsSchema = z.object({
  openingCash: z.coerce.number().min(0).optional(),
  closingCash: z.coerce.number().min(0).nullable().optional(),
  soundEnabled: z.boolean().optional(),
});

businessRouter.patch(
  "/cash-settings",
  requireRole("owner", "kasir", "barista"),
  asyncHandler(async (req, res) => {
    const data = cashSettingsSchema.parse(req.body);
    if (Object.keys(data).length === 0) throw AppError.badRequest("Tidak ada field yang diubah");

    const prismaData: Record<string, unknown> = { ...data };
    if (data.openingCash !== undefined) {
      // Buka shift baru: reset closing sebelumnya
      prismaData.closingCash = null;
      prismaData.cashClosedAt = null;
    }
    if (data.closingCash !== undefined && data.closingCash !== null) {
      prismaData.cashClosedAt = new Date();
    }
    if (data.closingCash === null) {
      prismaData.cashClosedAt = null;
    }

    const updated = await prisma.business.update({
      where: { id: req.auth!.businessId },
      data: prismaData,
    });
    emitBusinessCashUpdate(req.auth!.businessId, {
      openingCash: updated.openingCash,
      closingCash: updated.closingCash,
      cashClosedAt: updated.cashClosedAt,
      soundEnabled: updated.soundEnabled,
    });
    res.json({
      openingCash: updated.openingCash,
      closingCash: updated.closingCash,
      cashClosedAt: updated.cashClosedAt,
      soundEnabled: updated.soundEnabled,
    });
  })
);

// PUT /api/business — update profil/identitas/pajak/service charge (khusus owner).
// Field `theme` di-gate flag themePreset (Starter tanpa tema -> 403 bila mengirim theme).
// Field pajak (`taxEnabled/taxLabel/taxRate/taxBearer`) di-gate flag taxFees
// (OFF -> 403 bila mengirim field tsb).
// Field service charge (enabled/rate/mode/flat) di-gate flag serviceCharge
// (OFF -> 403 bila mengirim field tsb) — granular per keputusan admin, bukan 1 flag.
const TAX_FIELDS = [
  "taxEnabled",
  "taxLabel",
  "taxRate",
  "taxBearer",
] as const;
const SERVICE_CHARGE_FIELDS = [
  "serviceChargeEnabled",
  "serviceChargeRate",
  "serviceChargeMode",
  "serviceChargeFlat",
] as const;
businessRouter.put(
  "/",
  requireRole("owner"),
  asyncHandler(async (req, res, next) => {
    if ((req.body as { theme?: unknown })?.theme !== undefined) {
      const { flags } = await getBusinessFeatures(req.auth!.businessId);
      // Tulis tema butuh preset ATAU custom (Starter keduanya false -> 403).
      // Fail-open untuk key hilang (tenant lama pra-kanon tidak terkunci).
      const canTheme = isFeatureOn(flags, FEATURES.THEME_PRESET) || isFeatureOn(flags, FEATURES.THEME_CUSTOM);
      if (!canTheme) {
        throw AppError.forbidden(
          "Fitur tema tidak termasuk paket kafe Anda. Hubungi tim sales Ordria untuk upgrade."
        );
      }
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (TAX_FIELDS.some((f) => body[f] !== undefined)) {
      const { flags } = await getBusinessFeatures(req.auth!.businessId);
      if (!isFeatureOn(flags, FEATURES.TAX_FEES)) {
        throw AppError.forbidden(
          "Fitur Pajak sedang nonaktif untuk kafe Anda. Hubungi tim admin Ordria untuk mengaktifkan."
        );
      }
    }
    if (SERVICE_CHARGE_FIELDS.some((f) => body[f] !== undefined)) {
      const { flags } = await getBusinessFeatures(req.auth!.businessId);
      if (!isFeatureOn(flags, FEATURES.SERVICE_CHARGE)) {
        throw AppError.forbidden(
          "Fitur Service Charge sedang nonaktif untuk kafe Anda. Hubungi tim admin Ordria untuk mengaktifkan."
        );
      }
    }
    // Bearer fee aplikasi keputusan owner — lolos bila flag pajak ON *atau* fee sedang menyala.
    // (Halaman Pajak & Biaya ikut terbuka saat fee on, walau kedua flag mati.)
    if (body.platformFeeBearer !== undefined) {
      const { flags } = await getBusinessFeatures(req.auth!.businessId);
      const biz = await prisma.business.findUnique({
        where: { id: req.auth!.businessId },
        select: { platformFeeEnabled: true },
      });
      if (!isFeatureOn(flags, FEATURES.TAX_FEES) && !biz?.platformFeeEnabled) {
        throw AppError.forbidden(
          "Fitur Pajak & Biaya sedang nonaktif untuk kafe Anda. Hubungi tim admin Ordria untuk mengaktifkan."
        );
      }
    }
    next();
  }),
  asyncHandler(async (req, res) => {
    const data = updateBusinessSchema.parse(req.body);
    const { midtransServerKey, midtransClientKey, midtransQrisAcquirer, midtransMode, ...rest } = data as typeof data & {
      midtransServerKey?: string;
      midtransClientKey?: string;
      midtransQrisAcquirer?: string;
      midtransMode?: string;
    };
    const prismaData: Record<string, unknown> = { ...rest };
    if (midtransMode !== undefined) prismaData.midtransMode = midtransMode;
    if (midtransQrisAcquirer !== undefined) prismaData.midtransQrisAcquirer = midtransQrisAcquirer;
    if (midtransClientKey !== undefined) prismaData.midtransClientKey = midtransClientKey;
    if (midtransServerKey !== undefined) {
      const trimmed = midtransServerKey.trim();
      if (trimmed.length > 0 && !isEncrypted(trimmed)) {
        prismaData.midtransServerKeyEnc = encrypt(trimmed);
      }
    }
    const updated = await prisma.business.update({
      where: { id: req.auth!.businessId },
      data: prismaData,
    });
    // Jangan expose encrypted key ke FE
    const { midtransServerKeyEnc: _enc, ...safe } = updated as unknown as Record<string, unknown> & { midtransServerKeyEnc?: string };
    let features: Record<string, boolean> | undefined;
    try {
      features = (await getBusinessFeatures(req.auth!.businessId)).flags;
    } catch {}
    emitBusinessUpdated(req.auth!.businessId, { ...safe, hasMidtransCustomKey: Boolean(_enc) });
    res.json({ ...safe, hasMidtransCustomKey: Boolean(_enc), ...(features ? { features } : {}) });
  })
);
