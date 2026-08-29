import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { posJobs } from "@/db/schema";
import { env } from "@/lib/env";
import type { JobType } from "@/lib/types";

export type PosJob = typeof posJobs.$inferSelect;

export type ClaimedJob = {
  id: string;
  type: string;
  orderId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

/**
 * Enqueue work for the local POS. `dedupeKey` makes the operation idempotent —
 * replaying the same request (retry, duplicate tap, agent resync) can never
 * create a second POS order.
 */
export async function enqueueJob(input: {
  type: JobType;
  dedupeKey: string;
  payload: Record<string, unknown>;
  orderId?: string | null;
  maxAttempts?: number;
}): Promise<{ id: string } | null> {
  const inserted = await db
    .insert(posJobs)
    .values({
      type: input.type,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      orderId: input.orderId ?? null,
      maxAttempts: input.maxAttempts ?? env.bridgeMaxAttempts,
    })
    .onConflictDoNothing({ target: posJobs.dedupeKey })
    .returning({ id: posJobs.id });
  return inserted[0] ?? null;
}

/**
 * Atomically claim pending jobs for a device. `FOR UPDATE SKIP LOCKED` keeps
 * multiple agents (or a reconnecting agent) from grabbing the same order.
 */
export async function claimJobs(deviceId: string, limit = 5): Promise<ClaimedJob[]> {
  const result = await db.execute(sql`
    with picked as (
      select id from pos_jobs
      where status = 'pending' and available_at <= now()
      order by created_at asc
      limit ${limit}
      for update skip locked
    )
    update pos_jobs p
       set status = 'claimed',
           claimed_by_device_id = ${deviceId},
           claimed_at = now(),
           attempts = p.attempts + 1,
           updated_at = now()
      from picked
     where p.id = picked.id
    returning p.id, p.type, p.order_id, p.payload, p.attempts, p.max_attempts
  `);
  const rows = (result.rows ?? []) as unknown as ClaimedJob[];
  return rows.map((row) => ({ ...row, payload: (row.payload ?? {}) as Record<string, unknown> }));
}

export async function completeJob(jobId: string, deviceId: string): Promise<void> {
  await db
    .update(posJobs)
    .set({ status: "done", completedAt: new Date(), updatedAt: new Date(), claimedByDeviceId: deviceId })
    .where(eq(posJobs.id, jobId));
}

export async function failJob(
  jobId: string,
  error: string,
  options?: { retryInSeconds?: number; fatal?: boolean },
): Promise<void> {
  const rows = await db.select().from(posJobs).where(eq(posJobs.id, jobId)).limit(1);
  const job = rows[0];
  if (!job) return;

  const attempts = job.attempts;
  const maxAttempts = job.maxAttempts;
  const fatal = options?.fatal ?? false;
  const dead = fatal || attempts >= maxAttempts;

  await db
    .update(posJobs)
    .set({
      status: dead ? "dead" : "pending",
      lastError: error.slice(0, 500),
      availableAt: new Date(Date.now() + (options?.retryInSeconds ?? backoffSeconds(attempts)) * 1000),
      updatedAt: new Date(),
    })
    .where(eq(posJobs.id, jobId));
}

export function backoffSeconds(attempts: number): number {
  const base = Math.min(300, 5 * Math.pow(2, Math.max(0, attempts - 1)));
  return Math.round(base);
}

/** Release jobs whose lease expired (agent crashed mid-flight). */
export async function releaseExpiredJobs(): Promise<number> {
  const result = await db.execute(sql`
    update pos_jobs
       set status = 'pending',
           claimed_by_device_id = null,
           claimed_at = null,
           updated_at = now()
     where status = 'claimed'
       and claimed_at < now() - (${env.bridgeJobLeaseSeconds} || ' seconds')::interval
    returning id
  `);
  return (result.rows ?? []).length;
}

export async function requeueJob(jobId: string): Promise<void> {
  await db
    .update(posJobs)
    .set({ status: "pending", attempts: 0, availableAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(posJobs.id, jobId));
}

export async function pendingJobCount(): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as count from pos_jobs where status in ('pending','claimed')`,
  );
  const rows = (result.rows ?? []) as unknown as { count: number }[];
  return rows[0]?.count ?? 0;
}

export async function findJobByDedupeKey(dedupeKey: string): Promise<PosJob | null> {
  const rows = await db.select().from(posJobs).where(eq(posJobs.dedupeKey, dedupeKey)).limit(1);
  return rows[0] ?? null;
}

export async function findJobForOrder(orderId: string): Promise<PosJob | null> {
  const rows = await db
    .select()
    .from(posJobs)
    .where(and(eq(posJobs.orderId, orderId), eq(posJobs.type, "CREATE_ORDER")))
    .limit(1);
  return rows[0] ?? null;
}
