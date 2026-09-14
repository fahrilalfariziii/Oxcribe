import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/error-handler";
import { requireAuth } from "../middleware/auth";
import { FEATURES, getBusinessFeatures, isFeatureOn } from "../lib/feature-gate";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

const periodSchema = z.object({ period: z.enum(["daily", "weekly", "monthly"]).default("daily") });

function rangeStartFor(period: "daily" | "weekly" | "monthly"): Date {
  const now = new Date();
  if (period === "daily") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === "weekly") {
    const day = now.getDay() || 7; // Senin = 1 ... Minggu = 7
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// GET /api/analytics/dashboard?period=daily|weekly|monthly
// Ringkasan omset + performa item untuk Dashboard BackOffice.
// Degradasi disepakati: tanpa analyticsFull -> hanya angka ringkas
// (revenue, totalOrders, avg), TANPA topProducts. Starter = ringkas saja.
analyticsRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const { period } = periodSchema.parse(req.query);
    const businessId = req.auth!.businessId;
    const start = rangeStartFor(period);

    const paidOrdersAgg = await prisma.order.aggregate({
      where: { businessId, paymentStatus: "paid", createdAt: { gte: start } },
      _sum: { total: true },
      _count: { _all: true },
    });

    const revenue = Number(paidOrdersAgg._sum.total ?? 0);
    const totalOrders = paidOrdersAgg._count._all;
    const avgOrderValue = totalOrders > 0 ? revenue / totalOrders : 0;

    // Tanpa flag analyticsFull: kembalikan ringkas saja (FE Starter sembunyikan grafik & top item).
    let fullOn = true;
    try {
      fullOn = isFeatureOn((await getBusinessFeatures(businessId)).flags, FEATURES.ANALYTICS_FULL);
    } catch {
      fullOn = true;
    }
    if (!fullOn) {
      return res.json({ period, rangeStart: start, revenue, totalOrders, avgOrderValue, topProducts: [] });
    }

    const topProducts = await prisma.$queryRaw<
      { product_id: number; product_name: string; qty: bigint; revenue: string }[]
    >(Prisma.sql`
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.business_id = ${businessId}
        AND o.payment_status = 'paid'
        AND o.created_at >= ${start}
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC
      LIMIT 5
    `);

    res.json({
      period,
      rangeStart: start,
      revenue,
      totalOrders,
      avgOrderValue,
      topProducts: topProducts.map((p) => ({
        productId: p.product_id,
        productName: p.product_name,
        quantity: Number(p.qty),
        revenue: Number(p.revenue),
      })),
    });
  })
);

const salesQuerySchema = z.object({
  period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
});

// GET /api/analytics/sales?period=daily|weekly|monthly
// Omset per bucket waktu (harian/mingguan/bulanan) + perbandingan Self Order vs Manual (POS).
// Gate disepakati: butuh analyticsFull (403 bila OFF). Sub-flag salesType:
// bila OFF, salesBySource dikembalikan nol agar FE sembunyikan tab Sales Type.
analyticsRouter.get(
  "/sales",
  asyncHandler(async (req, res) => {
    const { period } = salesQuerySchema.parse(req.query);
    const businessId = req.auth!.businessId;

    let flags: Record<string, boolean> = {};
    try {
      flags = (await getBusinessFeatures(businessId)).flags;
    } catch {}
    if (!isFeatureOn(flags, FEATURES.ANALYTICS_FULL)) {
      const { AppError: AE } = await import("../lib/errors");
      throw AE.forbidden("Laporan penjualan lengkap tidak termasuk paket kafe Anda (analyticsFull). Hubungi tim sales Ordria untuk upgrade.");
    }
    const salesTypeOn = isFeatureOn(flags, FEATURES.SALES_TYPE);

    const truncUnit = period === "daily" ? "day" : period === "weekly" ? "week" : "month";
    const lookback =
      period === "daily" ? "30 days" : period === "weekly" ? "12 weeks" : "12 months";

    const omsetSeries = await prisma.$queryRaw<{ bucket: Date; revenue: string; orders: bigint }[]>(
      Prisma.sql`
        SELECT date_trunc(${truncUnit}, created_at) AS bucket,
               SUM(total) AS revenue,
               COUNT(*) AS orders
        FROM orders
        WHERE business_id = ${businessId}
          AND payment_status = 'paid'
          AND created_at >= NOW() - INTERVAL '${Prisma.raw(lookback)}'
        GROUP BY bucket
        ORDER BY bucket ASC
      `
    );

    const bySourceRaw = await prisma.$queryRaw<{ source: string; revenue: string; orders: bigint }[]>(
      Prisma.sql`
        SELECT source, SUM(total) AS revenue, COUNT(*) AS orders
        FROM orders
        WHERE business_id = ${businessId}
          AND payment_status = 'paid'
          AND created_at >= NOW() - INTERVAL '${Prisma.raw(lookback)}'
        GROUP BY source
      `
    );

    res.json({
      period,
      omsetSeries: omsetSeries.map((r) => ({
        bucket: r.bucket,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
      })),
      salesBySource: salesTypeOn
        ? {
            selfOrder: findSource(bySourceRaw, "self_order"),
            pos: findSource(bySourceRaw, "pos"),
          }
        : {
            selfOrder: { revenue: 0, orders: 0 },
            pos: { revenue: 0, orders: 0 },
          },
    });
  })
);

function findSource(rows: { source: string; revenue: string; orders: bigint }[], key: string) {
  const row = rows.find((r) => r.source === key);
  return { revenue: row ? Number(row.revenue) : 0, orders: row ? Number(row.orders) : 0 };
}
