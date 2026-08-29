import { fail, isResponse, ok, requireCustomer, serverError } from "@/lib/api";
import { cancelOrderByCustomer, getOrderForCustomer } from "@/lib/orders";
import { findJobForOrder } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;
    const { id } = await context.params;
    const order = await getOrderForCustomer(id, authed.customer.id);
    if (!order) return fail("NOT_FOUND", "Buyurtma topilmadi.", 404);
    const job = await findJobForOrder(order.id);
    return ok({
      order,
      queue: job ? { status: job.status, attempts: job.attempts, lastError: job.lastError } : null,
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;
    const { id } = await context.params;
    const order = await cancelOrderByCustomer(id, authed.customer.id, "Mijoz bekor qildi");
    if (!order) return fail("VALIDATION", "Bu buyurtmani endi bekor qilib bo‘lmaydi. Operator bilan bog‘laning.", 422);
    return ok({ order });
  } catch (error) {
    return serverError(error);
  }
}
