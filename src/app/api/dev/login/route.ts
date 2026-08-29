import { z } from "zod";

import { db } from "@/db";
import { customers } from "@/db/schema";
import { clientIp, issueSession, rateLimit, toCustomerDTO } from "@/lib/auth";
import { fail, ok, parseBody, serverError } from "@/lib/api";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const schema = z.object({
  telegramId: z.coerce.number().int().min(1).max(1e15),
  name: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
});

/**
 * DEV ONLY helper so you can open the Mini App in a normal browser during
 * development. Returns 404 whenever DEV_MODE is off (production default).
 */
export async function POST(request: Request) {
  if (!env.devMode) return fail("NOT_FOUND", "Topilmadi.", 404);
  try {
    const limit = rateLimit(`devlogin:${clientIp(request) ?? "local"}`, 30, 60_000);
    if (!limit.ok) return fail("RATE_LIMITED", undefined, 429);

    const parsed = await parseBody(request, schema);
    if (!parsed.ok) return parsed.response;

    const upserted = await db
      .insert(customers)
      .values({
        telegramId: parsed.data.telegramId,
        firstName: parsed.data.name?.slice(0, 120) || "Dev mijoz",
        phone: parsed.data.phone?.slice(0, 30) ?? null,
        completedOrders: 2,
        loyaltyEligible: true,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: customers.telegramId,
        set: { lastSeenAt: new Date(), updatedAt: new Date() },
      })
      .returning();

    const customer = upserted[0];
    const session = await issueSession(customer.id, {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return ok({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      customer: toCustomerDTO(customer),
      note: "DEV_MODE sessiya. Ishlab chiqarishda o‘chiriladi.",
    });
  } catch (error) {
    return serverError(error);
  }
}
