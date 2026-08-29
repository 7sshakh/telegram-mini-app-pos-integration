import crypto from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, customers, posDevices, sessions } from "@/db/schema";
import { env } from "@/lib/env";
import type { CustomerDTO } from "@/lib/types";

export const SESSION_TTL_DAYS = 30;

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHmac("sha256", env.sessionSecret).update(token).digest("hex");
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomToken(32);
  return { token, tokenHash: hashToken(token) };
}

export type AuthedCustomer = {
  customer: typeof customers.$inferSelect;
  sessionId: string;
};

export function toCustomerDTO(row: typeof customers.$inferSelect): CustomerDTO {
  return {
    id: row.id,
    telegramId: row.telegramId,
    firstName: row.firstName || "Mijoz",
    lastName: row.lastName,
    username: row.username,
    phone: row.phone,
    photoUrl: row.photoUrl,
    completedOrders: row.completedOrders,
    loyaltyEligible: row.loyaltyEligible,
    isNew: row.completedOrders === 0,
  };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const alt = request.headers.get("x-session-token");
  return alt ? alt.trim() : null;
}

export async function authenticateCustomer(request: Request): Promise<AuthedCustomer | null> {
  const token = bearerToken(request);
  if (!token || token.length < 16) return null;

  const rows = await db
    .select({ session: sessions, customer: customers })
    .from(sessions)
    .innerJoin(customers, eq(customers.id, sessions.customerId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) return null;
  if (row.customer.isBlocked) return null;

  // best-effort heartbeat, never blocks the request
  void db
    .update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessions.id, row.session.id))
    .catch(() => undefined);

  return { customer: row.customer, sessionId: row.session.id };
}

export async function issueSession(
  customerId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db.insert(sessions).values({
    customerId,
    tokenHash,
    expiresAt,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent?.slice(0, 250) ?? null,
  });
  return { token, expiresAt };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function isAdminRequest(request: Request): boolean {
  if (!env.adminConfigured) return false;
  const token =
    request.headers.get("x-admin-token") ??
    (request.headers.get("authorization")?.toLowerCase().startsWith("bearer ")
      ? request.headers.get("authorization")!.slice(7).trim()
      : null);
  return timingSafeEqual(token ?? "", env.adminApiToken);
}

export type AuthedDevice = typeof posDevices.$inferSelect;

export async function authenticateDevice(request: Request): Promise<AuthedDevice | null> {
  const token = bearerToken(request);
  if (!token || token.length < 16) return null;
  const rows = await db
    .select()
    .from(posDevices)
    .where(eq(posDevices.tokenHash, hashToken(token)))
    .limit(1);
  const device = rows[0];
  if (!device || device.disabled) return null;
  return device;
}

export async function audit(entry: {
  actorType: "customer" | "pos" | "admin" | "system" | "payment";
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      payload: entry.payload ?? null,
      ip: entry.ip ?? null,
    });
  } catch {
    // auditing must never break a request
  }
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

// --- tiny in-memory rate limiter (per instance) -----------------------------
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) buckets.clear();
    return { ok: true, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

export async function countCompletedOrders(customerId: string): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::text as count from orders where customer_id = ${customerId} and status in ('completed','delivered')`,
  );
  const rows = (result.rows ?? []) as unknown as { count: string }[];
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}
