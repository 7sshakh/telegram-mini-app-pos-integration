import { eq } from "drizzle-orm";

import { db } from "@/db";
import { posDevices } from "@/db/schema";
import { deviceRegisterSchema, fail, ok, parseBody, serverError } from "@/lib/api";
import { audit, clientIp, hashToken, rateLimit, timingSafeEqual } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Device registration exchange.
 *
 * 1. Admin (POS owner) creates a device in /api/admin/devices -> gets
 *    deviceId + deviceSecret exactly once.
 * 2. The local agent calls this endpoint with those credentials and receives a
 *    long lived agent token. Only the hash of that token is stored in the cloud.
 *
 * The agent token never carries POS admin rights: it can only claim queued jobs
 * and push menu/order-status updates.
 */
export async function POST(request: Request) {
  try {
    const limited = rateLimit(`bridge-register:${clientIp(request) ?? "local"}`, 20, 60_000);
    if (!limited.ok) return fail("RATE_LIMITED", undefined, 429);

    const parsed = await parseBody(request, deviceRegisterSchema);
    if (!parsed.ok) return parsed.response;

    const rows = await db.select().from(posDevices).where(eq(posDevices.deviceId, parsed.data.deviceId)).limit(1);
    const device = rows[0];
    if (!device) return fail("UNAUTHORIZED", "Qurilma topilmadi.", 401);
    if (device.disabled) return fail("FORBIDDEN", "Qurilma bloklangan.", 403);
    if (!timingSafeEqual(hashToken(parsed.data.deviceSecret), device.secretHash)) {
      void audit({ actorType: "pos", actorId: device.id, action: "bridge.register_failed", ip: clientIp(request) });
      return fail("UNAUTHORIZED", "Qurilma kaliti noto‘g‘ri.", 401);
    }

    const agentToken = `${device.id}.${crypto.randomUUID()}${crypto.randomUUID()}`;
    await db
      .update(posDevices)
      .set({
        tokenHash: hashToken(agentToken),
        fingerprint: parsed.data.fingerprint ?? device.fingerprint,
        agentVersion: parsed.data.agentVersion ?? null,
        posVersion: parsed.data.posVersion ?? null,
        status: "online",
        lastSeenAt: new Date(),
      })
      .where(eq(posDevices.id, device.id));

    void audit({
      actorType: "pos",
      actorId: device.id,
      action: "bridge.registered",
      payload: { agentVersion: parsed.data.agentVersion ?? null, posVersion: parsed.data.posVersion ?? null },
      ip: clientIp(request),
    });

    return ok({
      agentToken,
      deviceId: device.deviceId,
      name: device.name,
      pollSeconds: env.bridgePollSeconds,
      jobLeaseSeconds: env.bridgeJobLeaseSeconds,
      maxAttempts: env.bridgeMaxAttempts,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}


