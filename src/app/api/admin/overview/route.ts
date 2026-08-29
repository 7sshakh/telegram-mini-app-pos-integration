import { desc, sql } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, orders } from "@/db/schema";
import { fail, ok, serverError } from "@/lib/api";
import { isAdminRequest } from "@/lib/auth";
import { env } from "@/lib/env";
import { pendingJobCount } from "@/lib/jobs";
import { isPosOnline } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/**
 * Operations dashboard data for the POS owner: queue health, recent orders,
 * device state and audit trail. Protected by ADMIN_API_TOKEN.
 */
export async function GET(request: Request) {
  if (!env.adminConfigured) return fail("FORBIDDEN", "ADMIN_API_TOKEN sozlanmagan.", 503);
  if (!isAdminRequest(request)) return fail("FORBIDDEN", undefined, 403);

  try {
    const queueResult = await db.execute(sql`
      select status, count(*)::int as count
        from pos_jobs
       group by status
    `);
    const queueRows = (queueResult.rows ?? []) as unknown as { status: string; count: number }[];

    const recentOrders = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(25);
    const auditRows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(30);

    const statsResult = await db.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where created_at >= date_trunc('day', now()))::int as today,
        coalesce(sum((totals->>'total')::int), 0) as revenue_today
        from orders
        where created_at >= date_trunc('day', now()) - interval '7 days'
    `);
    const statsRows = (statsResult.rows ?? []) as unknown as {
      total: number;
      today: number;
      revenue_today: number;
    }[];

    return ok({
      env: {
        posMode: env.posMode,
        allowMockFallback: env.allowMockFallback,
        botConfigured: env.telegramConfigured,
        botUsername: env.telegramBotUsername,
        paymentProvider: env.paymentProvider,
        adminConfigured: env.adminConfigured,
        catalogTtlSeconds: env.catalogTtlSeconds,
      },
      queue: {
        byStatus: queueRows,
        pending: await pendingJobCount(),
        posOnline: await isPosOnline(),
      },
      stats: statsRows[0] ?? { total: 0, today: 0, revenue_today: 0 },
      orders: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        posOrderNumber: order.posOrderNumber,
        status: order.status,
        posSyncStatus: order.posSyncStatus,
        orderType: order.orderType,
        total: order.totals.total,
        payment: order.payment.method,
        createdAt: order.createdAt.toISOString(),
        customerId: order.customerId,
      })),
      audit: auditRows.map((row) => ({
        id: row.id,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        targetId: row.targetId,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}
