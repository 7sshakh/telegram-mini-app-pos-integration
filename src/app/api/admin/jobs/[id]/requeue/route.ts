import { eq } from "drizzle-orm";

import { db } from "@/db";
import { orders, posJobs } from "@/db/schema";
import { fail, ok, serverError } from "@/lib/api";
import { audit, clientIp, isAdminRequest } from "@/lib/auth";
import { env } from "@/lib/env";
import { requeueJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Re-deliver a stuck/dead job to the POS and reset its error state. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!env.adminConfigured) return fail("FORBIDDEN", "ADMIN_API_TOKEN sozlanmagan.", 503);
  if (!isAdminRequest(request)) return fail("FORBIDDEN", undefined, 403);

  try {
    const { id } = await context.params;
    const rows = await db.select().from(posJobs).where(eq(posJobs.id, id)).limit(1);
    const job = rows[0];
    if (!job) return fail("NOT_FOUND", "Job topilmadi.", 404);

    await requeueJob(job.id);

    if (job.orderId) {
      await db.update(orders).set({ posSyncStatus: "pending", updatedAt: new Date() }).where(eq(orders.id, job.orderId));
    }

    void audit({
      actorType: "admin",
      action: "job.requeued",
      targetType: "job",
      targetId: job.id,
      payload: { type: job.type, orderId: job.orderId },
      ip: clientIp(request),
    });

    return ok({ requeued: true, jobId: job.id });
  } catch (error) {
    return serverError(error);
  }
}
