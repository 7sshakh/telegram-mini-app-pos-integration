import { fail, isResponse, ok, parseBody, createOrderSchema, requireCustomer, serverError } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/auth";
import { createOrder, listOrdersForCustomer } from "@/lib/orders";
import { findJobForOrder } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1), 50);
    const orders = await listOrdersForCustomer(authed.customer.id, limit);
    return ok({ orders });
  } catch (error) {
    return serverError(error);
  }
}

/**
 * Creates an order and immediately queues it for the local POS.
 * `idempotencyKey` (generated in the Mini App) makes double taps safe.
 */
export async function POST(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;

    const limit = rateLimit(`order:${authed.customer.id}`, 12, 60_000);
    if (!limit.ok) return fail("RATE_LIMITED", undefined, 429);

    const parsed = await parseBody(request, createOrderSchema);
    if (!parsed.ok) return parsed.response;

    const scheduledFor = parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null;

    const result = await createOrder({
      customerId: authed.customer.id,
      customer: {
        telegramId: authed.customer.telegramId,
        firstName: authed.customer.firstName,
        lastName: authed.customer.lastName,
        username: authed.customer.username,
        phone: authed.customer.phone,
        completedOrders: authed.customer.completedOrders,
      },
      idempotencyKey: parsed.data.idempotencyKey,
      orderType: parsed.data.orderType,
      asap: parsed.data.asap,
      scheduledFor: scheduledFor && !Number.isNaN(scheduledFor.getTime()) ? scheduledFor : null,
      address: parsed.data.address
        ? {
            label: parsed.data.address.label,
            addressLine: parsed.data.address.addressLine,
            apartment: parsed.data.address.apartment,
            entrance: parsed.data.address.entrance,
            floor: parsed.data.address.floor,
            landmark: parsed.data.address.landmark,
            note: parsed.data.address.note,
            lat: parsed.data.address.lat ?? null,
            lng: parsed.data.address.lng ?? null,
          }
        : null,
      cart: parsed.data.cart,
      promoCode: parsed.data.promoCode ?? null,
      customerNote: parsed.data.customerNote ?? null,
      payment: parsed.data.payment,
      ip: clientIp(request),
    });

    if (!result.ok) {
      return fail(result.error.code, result.error.message, result.error.code === "POS_OFFLINE" ? 503 : 422, result.error.details);
    }

    const job = await findJobForOrder(result.order.id);
    return ok(
      {
        order: result.order,
        created: result.created,
        queue: job ? { status: job.status, attempts: job.attempts, lastError: job.lastError } : null,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return serverError(error);
  }
}
