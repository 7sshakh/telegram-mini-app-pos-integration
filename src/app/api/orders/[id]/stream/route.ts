import { authenticateCustomer } from "@/lib/auth";
import { getOrderForCustomer } from "@/lib/orders";
import { findJobForOrder } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream for live order tracking.
 * EventSource cannot send Authorization headers, so the session token is
 * passed as `?token=` and validated the same way as the bearer header.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? null;

  if (!token) return new Response("unauthorized", { status: 401 });
  const authed = await authenticateCustomer(
    new Request(url, { headers: { authorization: `Bearer ${token}` } }),
  );
  if (!authed) return new Response("unauthorized", { status: 401 });

  const initial = await getOrderForCustomer(id, authed.customer.id);
  if (!initial) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let lastSignature = JSON.stringify([initial.status, initial.posSyncStatus, initial.updatedAt, initial.timeline.length]);
      send("order", { order: initial, queue: await safeQueue(initial.id) });

      const startedAt = Date.now();
      const maxMs = 5 * 60 * 1000; // client reconnects after 5 minutes

      const tick = async () => {
        if (closed) return;
        try {
          const order = await getOrderForCustomer(id, authed.customer.id);
          if (order) {
            const signature = JSON.stringify([order.status, order.posSyncStatus, order.updatedAt, order.timeline.length]);
            if (signature !== lastSignature) {
              lastSignature = signature;
              send("order", { order, queue: await safeQueue(order.id) });
            } else {
              send("ping", { at: Date.now() });
            }
          }
        } catch {
          send("ping", { at: Date.now() });
        }
        if (Date.now() - startedAt > maxMs) {
          send("bye", { reconnect: true });
          close();
          return;
        }
        setTimeout(tick, 4000);
      };

      setTimeout(tick, 4000);
      request.signal.addEventListener("abort", () => close());

      function close() {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

async function safeQueue(orderId: string) {
  try {
    const job = await findJobForOrder(orderId);
    return job ? { status: job.status, attempts: job.attempts, lastError: job.lastError } : null;
  } catch {
    return null;
  }
}
