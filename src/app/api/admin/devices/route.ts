import crypto from "node:crypto";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { posDevices } from "@/db/schema";
import { fail, isResponse, ok, parseBody, serverError } from "@/lib/api";
import { audit, clientIp, hashToken, isAdminRequest } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function guard(request: Request): Response | null {
  if (!env.adminConfigured) {
    return fail("FORBIDDEN", "ADMIN_API_TOKEN sozlanmagan. Serverni sozlang.", 503);
  }
  if (!isAdminRequest(request)) return fail("FORBIDDEN", undefined, 403);
  return null;
}

export async function GET(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  try {
    const rows = await db.select().from(posDevices).orderBy(desc(posDevices.createdAt));
    return ok({
      devices: rows.map((device) => ({
        id: device.id,
        deviceId: device.deviceId,
        name: device.name,
        status: device.status,
        online: !!device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < 120_000,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        posVersion: device.posVersion,
        agentVersion: device.agentVersion,
        disabled: device.disabled,
        createdAt: device.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}

/** Issue device credentials. The secret is shown exactly once. */
export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  try {
    const parsed = await parseBody(
      request,
      z.object({ name: z.string().min(2).max(80), fingerprint: z.string().max(200).optional() }),
    );
    if (!parsed.ok) return parsed.response;

    const deviceId = `vibe-pos-${crypto.randomBytes(4).toString("hex")}`;
    const deviceSecret = crypto.randomBytes(24).toString("base64url");

    const inserted = await db
      .insert(posDevices)
      .values({
        deviceId,
        name: parsed.data.name,
        secretHash: hashToken(deviceSecret),
        // placeholder until the agent registers; agent token replaces it
        tokenHash: hashToken(crypto.randomUUID()),
        fingerprint: parsed.data.fingerprint ?? null,
        createdBy: "admin",
        status: "offline",
      })
      .returning();

    void audit({
      actorType: "admin",
      action: "device.created",
      targetType: "pos_device",
      targetId: inserted[0].id,
      payload: { deviceId, name: parsed.data.name },
      ip: clientIp(request),
    });

    return ok(
      {
        id: inserted[0].id,
        deviceId,
        name: parsed.data.name,
        // shown once — copy it into agent/agent.config.json now
        deviceSecret,
        next: "agent/agent.config.json ga DEVICE_ID va DEVICE_SECRET ni yozing, so‘ng agentni ishga tushiring.",
      },
      { status: 201 },
    );
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  try {
    const parsed = await parseBody(
      request,
      z.object({ id: z.string().uuid(), disabled: z.boolean().optional(), rotateSecret: z.boolean().optional() }),
    );
    if (!parsed.ok) return parsed.response;

    const rotate = parsed.data.rotateSecret
      ? { secretHash: hashToken(crypto.randomBytes(24).toString("base64url")), tokenHash: hashToken(crypto.randomUUID()) }
      : {};

    const updated = await db
      .update(posDevices)
      .set({ ...rotate, ...(parsed.data.disabled !== undefined ? { disabled: parsed.data.disabled } : {}) })
      .where(eq(posDevices.id, parsed.data.id))
      .returning();

    if (!updated[0]) return fail("NOT_FOUND", "Qurilma topilmadi.", 404);

    void audit({
      actorType: "admin",
      action: parsed.data.rotateSecret ? "device.rotated" : "device.updated",
      targetType: "pos_device",
      targetId: parsed.data.id,
      payload: { disabled: parsed.data.disabled ?? null },
      ip: clientIp(request),
    });

    return ok({ device: { id: updated[0].id, deviceId: updated[0].deviceId, disabled: updated[0].disabled } });
  } catch (error) {
    return serverError(error);
  }
}
