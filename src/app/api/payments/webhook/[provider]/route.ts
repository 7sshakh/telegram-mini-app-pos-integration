import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { customers, orderEvents, orders, paymentIntents } from "@/db/schema";
import { ok, serverError } from "@/lib/api";
import { audit } from "@/lib/auth";
import { getPaymentProvider } from "@/lib/payments";
import { updateOrderStatus } from "@/lib/orders";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Provider webhook. This is the ONLY place where an online payment can be
 * marked as successful — the client can never confirm its own payment.
 * Signature is verified with the provider secret before anything is trusted.
 */
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: providerKey } = await context.params;
    const provider = getPaymentProvider(providerKey);
    const rawBody = await request.text();

    const verdict = provider.verifyWebhook(rawBody, request.headers);
    if (!verdict.ok) {
      void audit({
        actorType: "payment",
        action: "payment.webhook_rejected",
        payload: { provider: providerKey, reason: verdict.error },
      });
      return new Response(JSON.stringify({ error: "invalid-signature" }), { status: 400 });
    }

    let parsed: { order_id?: string; order_number?: string; amount?: number } = {};
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      parsed = {};
    }

    const orderId = parsed.order_id ?? null;
    if (!orderId) {
      void audit({ actorType: "payment", action: "payment.webhook_missing_order", payload: { provider: providerKey } });
      return ok({ received: true, ignored: "no order reference" });
    }

    const intentRows = await db
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.orderId, orderId), eq(paymentIntents.provider, providerKey)))
      .orderBy(desc(paymentIntents.createdAt))
      .limit(1);
    const intent = intentRows[0];
    if (!intent) {
      void audit({ actorType: "payment", action: "payment.webhook_unknown_intent", payload: { provider: providerKey, orderId } });
      return ok({ received: true, ignored: "unknown intent" });
    }

    // Idempotent webhook handling.
    if (intent.status === "succeeded" || intent.status === "failed") {
      return ok({ received: true, duplicate: true });
    }

    const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = orderRows[0];

    await db
      .update(paymentIntents)
      .set({
        status: verdict.status,
        externalId: verdict.externalId ?? intent.externalId,
        rawPayload: (() => {
          try {
            return JSON.parse(rawBody) as Record<string, unknown>;
          } catch {
            return { raw: rawBody.slice(0, 2000) };
          }
        })(),
        confirmedAt: new Date(),
      })
      .where(eq(paymentIntents.id, intent.id));

    if (order) {
      await db
        .update(orders)
        .set({
          payment: {
            ...order.payment,
            onlineStatus: verdict.status === "succeeded" ? "paid" : "failed",
            intentId: intent.id,
          },
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      await db.insert(orderEvents).values({
        orderId: order.id,
        status: order.status,
        label: verdict.status === "succeeded" ? "To‘lov tasdiqlandi" : "To‘lov amalga oshmadi",
        note: `${provider.labelUz} webhook`,
        actorType: "payment",
      });

      if (verdict.status === "failed") {
        await updateOrderStatus({ orderId: order.id, status: "cancelled", note: "To‘lov amalga oshmadi", actor: "system" });
      }

      const customerRows = await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1);
      const customer = customerRows[0];
      if (customer) {
        void sendTelegramMessage(
          customer.telegramId,
          verdict.status === "succeeded"
            ? `💳 To‘lov qabul qilindi.\n\nBuyurtma: <b>${order.orderNumber}</b>\nSumma: <b>${order.totals.total.toLocaleString("ru-RU")} so‘m</b>`
            : `⚠️ To‘lov amalga oshmadi.\n\nBuyurtma: <b>${order.orderNumber}</b>`,
        );
      }
    }

    void audit({
      actorType: "payment",
      action: "payment.webhook_applied",
      targetType: "order",
      targetId: orderId,
      payload: { provider: providerKey, status: verdict.status, amount: verdict.amount ?? null },
    });

    return ok({ received: true, status: verdict.status });
  } catch (error) {
    return serverError(error);
  }
}
