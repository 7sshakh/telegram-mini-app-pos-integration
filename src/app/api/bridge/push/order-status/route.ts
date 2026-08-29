import { fail, ok, parseBody, pushStatusSchema, serverError } from "@/lib/api";
import { audit, authenticateDevice } from "@/lib/auth";
import { touchDevice } from "@/lib/catalog";
import { updateOrderStatus } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * The POS (existing "Buyurtmalar" page) changes a status -> the agent pushes it
 * here -> the Mini App timeline updates in real time and the Telegram bot
 * notifies the customer.
 */
export async function POST(request: Request) {
  try {
    const device = await authenticateDevice(request);
    if (!device) return fail("UNAUTHORIZED", "Qurilma tokeni yaroqsiz.", 401);

    const parsed = await parseBody(request, pushStatusSchema);
    if (!parsed.ok) return parsed.response;
    if (!parsed.data.orderId && !parsed.data.posOrderId) {
      return fail("VALIDATION", "orderId yoki posOrderId kerak.", 422);
    }

    const order = await updateOrderStatus({
      orderId: parsed.data.orderId,
      posOrderId: parsed.data.posOrderId,
      status: parsed.data.status,
      note: parsed.data.note ?? null,
      actor: "pos",
    });

    await touchDevice(device.deviceId, { status: "online" });

    if (!order) {
      void audit({
        actorType: "pos",
        actorId: device.deviceId,
        action: "bridge.status_push_miss",
        payload: { posOrderId: parsed.data.posOrderId ?? null, orderId: parsed.data.orderId ?? null },
      });
      return fail("NOT_FOUND", "Buyurtma topilmadi.", 404);
    }

    return ok({ order });
  } catch (error) {
    return serverError(error);
  }
}
