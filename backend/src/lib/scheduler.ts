import { prisma } from "./prisma";
import { requestPayout } from "../services/wallet.service";
export async function processScheduledPayouts(now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const wallets = await prisma.merchantWallet.findMany({
    where: {
      autoPayoutEnabled: true,
      isBankVerified: true,
      bankAccount: { not: null },
      bankCode: { not: null }
    }
  });
  for (const w of wallets) {
    const due =
      w.payoutFrequency === "daily" ||
      (w.payoutFrequency === "weekly" && local.getDay() === (w.payoutDay ?? 1)) ||
      (w.payoutFrequency === "monthly" && local.getDate() === (w.payoutDay ?? 25));
    const amount = Number(w.availableBalance) - Number(w.holdMinBalance);
    if (!due || amount <= 0 || amount < Number(w.minimumPayout))
      continue;
    try {
      await requestPayout({
        businessId: w.businessId,
        amount,
        source: "scheduled",
        scheduleKey: `${w.businessId}:${dateKey}`
      });
    }
    catch (error) {
      console.error(`[scheduler] Payout ticket failed for business ${w.businessId}`, error);
    }
  }
}
export function startScheduler() {
  const run = () => processScheduledPayouts().catch(error => console.error("[scheduler] Payout scheduling failed", error));
  setTimeout(run, 30000);
  setInterval(run, 3600000);
}
