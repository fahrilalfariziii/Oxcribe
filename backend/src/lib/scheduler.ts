import { prisma } from "./prisma";
import { settleAllPendingBalances, requestPayout } from "../services/wallet.service";

/**
 * Worker untuk menjalankan auto-payout bagi merchant yang mengaktifkan jadwal otomatis.
 */
async function processScheduledPayouts() {
  const now = new Date();
  const currentDayOfWeek = now.getDay(); // 0 = Minggu, 1 = Senin, ...
  const currentDateOfMonth = now.getDate(); // 1 - 31

  const activeWallets = await prisma.merchantWallet.findMany({
    where: {
      autoPayoutEnabled: true,
      isBankVerified: true,
      bankAccount: { not: null },
      bankCode: { not: null },
    },
  });

  for (const wallet of activeWallets) {
    try {
      let shouldPayout = false;

      if (wallet.payoutFrequency === "daily") {
        shouldPayout = true;
      } else if (wallet.payoutFrequency === "weekly") {
        // payoutDay default 1 (Senin) jika null
        const targetDay = wallet.payoutDay ?? 1;
        if (currentDayOfWeek === targetDay) {
          shouldPayout = true;
        }
      } else if (wallet.payoutFrequency === "monthly") {
        // payoutDay default 25 jika null
        const targetDate = wallet.payoutDay ?? 25;
        if (currentDateOfMonth === targetDate) {
          shouldPayout = true;
        }
      }

      if (shouldPayout) {
        const available = Number(wallet.availableBalance);
        const holdMin = Number(wallet.holdMinBalance);
        const minPayout = Number(wallet.minimumPayout);
        const withdrawable = available - holdMin;

        // Hanya tarik jika dana yang dapat ditarik memenuhi batas minimum
        if (withdrawable >= minPayout) {
          console.log(`[scheduler] Membuat scheduled auto-payout untuk tenant #${wallet.businessId} sebesar Rp ${withdrawable}`);
          await requestPayout({
            businessId: wallet.businessId,
            amount: withdrawable,
            source: "scheduled",
          });
        }
      }
    } catch (err) {
      console.error(`[scheduler] Gagal memproses auto-payout untuk tenant #${wallet.businessId}:`, err);
    }
  }
}

/**
 * Inisialisasi scheduler interval di backend (setiap 1 jam mengecek cron jobs).
 */
export function startScheduler() {
  console.log("[scheduler] Memulai cron worker (Settlement & Auto-Payout)...");

  // Jalankan pengecekan pertama setelah 30 detik server start
  setTimeout(async () => {
    try {
      await settleAllPendingBalances();
      await processScheduledPayouts();
    } catch (e) {
      console.error("[scheduler] Error pada initial run:", e);
    }
  }, 30000);

  // Interval setiap 1 jam
  setInterval(async () => {
    try {
      const now = new Date();
      // Jalankan settlement dan auto-payout setiap pergantian hari jam 00:xx - 01:xx
      if (now.getHours() === 1) {
        console.log("[scheduler] Menjalankan settlement harian dan auto-payout...");
        await settleAllPendingBalances();
        await processScheduledPayouts();
      }
    } catch (e) {
      console.error("[scheduler] Error interval scheduler:", e);
    }
  }, 3600000); // 1 jam
}
