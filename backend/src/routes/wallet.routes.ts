import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/error-handler";
import { AppError } from "../lib/errors";
import {
  getOrCreateWallet,
  requestPayout,
  updateWalletBankAccount,
  updateWalletPayoutSettings,
} from "../services/wallet.service";
import { inquiryBankAccount } from "../services/doku-inquiry.service";
import { prisma } from "../lib/prisma";

export const walletRouter = Router();

// Semua endpoint wallet butuh auth owner/manager kafe
walletRouter.use(requireAuth);
walletRouter.use(requireRole("owner"));

/**
 * GET /api/wallet
 * Dapatkan informasi saldo, rekening bank terdaftar, riwayat transaksi, dan status payout
 */
walletRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const wallet = await getOrCreateWallet(businessId);

    // Ambil riwayat lengkap
    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const payouts = await prisma.payoutRequest.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json({
      wallet: {
        id: wallet.id,
        availableBalance: Number(wallet.availableBalance),
        pendingBalance: Number(wallet.pendingBalance),
        bankCode: wallet.bankCode,
        bankAccount: wallet.bankAccount,
        accountName: wallet.accountName,
        isBankVerified: wallet.isBankVerified,
        bankVerifiedAt: wallet.bankVerifiedAt,
        autoPayoutEnabled: wallet.autoPayoutEnabled,
        payoutFrequency: wallet.payoutFrequency,
        payoutDay: wallet.payoutDay,
        minimumPayout: Number(wallet.minimumPayout),
        holdMinBalance: Number(wallet.holdMinBalance),
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
        referenceId: t.referenceId,
        description: t.description,
        createdAt: t.createdAt,
      })),
      payouts: payouts.map((p) => ({
        id: p.id,
        requestNumber: p.requestNumber,
        source: p.source,
        amount: Number(p.amount),
        bankCode: p.bankCode,
        bankAccount: p.bankAccount,
        accountName: p.accountName,
        status: p.status,
        rejectionReason: p.rejectionReason,
        bankRefNumber: p.bankRefNumber,
        proofImageUrl: p.proofImageUrl,
        createdAt: p.createdAt,
        processedAt: p.processedAt,
      })),
    });
  })
);

const verifyBankSchema = z.object({
  bankCode: z.string().min(1, "Kode bank wajib diisi"),
  bankAccount: z.string().min(4, "Nomor rekening minimal 4 digit"),
});

/**
 * POST /api/wallet/verify-bank
 * Verifikasi nomor rekening via DOKU API dan simpan jika valid
 */
walletRouter.post(
  "/verify-bank",
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { bankCode, bankAccount } = verifyBankSchema.parse(req.body);

    // Panggil DOKU Account Inquiry
    const result = await inquiryBankAccount({ bankCode, bankAccount });

    // Simpan ke database wallet
    const updated = await updateWalletBankAccount(businessId, {
      bankCode: result.bankCode,
      bankAccount: result.bankAccount,
      accountName: result.accountName,
      isVerified: true,
    });

    res.json({
      message: "Rekening bank berhasil diverifikasi dan disimpan",
      bank: {
        bankCode: updated.bankCode,
        bankAccount: updated.bankAccount,
        accountName: updated.accountName,
        isBankVerified: updated.isBankVerified,
      },
    });
  })
);

const settingsSchema = z.object({
  autoPayoutEnabled: z.boolean().optional(),
  payoutFrequency: z.enum(["manual", "daily", "weekly", "monthly"]).optional(),
  payoutDay: z.number().int().min(1).max(31).nullable().optional(),
  minimumPayout: z.number().min(10000).optional(),
  holdMinBalance: z.number().min(0).optional(),
});

/**
 * PUT /api/wallet/settings
 * Perbarui preferensi jadwal pencairan otomatis & batas minimum
 */
walletRouter.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const data = settingsSchema.parse(req.body);

    const updated = await updateWalletPayoutSettings(businessId, data);

    res.json({
      message: "Pengaturan pencairan dana berhasil diperbarui",
      settings: {
        autoPayoutEnabled: updated.autoPayoutEnabled,
        payoutFrequency: updated.payoutFrequency,
        payoutDay: updated.payoutDay,
        minimumPayout: Number(updated.minimumPayout),
        holdMinBalance: Number(updated.holdMinBalance),
      },
    });
  })
);

const requestPayoutSchema = z.object({
  amount: z.number().positive("Nominal harus lebih dari 0"),
});

/**
 * POST /api/wallet/payout
 * Owner mengajukan penarikan dana on-demand
 */
walletRouter.post(
  "/payout",
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { amount } = requestPayoutSchema.parse(req.body);

    const payout = await requestPayout({
      businessId,
      amount,
      source: "on_demand",
    });

    res.status(201).json({
      message: "Permintaan penarikan dana berhasil diajukan dan sedang diproses admin",
      payout: {
        id: payout.id,
        requestNumber: payout.requestNumber,
        amount: Number(payout.amount),
        status: payout.status,
        createdAt: payout.createdAt,
      },
    });
  })
);
