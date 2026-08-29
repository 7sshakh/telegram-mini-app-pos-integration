import { sql } from "drizzle-orm";

import { db } from "@/db";
import { fail, isResponse, ok, parseBody, quoteRequestSchema, requireCustomer, serverError } from "@/lib/api";
import { getCatalogBundle } from "@/lib/catalog";
import { buildQuote } from "@/lib/pricing";
import { onlinePaymentAvailable } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * Authoritative price recalculation. The Mini App shows optimistic numbers
 * locally but always calls this before checkout, so prices, promos, delivery
 * fee and stock are validated server side.
 */
export async function POST(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;

    const parsed = await parseBody(request, quoteRequestSchema);
    if (!parsed.ok) return parsed.response;

    const bundle = await getCatalogBundle();
    const promoCode = parsed.data.promoCode ?? null;

    const usedResult = await db.execute(
      sql`select promo_code, count(*)::int as count from promo_usage where customer_id = ${authed.customer.id} group by promo_code`,
    );
    const usedRows = (usedResult.rows ?? []) as unknown as { promo_code: string; count: number }[];
    const usage = new Map(usedRows.map((row) => [row.promo_code, row.count]));

    const result = buildQuote({
      catalog: bundle.catalog,
      lines: parsed.data.cart,
      orderType: parsed.data.orderType,
      promotions: bundle.promotions,
      promoCode,
      customer: {
        phone: authed.customer.phone,
        completedOrders: authed.customer.completedOrders,
        promoUseCount: promoCode ? (usage.get(promoCode.toUpperCase()) ?? 0) : 0,
      },
    });

    if (!result.ok) {
      return fail(result.error.code, result.error.message, 422, { productId: result.error.productId });
    }

    return ok({
      quote: result.quote,
      meta: {
        source: bundle.source,
        posOnline: bundle.posOnline,
        onlinePaymentAvailable: onlinePaymentAvailable(),
        customer: {
          phoneConfirmed: !!authed.customer.phone,
          completedOrders: authed.customer.completedOrders,
          loyaltyEligible: authed.customer.loyaltyEligible,
        },
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
