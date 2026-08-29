import { sql } from "drizzle-orm";

import { db } from "@/db";
import { ok, serverError } from "@/lib/api";
import { authenticateDevice } from "@/lib/auth";
import { env } from "@/lib/env";
import { pendingJobCount, releaseExpiredJobs } from "@/lib/jobs";
import { touchDevice } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** Agent heartbeat: keeps device online state fresh and reports queue depth. */
export async function POST(request: Request) {
  try {
    const device = await authenticateDevice(request);
    if (!device) {
      return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Qurilma tokeni yaroqsiz." } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    await touchDevice(device.deviceId, {
      status: "online",
      posVersion: request.headers.get("x-pos-version") ?? undefined,
      agentVersion: request.headers.get("x-agent-version") ?? undefined,
    });
    await releaseExpiredJobs();

    const catalogResult = await db.execute(
      sql`select extracted_at from (
            select (payload->>'generatedAt') as extracted_at, fetched_at
            from catalog_snapshots where source = 'pos' order by fetched_at desc limit 1
          ) t`,
    );
    const rows = (catalogResult.rows ?? []) as unknown as { extracted_at: string | null }[];

    return ok({
      ok: true,
      pending: await pendingJobCount(),
      catalogAgeSeconds: rows[0]?.extracted_at
        ? Math.max(0, Math.round((Date.now() - new Date(rows[0].extracted_at).getTime()) / 1000))
        : null,
      catalogTtlSeconds: env.catalogTtlSeconds,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}
