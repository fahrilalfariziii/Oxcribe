import { prisma } from "../lib/prisma";
import { applyQrisStatus, pollQrisOrder } from "./payment-lifecycle.service";

export async function runPaymentWorkerOnce() {
  const notifications = await prisma.paymentNotification.findMany({ where: { status: "pending", nextAttemptAt: { lte: new Date() } }, orderBy: { id: "asc" }, take: 50 });
  for (const notification of notifications) {
    try {
      const body = notification.payload as Record<string, unknown>;
      const ref = body.originalPartnerReferenceNo ?? body.partnerReferenceNo;
      if (typeof ref !== "string") throw new Error("Missing QRIS partner reference");
      let attempt = await prisma.paymentAttempt.findUnique({ where: { partnerReferenceNo: ref } });
      if (!attempt) {
        // Adopt exact historical gateway references without scanning or order-number guesses.
        const payment = await prisma.payment.findFirst({ where: { gateway: "doku", method: "qris", gatewayData: { path: ["partnerReferenceNo"], equals: ref } } });
        if (payment) attempt = await prisma.paymentAttempt.upsert({ where: { partnerReferenceNo: ref }, update: {}, create: { paymentId: payment.id, partnerReferenceNo: ref, amount: payment.amount, status: "unknown" } });
      }
      if (!attempt) throw new Error("Unknown QRIS reference; retained for reconciliation");
      await applyQrisStatus(attempt.id, body);
      await prisma.paymentNotification.update({ where: { id: notification.id }, data: { status: "processed", attempts: { increment: 1 }, error: null } });
    } catch (error) {
      const attempts = notification.attempts + 1;
      await prisma.paymentNotification.update({ where: { id: notification.id }, data: { attempts: { increment: 1 }, error: String(error).slice(0, 1000), nextAttemptAt: new Date(Date.now() + Math.min(3600, 2 ** Math.min(attempts, 12)) * 1000) } });
    }
  }
  const attempts = await prisma.paymentAttempt.findMany({ where: { status: { in: ["creating", "pending", "unknown", "canceled"] }, updatedAt: { lte: new Date(Date.now() - 30_000) } }, orderBy: { updatedAt: "asc" }, take: 50, include: { payment: true } });
  const reviewCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const pollable = [];
  for (const attempt of attempts) {
    if (attempt.createdAt.getTime() < reviewCutoff) {
      // Stop repeated gateway inquiries only after creating an explicit operations case.
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${attempt.payment.orderId} FOR UPDATE`;
        const changed = await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: { in: ["creating", "pending", "unknown", "canceled"] } }, data: { status: "review", error: "Unresolved for seven days; verify merchant statement manually" } });
        if (changed.count) await tx.payment.update({ where: { id: attempt.paymentId }, data: { reviewReason: "Unresolved QRIS reference; verify merchant statement manually" } });
      });
    } else pollable.push(attempt);
  }
  for (const orderId of new Set(pollable.map((a) => a.payment.orderId))) {
    try { await pollQrisOrder(orderId); }
    catch (error) { console.error(`[payment worker] order ${orderId}:`, error); }
  }
}

export function startPaymentWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runPaymentWorkerOnce(); }
    catch (error) { console.error("[payment worker]", error); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
