import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../lib/errors";

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

/**
 * Dapatkan atau buat dompet internal untuk sebuah kafe (business).
 */
export async function getOrCreateWallet(businessId: number) {
  let wallet = await prisma.merchantWallet.findUnique({
    where: { businessId },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      payouts: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!wallet) {
    wallet = await prisma.merchantWallet.create({
      data: {
        businessId,
        availableBalance: 0,
        pendingBalance: 0,
      },
      include: {
        transactions: true,
        payouts: true,
      },
    });
  }

  return wallet;
}

/**
 * Catat dana masuk dari pesanan non-tunai (QRIS / VA).
 * Nominal yang masuk adalah nominal BERSIH (setelah dikurangi MDR & fee platform).
 * Awalnya masuk ke pendingBalance (menunggu H+1).
 */
export async function creditOrderInflow(params: {
  businessId: number;
  netAmount: number;
  orderNumber: string;
  description?: string;
}) {
  const { businessId, netAmount, orderNumber, description } = params;
  if (netAmount <= 0) return;

  return prisma.$transaction(async (tx) => {
    let wallet = await tx.merchantWallet.findUnique({ where: { businessId } });
    if (!wallet) {
      wallet = await tx.merchantWallet.create({
        data: { businessId, availableBalance: 0, pendingBalance: 0 },
      });
    }

    const before = Number(wallet.pendingBalance);
    const after = before + netAmount;

    const updated = await tx.merchantWallet.update({
      where: { id: wallet.id },
      data: {
        pendingBalance: { increment: netAmount },
      },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "ORDER_INFLOW",
        amount: netAmount,
        balanceBefore: before,
        balanceAfter: after,
        referenceId: orderNumber,
        description: description || `Pendapatan pesanan #${orderNumber} (Pending H+1)`,
      },
    });

    return updated;
  });
}

/**
 * Pindahkan saldo pending menjadi saldo aktif (H+1 settlement).
 * Dapat dijalankan otomatis oleh cron/scheduler harian.
 */
export async function settleAllPendingBalances() {
  const wallets = await prisma.merchantWallet.findMany({
    where: { pendingBalance: { gt: 0 } },
  });

  const results = [];
  for (const wallet of wallets) {
    const pending = Number(wallet.pendingBalance);
    if (pending <= 0) continue;

    const res = await prisma.$transaction(async (tx) => {
      const currentAvailable = Number(wallet.availableBalance);
      const afterAvailable = currentAvailable + pending;

      const updated = await tx.merchantWallet.update({
        where: { id: wallet.id },
        data: {
          pendingBalance: 0,
          availableBalance: { increment: pending },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "SETTLEMENT",
          amount: pending,
          balanceBefore: currentAvailable,
          balanceAfter: afterAvailable,
          description: `Settlement harian (Pending -> Saldo Aktif)`,
        },
      });

      return updated;
    });

    results.push(res);
  }

  return results;
}

/**
 * Simpan rekening bank kafe dan tandai status verifikasinya.
 */
export async function updateWalletBankAccount(
  businessId: number,
  bankData: BankAccountInput & { isVerified: boolean }
) {
  const wallet = await getOrCreateWallet(businessId);

  return prisma.merchantWallet.update({
    where: { id: wallet.id },
    data: {
      bankCode: bankData.bankCode,
      bankAccount: bankData.bankAccount,
      accountName: bankData.accountName,
      isBankVerified: bankData.isVerified,
      bankVerifiedAt: bankData.isVerified ? new Date() : null,
    },
  });
}

/**
 * Perbarui pengaturan jadwal pencairan otomatis (Auto-Payout).
 */
export async function updateWalletPayoutSettings(
  businessId: number,
  settings: PayoutSettingsInput
) {
  const wallet = await getOrCreateWallet(businessId);

  return prisma.merchantWallet.update({
    where: { id: wallet.id },
    data: {
      ...(settings.autoPayoutEnabled !== undefined && { autoPayoutEnabled: settings.autoPayoutEnabled }),
      ...(settings.payoutFrequency && { payoutFrequency: settings.payoutFrequency }),
      ...(settings.payoutDay !== undefined && { payoutDay: settings.payoutDay }),
      ...(settings.minimumPayout !== undefined && { minimumPayout: settings.minimumPayout }),
      ...(settings.holdMinBalance !== undefined && { holdMinBalance: settings.holdMinBalance }),
    },
  });
}

/**
 * Buat nomor request penarikan yang unik (PO-YYYYMM-XXXX).
 */
async function generatePayoutNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 7).replace("-", ""); // 202610
  const prefix = `PO-${dateStr}-`;

  const lastPayout = await prisma.payoutRequest.findFirst({
    where: { requestNumber: { startsWith: prefix } },
    orderBy: { id: "desc" },
    select: { requestNumber: true },
  });

  let seq = 1;
  if (lastPayout) {
    const parts = lastPayout.requestNumber.split("-");
    const lastSeq = parseInt(parts[2], 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${seq.toString().padStart(4, "0")}`;
}

/**
 * Owner mengajukan penarikan dana (On-Demand atau Terjadwal).
 */
export async function requestPayout(params: {
  businessId: number;
  amount: number;
  source?: "on_demand" | "scheduled";
}) {
  const { businessId, amount, source = "on_demand" } = params;
  if (amount <= 0) {
    throw AppError.badRequest("Nominal penarikan harus lebih dari 0");
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.merchantWallet.findUnique({ where: { businessId } });
    if (!wallet) throw AppError.notFound("Dompet merchant belum dibuat");

    if (!wallet.isBankVerified || !wallet.bankAccount || !wallet.bankCode || !wallet.accountName) {
      throw AppError.badRequest("Rekening bank belum didaftarkan atau belum terverifikasi");
    }

    const minPayout = Number(wallet.minimumPayout);
    if (amount < minPayout) {
      throw AppError.badRequest(`Nominal penarikan minimal Rp ${minPayout.toLocaleString("id-ID")}`);
    }

    const holdMin = Number(wallet.holdMinBalance);
    const available = Number(wallet.availableBalance);
    const maxWithdrawable = available - holdMin;

    if (amount > maxWithdrawable) {
      throw AppError.badRequest(
        `Saldo yang dapat ditarik tidak mencukupi. Tersedia: Rp ${available.toLocaleString("id-ID")} (Termasuk cadangan kas Rp ${holdMin.toLocaleString("id-ID")})`
      );
    }

    const balanceBefore = available;
    const balanceAfter = available - amount;

    // 1. Potong saldo aktif
    await tx.merchantWallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: { decrement: amount },
      },
    });

    const requestNumber = await generatePayoutNumber();

    // 2. Buat tiket PayoutRequest
    const payout = await tx.payoutRequest.create({
      data: {
        walletId: wallet.id,
        requestNumber,
        source,
        amount,
        bankCode: wallet.bankCode,
        bankAccount: wallet.bankAccount,
        accountName: wallet.accountName,
        status: "pending",
      },
    });

    // 3. Catat di ledger transaksi
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PAYOUT_DEDUCTION",
        amount,
        balanceBefore,
        balanceAfter,
        referenceId: requestNumber,
        description: `Penarikan dana #${requestNumber} (${source === "scheduled" ? "Jadwal Otomatis" : "Tarik Manual"})`,
      },
    });

    return payout;
  });
}

/**
 * Platform Admin menyelesaikan transfer (m-Banking selesai).
 */
export async function completePayout(params: {
  payoutId: number;
  adminId: number;
  bankRefNumber: string;
  proofImageUrl?: string;
}) {
  const { payoutId, adminId, bankRefNumber, proofImageUrl } = params;

  const payout = await prisma.payoutRequest.findUnique({
    where: { id: payoutId },
  });

  if (!payout) throw AppError.notFound("Tiket pencairan tidak ditemukan");
  if (payout.status === "completed") {
    throw AppError.badRequest("Pencairan ini sudah selesai diproses");
  }

  return prisma.payoutRequest.update({
    where: { id: payoutId },
    data: {
      status: "completed",
      bankRefNumber,
      proofImageUrl,
      processedByAdminId: adminId,
      processedAt: new Date(),
    },
  });
}

/**
 * Platform Admin menolak penarikan dan mengembalikan saldo ke dompet merchant.
 */
export async function rejectPayout(params: {
  payoutId: number;
  adminId: number;
  reason: string;
}) {
  const { payoutId, adminId, reason } = params;

  return prisma.$transaction(async (tx) => {
    const payout = await tx.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { wallet: true },
    });

    if (!payout) throw AppError.notFound("Tiket pencairan tidak ditemukan");
    if (payout.status !== "pending" && payout.status !== "processing") {
      throw AppError.badRequest("Pencairan ini tidak dapat dibatalkan/ditolak");
    }

    const currentBalance = Number(payout.wallet.availableBalance);
    const refundAmount = Number(payout.amount);
    const newBalance = currentBalance + refundAmount;

    // 1. Kembalikan saldo ke dompet kafe
    await tx.merchantWallet.update({
      where: { id: payout.walletId },
      data: {
        availableBalance: { increment: refundAmount },
      },
    });

    // 2. Catat mutasi REFUND di ledger
    await tx.walletTransaction.create({
      data: {
        walletId: payout.walletId,
        type: "REFUND",
        amount: refundAmount,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
        referenceId: payout.requestNumber,
        description: `Pengembalian dana penarikan #${payout.requestNumber}: ${reason}`,
      },
    });

    // 3. Update status tiket payout
    const updated = await tx.payoutRequest.update({
      where: { id: payoutId },
      data: {
        status: "rejected",
        rejectionReason: reason,
        processedByAdminId: adminId,
        processedAt: new Date(),
      },
    });

    return updated;
  });
}
