import { z } from "zod";

import { db } from "@/db";
import { customers } from "@/db/schema";
import { audit, clientIp, issueSession, rateLimit, toCustomerDTO } from "@/lib/auth";
import { fail, ok, parseBody, serverError } from "@/lib/api";
import { env } from "@/lib/env";
import { validateInitData } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  initData: z.string().min(8).max(8000),
  webAppVersion: z.string().max(40).optional(),
  platform: z.string().max(40).optional(),
});

/**
 * Telegram login. The Mini App sends `Telegram.WebApp.initData`, we verify the
 * HMAC signature with the bot token, then mint an opaque session token.
 * Customers never see or need a password.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limit = rateLimit(`auth:${ip ?? "local"}`, 40, 60_000);
    if (!limit.ok) {
      return fail("RATE_LIMITED", undefined, 429);
    }

    const parsed = await parseBody(request, bodySchema);
    if (!parsed.ok) return parsed.response;

    const validation = validateInitData(parsed.data.initData);
    if (!validation.ok) {
      return fail(validation.code, validation.message, validation.code === "SESSION_EXPIRED" ? 440 : 401);
    }

    const user = validation.user;
    const upserted = await db
      .insert(customers)
      .values({
        telegramId: user.id,
        firstName: (user.first_name ?? "Mijoz").slice(0, 120),
        lastName: user.last_name?.slice(0, 120) ?? null,
        username: user.username?.slice(0, 120) ?? null,
        languageCode: user.language_code?.slice(0, 12) ?? null,
        photoUrl: user.photo_url?.slice(0, 500) ?? null,
        authDate: validation.authDate,
        lastSeenAt: new Date(),
        loyaltyEligible: false,
      })
      .onConflictDoUpdate({
        target: customers.telegramId,
        set: {
          firstName: (user.first_name ?? "Mijoz").slice(0, 120),
          lastName: user.last_name?.slice(0, 120) ?? null,
          username: user.username?.slice(0, 120) ?? null,
          photoUrl: user.photo_url?.slice(0, 500) ?? null,
          languageCode: user.language_code?.slice(0, 12) ?? null,
          authDate: validation.authDate,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    const customer = upserted[0];
    if (customer.isBlocked) {
      return fail("FORBIDDEN", "Profilngiz bloklangan. Operator bilan bog‘laning.", 403);
    }

    const session = await issueSession(customer.id, {
      ip,
      userAgent: request.headers.get("user-agent"),
    });

    void audit({
      actorType: "customer",
      actorId: customer.id,
      action: "auth.telegram_login",
      payload: { verified: validation.verified, platform: parsed.data.platform ?? null },
      ip,
    });

    return ok({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      verified: validation.verified,
      botConfigured: env.telegramConfigured,
      startParam: validation.startParam ?? null,
      customer: toCustomerDTO(customer),
    });
  } catch (error) {
    return serverError(error);
  }
}
