import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";
type Tx = Prisma.TransactionClient;
export interface PayoutSettingsInput {
  autoPayoutEnabled?: boolean;
  payoutFrequency?: "manual" | "daily" | "weekly" | "monthly";
  payoutDay?: number | null;
  minimumPayout?: number;
  holdMinBalance?: number;
}
export interface BankAccountInput {
  bankCode: string;
  bankAccount: string;
  accountName: string;
}
function money(n: number, zero = false) {
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1))
    throw AppError.badRequest("Nominal harus rupiah utuh yang valid");
}
async function lockWallet(tx: Tx, businessId: number) {
  await tx.$queryRaw`SELECT id FROM merchant_wallets WHERE business_id = ${businessId} FOR UPDATE`;
  const wallet = await tx.merchantWallet.findUnique({ where: { businessId } });
  if (!wallet)
    throw AppError.notFound("Dompet merchant belum dibuat");
  return wallet;
}
async function lockPayout(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM payout_requests WHERE id = ${id} FOR UPDATE`;
  const params = await tx.payoutRequest.findUnique({ where: { id } });
  if (!params)
    throw AppError.notFound("Tiket pencairan tidak ditemukan");
  return params;
}
export async function getOrCreateWallet(businessId: number) {
  return prisma.merchantWallet.upsert({
    where: { businessId },
    create: { businessId },
    update: {}
  });
}
export async function creditOrderInflow(params: {
  businessId: number;
  netAmount: number;
  orderNumber: string;
  paymentId: number;
  description?: string;
}, callerTx?: Tx) {
  money(params.netAmount, true);
  const run = async (tx: Tx) => {
    await tx.merchantWallet.upsert({
      where: { businessId: params.businessId },
      create: { businessId: params.businessId },
      update: {}
    });
    const wallet = await lockWallet(tx, params.businessId);
    const key = `payment:${params.paymentId}:inflow`;
    const existing = await tx.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        OR: [{ idempotencyKey: key }, {
            type: "ORDER_INFLOW",
            referenceId: params.orderNumber
          }]
      }
    });
    if (existing)
      return wallet;
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "ORDER_INFLOW",
        amount: params.netAmount,
        balanceBefore: wallet.pendingBalance,
        balanceAfter: Number(wallet.pendingBalance) + params.netAmount,
        referenceId: params.orderNumber,
        idempotencyKey: key,
        description: params.description || "Menunggu rekonsiliasi settlement"
      }
    });
    return tx.merchantWallet.update({
      where: { id: wallet.id },
      data: { pendingBalance: { increment: params.netAmount } }
    });
  };
  return callerTx ? run(callerTx) : prisma.$transaction(run);
}
export async function updateWalletBankAccount(businessId: number, params: BankAccountInput) {
  await getOrCreateWallet(businessId);
  return prisma.$transaction(async (tx) => {
    const wallet = await lockWallet(tx, businessId);
    return tx.merchantWallet.update({
      where: { id: wallet.id },
      data: {
        bankCode: params.bankCode.trim(),
        bankAccount: params.bankAccount.trim(),
        accountName: params.accountName.trim(),
        isBankVerified: false,
        bankVerifiedAt: null
      }
    });
  });
}
export async function verifyWalletBank(params: {
  businessId: number;
  adminId: number;
  bankCode: string;
  bankAccount: string;
  accountName: string;
  evidence: string;
}) {
  if (!params.evidence.trim() || !params.accountName.trim())
    throw AppError.badRequest("Nama dan bukti wajib diisi");
  return prisma.$transaction(async (tx) => {
    const wallet = await lockWallet(tx, params.businessId);
    if (!wallet.bankCode || !wallet.bankAccount || !wallet.accountName)
      throw AppError.badRequest("Merchant belum mengajukan rekening");
    if (wallet.bankCode !== params.bankCode || wallet.bankAccount !== params.bankAccount) {
      throw AppError.conflict("Rekening berubah sejak pemeriksaan; muat ulang dan periksa rekening terbaru");
    }
    if (wallet.accountName.trim().toUpperCase() !== params.accountName.trim().toUpperCase())
      throw AppError.badRequest("Nama rekening tidak cocok dengan pengajuan merchant");
    const updated = await tx.merchantWallet.update({
      where: { id: wallet.id },
      data: {
        isBankVerified: true,
        bankVerifiedAt: new Date()
      }
    });
    await tx.platformAuditLog.create({
      data: {
        platformAdminId: params.adminId,
        businessId: params.businessId,
        action: "wallet_bank_verified",
        before: {
          bankCode: wallet.bankCode,
          bankAccount: wallet.bankAccount,
          accountName: wallet.accountName
        },
        after: {
          evidence: params.evidence,
          accountName: params.accountName
        }
      }
    });
    return updated;
  });
}
export async function updateWalletPayoutSettings(businessId: number, params: PayoutSettingsInput) {
  await getOrCreateWallet(businessId);
  if (params.minimumPayout !== undefined)
    money(params.minimumPayout);
  if (params.holdMinBalance !== undefined)
    money(params.holdMinBalance, true);
  return prisma.$transaction(async (tx) => {
    const wallet = await lockWallet(tx, businessId);
    const frequency = params.payoutFrequency ?? wallet.payoutFrequency;
    const day = params.payoutDay !== undefined ? params.payoutDay : wallet.payoutDay;
    if (frequency === "weekly" && day !== null && (day < 0 || day > 6))
      throw AppError.badRequest("Hari mingguan harus 0-6");
    if (frequency === "monthly" && day !== null && (day < 1 || day > 31))
      throw AppError.badRequest("Tanggal bulanan harus 1-31");
    return tx.merchantWallet.update({
      where: { id: wallet.id },
      data: params
    });
  });
}
export async function requestPayout(params: {
  businessId: number;
  amount: number;
  source?: "on_demand" | "scheduled";
  scheduleKey?: string;
}) {
  money(params.amount);
  return prisma.$transaction(async (tx) => {
    const wallet = await lockWallet(tx, params.businessId);
    if (params.scheduleKey) {
      const existing = await tx.payoutRequest.findUnique({ where: { scheduleKey: params.scheduleKey } });
      if (existing)
        return existing;
    }
    if (!wallet.isBankVerified || !wallet.bankAccount || !wallet.bankCode || !wallet.accountName)
      throw AppError.badRequest("Rekening bank belum terverifikasi");
    const before = Number(wallet.availableBalance);
    if (params.amount < Number(wallet.minimumPayout))
      throw AppError.badRequest("Nominal di bawah minimum pencairan");
    if (params.amount > before - Number(wallet.holdMinBalance))
      throw AppError.badRequest("Saldo yang dapat ditarik tidak mencukupi");
    const requestNumber = `PO-${randomUUID()}`;
    const payout = await tx.payoutRequest.create({
      data: {
        walletId: wallet.id,
        requestNumber,
        source: params.source ?? "on_demand",
        scheduleKey: params.scheduleKey,
        amount: params.amount,
        bankCode: wallet.bankCode,
        bankAccount: wallet.bankAccount,
        accountName: wallet.accountName,
        status: "pending"
      }
    });
    await tx.merchantWallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: { decrement: params.amount },
        reservedBalance: { increment: params.amount }
      }
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PAYOUT_DEDUCTION",
        amount: params.amount,
        balanceBefore: before,
        balanceAfter: before - params.amount,
        referenceId: requestNumber,
        idempotencyKey: `payout:${payout.id}:reserve`,
        description: "Dana ditahan untuk pencairan manual"
      }
    });
    return payout;
  });
}
export async function processPayout(params: {
  payoutId: number;
  adminId: number;
}) {
  return prisma.$transaction(async (tx) => {
    const payout = await lockPayout(tx, params.payoutId);
    if (payout.status !== "pending")
      throw AppError.badRequest("Hanya pencairan pending dapat diproses");
    return tx.payoutRequest.update({
      where: { id: payout.id },
      data: {
        status: "processing",
        processedByAdminId: params.adminId
      }
    });
  });
}
export async function completePayout(params: {
  payoutId: number;
  adminId: number;
  bankRefNumber: string;
  proofImageUrl?: string;
}) {
  if (!params.bankRefNumber.trim() || !params.proofImageUrl?.trim())
    throw AppError.badRequest("Referensi bank dan bukti transfer wajib diisi");
  return prisma.$transaction(async (tx) => {
    const payout = await lockPayout(tx, params.payoutId);
    if (payout.status !== "processing")
      throw AppError.badRequest("Pencairan harus dalam status processing");
    await tx.$queryRaw`SELECT id FROM merchant_wallets WHERE id = ${payout.walletId} FOR UPDATE`;
    const changed = await tx.merchantWallet.updateMany({
      where: {
        id: payout.walletId,
        reservedBalance: { gte: payout.amount }
      },
      data: { reservedBalance: { decrement: payout.amount } }
    });
    if (changed.count !== 1)
      throw AppError.conflict("Saldo tertahan tidak cukup; rekonsiliasi historis diperlukan");
    return tx.payoutRequest.update({
      where: { id: payout.id },
      data: {
        status: "completed",
        bankRefNumber: params.bankRefNumber,
        proofImageUrl: params.proofImageUrl,
        processedByAdminId: params.adminId,
        processedAt: new Date()
      }
    });
  });
}
export async function rejectPayout(params: {
  payoutId: number;
  adminId: number;
  reason: string;
}) {
  return prisma.$transaction(async (tx) => {
    const payout = await lockPayout(tx, params.payoutId);
    if (!["pending", "processing"].includes(payout.status))
      throw AppError.badRequest("Pencairan tidak dapat ditolak");
    await tx.$queryRaw`SELECT id FROM merchant_wallets WHERE id = ${payout.walletId} FOR UPDATE`;
    const wallet = await tx.merchantWallet.findUniqueOrThrow({ where: { id: payout.walletId } }), amount = Number(payout.amount);
    const changed = await tx.merchantWallet.updateMany({
      where: {
        id: wallet.id,
        reservedBalance: { gte: amount }
      },
      data: {
        reservedBalance: { decrement: amount },
        availableBalance: { increment: amount }
      }
    });
    if (changed.count !== 1)
      throw AppError.conflict("Saldo tertahan tidak cukup; rekonsiliasi historis diperlukan");
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "REFUND",
        amount,
        balanceBefore: wallet.availableBalance,
        balanceAfter: Number(wallet.availableBalance) + amount,
        referenceId: payout.requestNumber,
        idempotencyKey: `payout:${payout.id}:reject`,
        description: params.reason
      }
    });
    return tx.payoutRequest.update({
      where: { id: payout.id },
      data: {
        status: "rejected",
        rejectionReason: params.reason,
        processedByAdminId: params.adminId,
        processedAt: new Date()
      }
    });
  });
}
export const unsettledPaymentWhere = {
  gateway: "doku",
  method: "qris",
  status: "paid",
  settledAt: null,
  reviewReason: null,
  order: { source: "self_order" }
} as const;
export async function settlePayments(params: {
  reference: string;
  payments: {
    paymentId: number;
    gatewayFee: number;
  }[];
}) {
  if (!params.reference.trim() || !params.payments.length)
    throw AppError.badRequest("Referensi settlement dan pembayaran wajib diisi");
  if (new Set(params.payments.map(i => i.paymentId)).size !== params.payments.length)
    throw AppError.badRequest("Pembayaran duplikat");
  return prisma.$transaction(async (tx) => {
    const results = [];
    // Payment processing also locks payment before wallet. Keep that order here.
    for (const item of [...params.payments].sort((a, b) => a.paymentId - b.paymentId))
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${item.paymentId} FOR UPDATE`;
    const candidates = await tx.payment.findMany({
      where: { id: { in: params.payments.map(i => i.paymentId) } },
      select: { businessId: true }
    });
    for (const businessId of [...new Set(candidates.map(i => i.businessId))].sort((a, b) => a - b))
      await lockWallet(tx, businessId);
    for (const item of [...params.payments].sort((a, b) => a.paymentId - b.paymentId)) {
      money(item.gatewayFee, true);
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${item.paymentId} FOR UPDATE`;
      const payment = await tx.payment.findUnique({
        where: { id: item.paymentId },
        include: { order: true }
      });
      if (
        !payment || payment.gateway !== "doku" || payment.method !== "qris" ||
        payment.status !== "paid" || payment.order.source !== "self_order" ||
        payment.settledAt || payment.reviewReason
      )
        throw AppError.badRequest("Pembayaran tidak memenuhi syarat settlement atau sudah direkonsiliasi");
      const wallet = await lockWallet(tx, payment.businessId);
      const inflow = await tx.walletTransaction.findFirst({
        where: {
          walletId: wallet.id,
          type: "ORDER_INFLOW",
          OR: [{ idempotencyKey: `payment:${payment.id}:inflow` }, { referenceId: payment.order.orderNumber }]
        }
      });
      if (!inflow)
        throw AppError.conflict("Ledger pendapatan tidak ditemukan; rekonsiliasi historis diperlukan");
      const estimated = Number(inflow.amount) - Number(payment.refundedAmount);
      const actual = Number(payment.amount) - Number(payment.order.platformFee) -
        item.gatewayFee - Number(payment.refundedAmount);
      if (estimated < 0 || actual < 0 || Number(wallet.pendingBalance) < estimated)
        throw AppError.badRequest("Biaya atau saldo settlement tidak valid");
      await tx.merchantWallet.update({
        where: { id: wallet.id },
        data: {
          pendingBalance: { decrement: estimated },
          availableBalance: { increment: actual }
        }
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "SETTLEMENT_PENDING",
          amount: -estimated,
          balanceBefore: wallet.pendingBalance,
          balanceAfter: Number(wallet.pendingBalance) - estimated,
          referenceId: params.reference,
          idempotencyKey: `payment:${payment.id}:settle-pending`,
          description: `Rekonsiliasi pembayaran #${payment.id}`
        }
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "SETTLEMENT",
          amount: actual,
          balanceBefore: wallet.availableBalance,
          balanceAfter: Number(wallet.availableBalance) + actual,
          referenceId: params.reference,
          idempotencyKey: `payment:${payment.id}:settle`,
          description: `Biaya gateway aktual Rp ${item.gatewayFee}`
        }
      });
      results.push(await tx.payment.update({
        where: { id: payment.id },
        data: {
          settledAt: new Date(),
          settlementReference: params.reference,
          gatewayFeeActual: item.gatewayFee,
          settledNet: actual
        }
      }));
    }
    return results;
  });
}
export async function refundPayment(params: {
  paymentId: number;
  amount: number;
  reference: string;
  proofImageUrl: string;
  reason: string;
  adminId: number;
}) {
  money(params.amount);
  return prisma.$transaction(async (tx) => {
    const lookup = await tx.payment.findUnique({
      where: { id: params.paymentId },
      select: { businessId: true }
    });
    if (!lookup)
      throw AppError.notFound("Pembayaran tidak ditemukan");
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${params.paymentId} FOR UPDATE`;
    const wallet = await lockWallet(tx, lookup.businessId);
    const payment = await tx.payment.findUnique({
      where: { id: params.paymentId },
      include: { order: true }
    });
    if (!payment || payment.gateway !== "doku" || payment.method !== "qris" || payment.status !== "paid" || payment.order.source !== "self_order")
      throw AppError.badRequest("Pembayaran tidak memenuhi syarat refund");
    const metadata = (Array.isArray(payment.refundMetadata) ? payment.refundMetadata : []) as Record<string, Prisma.JsonValue>[];
    if (metadata.some(e => e.reference === params.reference))
      throw AppError.conflict("Referensi refund telah digunakan");
    if (Number(payment.refundedAmount) + params.amount > Number(payment.amount))
      throw AppError.badRequest("Refund melebihi jumlah pembayaran");
    const inflow = await tx.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        type: "ORDER_INFLOW",
        OR: [{ idempotencyKey: `payment:${payment.id}:inflow` }, { referenceId: payment.order.orderNumber }]
      }
    });
    if (!inflow)
      throw AppError.conflict("Ledger pendapatan tidak ditemukan");
    const field = payment.settledAt ? "availableBalance" : "pendingBalance";
    const afterSettlementRefunds = metadata.reduce((sum, e) => sum + (e.beforeSettlement === false ? Number(e.amount) : 0), 0);
    const remaining = payment.settledAt ? Number(payment.settledNet) - afterSettlementRefunds : Number(inflow.amount) - Number(payment.refundedAmount);
    if (params.amount > remaining || Number(wallet[field]) < params.amount)
      throw AppError.badRequest("Saldo merchant tidak cukup untuk refund; rekonsiliasi diperlukan");
    await tx.merchantWallet.update({
      where: { id: wallet.id },
      data: { [field]: { decrement: params.amount } }
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PAYMENT_REFUND",
        amount: -params.amount,
        balanceBefore: wallet[field],
        balanceAfter: Number(wallet[field]) - params.amount,
        referenceId: params.reference,
        idempotencyKey: `payment:${payment.id}:refund:${params.reference}`,
        description: params.reason
      }
    });
    return tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmount: { increment: params.amount },
        refundMetadata: [...metadata, {
            amount: params.amount,
            reference: params.reference,
            proofImageUrl: params.proofImageUrl,
            reason: params.reason,
            adminId: params.adminId,
            beforeSettlement: !payment.settledAt,
            createdAt: new Date().toISOString()
          }] as Prisma.InputJsonValue
      }
    });
  });
}
