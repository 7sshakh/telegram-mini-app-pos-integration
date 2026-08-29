import { ok, serverError } from "@/lib/api";
import { authenticateDevice, audit } from "@/lib/auth";
import { env } from "@/lib/env";
import { claimJobs, pendingJobCount, releaseExpiredJobs } from "@/lib/jobs";
import { isPosOnline, touchDevice } from "@/lib/catalog";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Long-polling job claim for the local POS agent.
 *
 * While the POS computer is offline nothing is lost: jobs stay in Postgres with
 * exponential backoff and are delivered as soon as the agent reconnects.
 */
export async function POST(request: Request) {
  try {
    const device = await authenticateDevice(request);
    if (!device) {
      return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Qurilma tokeni yaroqsiz." } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const url = new URL(request.url);
    const waitSeconds = Math.min(
      Math.max(Number.parseInt(url.searchParams.get("wait") ?? String(env.bridgePollSeconds), 10) || env.bridgePollSeconds, 0),
      55,
    );

    await touchDevice(device.deviceId, { status: "online" });
    await releaseExpiredJobs();

    const deadline = Date.now() + waitSeconds * 1000;
    let jobs = await claimJobs(device.deviceId, 5);

    while (jobs.length === 0 && Date.now() < deadline && !request.signal.aborted) {
      await sleep(1200);
      jobs = await claimJobs(device.deviceId, 5);
    }

    if (jobs.length > 0) {
      void audit({
        actorType: "pos",
        actorId: device.deviceId,
        action: "bridge.jobs_claimed",
        payload: { count: jobs.length, ids: jobs.map((job) => job.id) },
      });
    }

    return ok({
      jobs,
      pending: await pendingJobCount(),
      posOnline: await isPosOnline(),
      serverTime: new Date().toISOString(),
      leaseSeconds: env.bridgeJobLeaseSeconds,
    });
  } catch (error) {
    return serverError(error);
  }
}
