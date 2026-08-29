import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { orders, paymentIntents } from "@/db/schema";
import { fail, isResponse, ok, parseBody, requireCustomer, serverError } from "@/lib/api";
import { audit } from "@/lib/auth";
import { env } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments";

export const dynamic = "force-dynamic";

const schema = z.object({ orderId: z.string().uuid() });

/**
 * Creates a provider payment intent for an unpaid online order.
 * Credentials never leave the server: the client only gets an opaque
 * checkout URL + intent id.
 */
export async function POST(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;

    const parsed = await parseBody(request, schema);
    if (!parsed.ok) return parsed.response;

    const rows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, parsed.data.orderId), eq(orders.customerId, authed.customer.id)))
      .limit(1);
    const order = rows[0];
    if (!order) return fail("NOT_FOUND", "Buyurtma topilmadi.", 404);
    if (order.payment.method !== "online") return fail("VALIDATION", "Bu buyurtma online to‘lov uchun emas.", 422);
    if (order.payment.onlineStatus === "paid") return fail("VALIDATION", "To‘lov allaqachon qabul qilingan.", 422);

    const provider = getPaymentProvider();
    if (!provider.supportsOnline()) {
      return fail("VALIDATION", "Online to‘lov hozir sozlanmagan.", 422);
    }

    const existing = await db
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.orderId, order.id), eq(paymentIntents.status, "pending")))
      .limit(1);

    if (existing[0]) {
      return ok({ intentId: existing[0].id, status: existing[0].status, provider: existing[0].provider });
    }

    const intent = await provider.createIntent({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: order.totals.total,
      currency: order.totals.currency,
      description: `${env.telegramBotUsername || "VIBE"} buyurtma ${order.orderNumber}`,
      returnUrl: `${env.appBaseUrl}/?order=${order.id}`,
    });

    const inserted = await db
      .insert(paymentIntents)
      .values({
        orderId: order.id,
        provider: intent.provider,
        method: "online",
        amount: order.totals.total,
        status: "pending",
        metadata: { checkoutUrl: intent.checkoutUrl },
      })
      .returning();

    void audit({
      actorType: "customer",
      actorId: authed.customer.id,
      action: "payment.intent_created",
      targetType: "order",
      targetId: order.id,
      payload: { provider: intent.provider, amount: order.totals.total },
    });

    return ok({
      intentId: inserted[0].id,
      provider: intent.provider,
      status: "pending",
      checkoutUrl: intent.checkoutUrl,
      instructionsUz: intent.instructionsUz,
    });
  } catch (error) {
    return serverError(error);
  }
}
