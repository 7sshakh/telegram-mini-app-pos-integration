import { eq } from "drizzle-orm";

import { db } from "@/db";
import { posJobs } from "@/db/schema";
import { fail, jobResultSchema, ok, parseBody, serverError } from "@/lib/api";
import { audit, authenticateDevice } from "@/lib/auth";
import { completeJob, failJob } from "@/lib/jobs";
import { applyPosOrderResult, updateOrderStatus } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * Agent reports the outcome of a job.
 *  - ok:true  -> order is marked synced, POS order id stored, POS status applied
 *  - ok:false -> job goes back to the queue with backoff (or dies if fatal),
 *                the customer sees a clear Uzbek error state.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const device = await authenticateDevice(request);
    if (!device) return fail("UNAUTHORIZED", "Qurilma tokeni yaroqsiz.", 401);

    const { id } = await context.params;
    const parsed = await parseBody(request, jobResultSchema);
    if (!parsed.ok) return parsed.response;

    const rows = await db.select().from(posJobs).where(eq(posJobs.id, id)).limit(1);
    const job = rows[0];
    if (!job) return fail("NOT_FOUND", "Job topilmadi.", 404);

    if (job.type === "CREATE_ORDER" && job.orderId) {
      await applyPosOrderResult(job.orderId, {
        ok: parsed.data.ok,
        posOrderId: parsed.data.posOrderId,
        posOrderNumber: parsed.data.posOrderNumber,
        status: parsed.data.status,
        error: parsed.data.error,
        fatal: parsed.data.fatal,
      });

      if (parsed.data.ok && parsed.data.status && parsed.data.status !== "new") {
        await updateOrderStatus({ orderId: job.orderId, status: parsed.data.status, note: parsed.data.posOrderNumber ? `POS: ${parsed.data.posOrderNumber}` : null });
      }
    }

    if (parsed.data.ok) {
      await completeJob(job.id, device.deviceId);
    } else {
      await failJob(job.id, parsed.data.error ?? "unknown-pos-error", {
        retryInSeconds: parsed.data.retryInSeconds,
        fatal: parsed.data.fatal,
      });
    }

    void audit({
      actorType: "pos",
      actorId: device.deviceId,
      action: parsed.data.ok ? "bridge.job_completed" : "bridge.job_failed",
      targetType: "job",
      targetId: job.id,
      payload: { type: job.type, orderId: job.orderId, error: parsed.data.error ?? null },
    });

    return ok({ accepted: true });
  } catch (error) {
    return serverError(error);
  }
}
