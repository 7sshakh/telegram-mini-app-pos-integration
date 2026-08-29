import { sql } from "drizzle-orm";

import { db } from "@/db";
import { ok, serverError } from "@/lib/api";
import { env } from "@/lib/env";
import { pendingJobCount } from "@/lib/jobs";
import { isPosOnline } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** Liveness + integration snapshot. Safe to expose: no secrets, only booleans. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);

    let queuePending = 0;
    let posOnline = false;
    let failed = false;
    try {
      queuePending = await pendingJobCount();
      posOnline = await isPosOnline();
      const dead = await db.execute(sql`select count(*)::int as count from pos_jobs where status = 'dead'`);
      const rows = (dead.rows ?? []) as unknown as { count: number }[];
      failed = (rows[0]?.count ?? 0) > 0;
    } catch {
      // queue info is optional for liveness
    }

    return ok({
      ok: true,
      service: "vibe-telegram-mini-app",
      time: new Date().toISOString(),
      pos: {
        mode: env.posMode,
        online: posOnline,
        queuePending,
        hasFailedJobs: failed,
      },
      telegram: { botConfigured: env.telegramConfigured, notifications: env.telegramNotify },
      security: {
        adminConfigured: env.adminConfigured,
        sessionSecretConfigured: env.sessionSecretConfigured,
        devMode: env.devMode,
        allowMockFallback: env.allowMockFallback,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
