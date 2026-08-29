import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { customers, orderEvents, orders, paymentIntents, posJobs, promoUsage } from "@/db/schema";
import { audit } from "@/lib/auth";
import { getCatalogBundle } from "@/lib/catalog";
import { enqueueJob } from "@/lib/jobs";
import { getPaymentProvider } from "@/lib/payments";
import { buildQuote, cashChange, validateMixedPayment } from "@/lib/pricing";
import { sendTelegramMessage } from "@/lib/telegram";
import { PAYMENT_LABELS, STATUS_LABELS, etaText } from "@/lib/uz";
import type { ApiErrorCode } from "@/lib/uz";
import type {
  CartLineInput,
  OrderAddress,
  OrderDTO,
  OrderPayment,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PosCatalog,
  PromotionDef,
  StoreSettings,
} from "@/lib/types";

export type OrderRow = typeof orders.$inferSelect;
type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CreateOrderInput = {
  customerId: string;
  customer: {
    telegramId: number;
    firstName: string;
    lastName: string | null;
    username: string | null;
    phone: string | null;
    completedOrders: number;
  };
  idempotencyKey: string;
  orderType: OrderType;
  asap: boolean;
  scheduledFor: Date | null;
  address: OrderAddress | null;
  cart: CartLineInput[];
  promoCode: string | null;
  customerNote: string | null;
  payment: {
    method: PaymentMethod;
    cashGiven?: number;
    cashPart?: number;
    cardPart?: number;
  };
  ip?: string | null;
};

export type CreateOrderResult =
  | { ok: true; created: boolean; order: OrderDTO }
  | { ok: false; error: { code: ApiErrorCode; message: string; details?: unknown } };

function fail(code: ApiErrorCode, message: string, details?: unknown): CreateOrderResult {
  return { ok: false, error: { code, message, details } };
}

async function nextOrderNumber(tx: DbLike): Promise<string> {
  const result = await tx.execute(
    sql`select count(*)::int as count from orders where created_at >= date_trunc('day', now())`,
  );
  const rows = (result.rows ?? []) as unknown as { count: number }[];
  const today = new Date();
  const stamp = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const seq = String((rows[0]?.count ?? 0) + 1).padStart(3, "0");
  return `V-${stamp}-${seq}`;
}

function buildPosPayload(options: {
  orderRow: OrderRow;
  catalog: PosCatalog;
  promotions: PromotionDef[];
  settings: StoreSettings;
}): Record<string, unknown> {
  const { orderRow } = options;
  return {
    version: 1,
    source: "telegram_mini_app",
    orderId: orderRow.id,
    orderNumber: orderRow.orderNumber,
    idempotencyKey: `${orderRow.idempotencyKey}:${orderRow.id}`,
    createdAt: orderRow.createdAt.toISOString(),
    orderType: orderRow.orderType,
    asap: orderRow.asap,
    scheduledFor: orderRow.scheduledFor?.toISOString() ?? null,
    address: orderRow.address,
    customerNote: orderRow.customerNote,
    items: orderRow.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      qty: item.qty,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      modifiers: item.modifiers,
      note: item.note ?? null,
    })),
    totals: orderRow.totals,
    promo: orderRow.promo
      ? { code: orderRow.promo.code, title: orderRow.promo.title, discount: orderRow.promo.discount, freeItems: orderRow.promo.freeItems }
      : null,
    payment: orderRow.payment,
    etaMinutes: orderRow.etaMinutes,
    // POS re-validates prices, promotions and stock before accepting.
    validation: {
      expectedItemsTotal: orderRow.totals.itemsTotal,
      expectedTotal: orderRow.totals.total,
      currency: orderRow.totals.currency,
      note: "POS must reject and re-price if its own calculation differs.",
    },
  };
}

export async function toOrderDTO(row: OrderRow): Promise<OrderDTO> {
  const events = await db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, row.id))
    .orderBy(orderEvents.createdAt);

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    posSyncStatus: row.posSyncStatus,
    posOrderId: row.posOrderId,
    orderType: row.orderType,
    asap: row.asap,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    items: row.items,
    totals: row.totals,
    payment: row.payment,
    promo: row.promo ?? null,
    address: row.address ?? null,
    customerNote: row.customerNote,
    etaMinutes: row.etaMinutes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    timeline: events.map((event) => ({
      status: event.status,
      label: event.label,
      note: event.note ?? undefined,
      at: event.createdAt.toISOString(),
    })),
  };
}

async function promoUseCount(customerId: string, code: string): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as count from promo_usage where customer_id = ${customerId} and promo_code = ${code}`,
  );
  const rows = (result.rows ?? []) as unknown as { count: number }[];
  return rows[0]?.count ?? 0;
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const key = (input.idempotencyKey ?? "").trim();
  if (key.length < 8 || key.length > 120) {
    return fail("IDEMPOTENCY", "Buyurtma kaliti noto‘g‘ri. Ilovani qaytadan oching.");
  }

  // Idempotency guard: a duplicate tap returns the very same order.
  const existing = await db
    .select()
    .from(orders)
    .where(and(eq(orders.customerId, input.customerId), eq(orders.idempotencyKey, key)))
    .limit(1);
  if (existing[0]) {
    return { ok: true, created: false, order: await toOrderDTO(existing[0]) };
  }

  const bundle = await getCatalogBundle();
  const activePromo = input.promoCode ? await promoUseCount(input.customerId, input.promoCode.toUpperCase()) : 0;

  const quoteResult = buildQuote({
    catalog: bundle.catalog,
    lines: input.cart,
    orderType: input.orderType,
    promotions: bundle.promotions,
    promoCode: input.promoCode,
    customer: {
      phone: input.customer.phone,
      completedOrders: input.customer.completedOrders,
      promoUseCount: activePromo,
    },
  });

  if (!quoteResult.ok) {
    return fail(quoteResult.error.code as ApiErrorCode, quoteResult.error.message, {
      productId: quoteResult.error.productId,
    });
  }

  const quote = quoteResult.quote;
  const settings = bundle.catalog.settings;

  if (input.orderType === "delivery" && !settings.deliveryEnabled) {
    return fail("VALIDATION", "Yetkazib berish hozir mavjud emas.");
  }
  if (input.orderType === "pickup" && !settings.pickupEnabled) {
    return fail("VALIDATION", "Olib ketish hozir mavjud emas.");
  }
  if (input.orderType === "dine_in" && !settings.dineInEnabled) {
    return fail("VALIDATION", "Zalda buyurtma berish hozir mavjud emas.");
  }
  if (input.orderType === "delivery" && (!input.address || !input.address.addressLine || input.address.addressLine.length < 4)) {
    return fail("VALIDATION", "Yetkazib berish uchun manzilni kiriting.");
  }

  const methodInfo = settings.paymentMethods.find((m) => m.id === input.payment.method);
  if (!methodInfo || !methodInfo.enabled) {
    return fail("VALIDATION", "Bu to‘lov turi hozir mavjud emas.");
  }

  const payment: OrderPayment = {
    method: input.payment.method,
    label: PAYMENT_LABELS[input.payment.method] ?? methodInfo.label,
    onlineStatus: "none",
  };

  if (input.payment.method === "cash") {
    const given = Math.round(input.payment.cashGiven ?? 0);
    if (given > 0) {
      const change = cashChange(given, quote.total);
      if (!change.ok) {
        return fail("VALIDATION", `Berilgan summa yetarli emas. Yana ${change.missing.toLocaleString("ru-RU")} so‘m kerak.`);
      }
      payment.cashGiven = given;
      payment.change = change.change;
    }
  }

  if (input.payment.method === "mixed") {
    const mixed = validateMixedPayment(input.payment.cashPart ?? 0, input.payment.cardPart ?? 0, quote.total);
    if (!mixed.ok) return fail("VALIDATION", mixed.message ?? "Aralash to‘lov summasi noto‘g‘ri.");
    payment.cashPart = Math.round(input.payment.cashPart ?? 0);
    payment.cardPart = Math.round(input.payment.cardPart ?? 0);
  }

  if (input.payment.method === "online") {
    const provider = getPaymentProvider();
    if (!provider.supportsOnline()) {
      return fail("VALIDATION", "Online to‘lov hozir sozlanmagan. Boshqa to‘lov turini tanlang.");
    }
    payment.provider = provider.key;
    payment.onlineStatus = "pending";
  }

  if (input.scheduledFor && input.scheduledFor.getTime() < Date.now() + 15 * 60 * 1000) {
    return fail("VALIDATION", "Rejalashtirilgan vaqt kamida 15 daqiqadan keyin bo‘lishi kerak.");
  }

  const totals = {
    itemsTotal: quote.itemsTotal,
    subtotal: quote.subtotal,
    promoDiscount: quote.promoDiscount,
    deliveryFee: quote.deliveryFee,
    total: quote.total,
    currency: bundle.catalog.currency,
  };

  let inserted: OrderRow | null = null;
  try {
    inserted = await db.transaction(async (tx) => {
      const orderNumber = await nextOrderNumber(tx);
      const [row] = await tx
        .insert(orders)
        .values({
          orderNumber,
          customerId: input.customerId,
          idempotencyKey: key,
          status: "new",
          posSyncStatus: "pending",
          orderType: input.orderType,
          asap: input.asap,
          scheduledFor: input.scheduledFor,
          address: input.address,
          items: quote.lines,
          totals,
          payment,
          promo: quote.promo,
          quote,
          customerNote: input.customerNote?.slice(0, 500) ?? null,
          etaMinutes: quote.etaMinutes,
        })
        .returning();

      await tx.insert(orderEvents).values({
        orderId: row.id,
        status: "new",
        label: "Buyurtma yaratildi",
        note: input.orderType === "delivery" ? etaText(quote.etaMinutes) : null,
        actorType: "customer",
      });

      if (quote.promo) {
        await tx.insert(promoUsage).values({
          customerId: input.customerId,
          promoCode: quote.promo.code,
          orderId: row.id,
        });
      }

      if (input.payment.method === "online") {
        await tx.insert(paymentIntents).values({
          orderId: row.id,
          provider: getPaymentProvider().key,
          method: "online",
          amount: quote.total,
          status: "pending",
          metadata: { orderNumber },
        });
      }

      // Durable outbox -> local POS. If the POS is offline the job waits here.
      await tx.insert(posJobs).values({
        type: "CREATE_ORDER",
        dedupeKey: `order:${row.id}`,
        orderId: row.id,
        payload: buildPosPayload({
          orderRow: row,
          catalog: bundle.catalog,
          promotions: bundle.promotions,
          settings,
        }),
      });

      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await db
        .select()
        .from(orders)
        .where(and(eq(orders.customerId, input.customerId), eq(orders.idempotencyKey, key)))
        .limit(1);
      if (raced[0]) return { ok: true, created: false, order: await toOrderDTO(raced[0]) };
    }
    throw error;
  }

  void audit({
    actorType: "customer",
    actorId: input.customerId,
    action: "order.created",
    targetType: "order",
    targetId: inserted.id,
    payload: { total: totals.total, orderType: input.orderType, promo: quote.promo?.code ?? null, source: bundle.source },
    ip: input.ip ?? null,
  });

  void sendTelegramMessage(
    input.customer.telegramId,
    `✅ <b>Buyurtma qabul qilindi</b>\n\nBuyurtma raqami: <b>${inserted.orderNumber}</b>\nSumma: <b>${totals.total.toLocaleString("ru-RU")} so‘m</b>\n${etaText(
      quote.etaMinutes,
    )}`,
  );

  return { ok: true, created: true, order: await toOrderDTO(inserted) };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export async function getOrderForCustomer(orderId: string, customerId: string): Promise<OrderDTO | null> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)))
    .limit(1);
  if (!rows[0]) return null;
  return toOrderDTO(rows[0]);
}

export async function listOrdersForCustomer(customerId: string, limit = 20): Promise<OrderDTO[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return Promise.all(rows.map((row) => toOrderDTO(row)));
}

export type PosOrderResult = {
  ok: boolean;
  posOrderId?: string;
  posOrderNumber?: string;
  status?: OrderStatus;
  error?: string;
  fatal?: boolean;
};

/** Called by the local agent when it finished pushing an order into the POS. */
export async function applyPosOrderResult(orderId: string, result: PosOrderResult): Promise<void> {
  const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return;

  if (result.ok) {
    await db
      .update(orders)
      .set({
        posSyncStatus: "synced",
        posOrderId: result.posOrderId ?? null,
        posOrderNumber: result.posOrderNumber ?? result.posOrderId ?? null,
        status: result.status ?? order.status,
        posSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    await db.insert(orderEvents).values({
      orderId,
      status: result.status ?? "accepted",
      label: result.status ? STATUS_LABELS[result.status] ?? "POS yangilandi" : "POS ga yuborildi",
      note: result.posOrderNumber ? `POS raqami: ${result.posOrderNumber}` : null,
      actorType: "pos",
    });
    return;
  }

  await db
    .update(orders)
    .set({ posSyncStatus: "failed", updatedAt: new Date(), cancelReason: result.error ?? null })
    .where(eq(orders.id, orderId));

  await db.insert(orderEvents).values({
    orderId,
    status: order.status,
    label: "POS ga yuborishda xatolik",
    note: result.error ?? null,
    actorType: "system",
  });

  void audit({
    actorType: "pos",
    action: "order.pos_sync_failed",
    targetType: "order",
    targetId: orderId,
    payload: { error: result.error ?? null, fatal: result.fatal ?? false },
  });
}

const NOTIFYABLE: OrderStatus[] = ["accepted", "preparing", "ready", "on_the_way", "delivered", "completed", "cancelled"];

/** POS pushed a status change (from the existing POS order page). */
export async function updateOrderStatus(options: {
  orderId?: string;
  posOrderId?: string;
  status: OrderStatus;
  note?: string | null;
  actor?: "pos" | "admin" | "customer" | "system";
}): Promise<OrderDTO | null> {
  const where = options.orderId
    ? eq(orders.id, options.orderId)
    : options.posOrderId
      ? eq(orders.posOrderId, options.posOrderId)
      : null;
  if (!where) return null;

  const rows = await db.select().from(orders).where(where).limit(1);
  const order = rows[0];
  if (!order) return null;
  if (order.status === options.status) return toOrderDTO(order);

  await db
    .update(orders)
    .set({ status: options.status, updatedAt: new Date() })
    .where(eq(orders.id, order.id));

  await db.insert(orderEvents).values({
    orderId: order.id,
    status: options.status,
    label: STATUS_LABELS[options.status] ?? options.status,
    note: options.note ?? null,
    actorType: options.actor ?? "pos",
  });

  const customerRows = await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1);
  const customer = customerRows[0];

  if (options.status === "delivered" || options.status === "completed") {
    await db
      .update(customers)
      .set({
        completedOrders: sql`${customers.completedOrders} + 1`,
        totalSpent: sql`${customers.totalSpent} + ${order.totals.total}`,
        loyaltyEligible: true,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, order.customerId));
  }

  if (customer && NOTIFYABLE.includes(options.status)) {
    const emoji: Record<string, string> = {
      accepted: "👨‍🍳",
      preparing: "🔥",
      ready: "✅",
      on_the_way: "🛵",
      delivered: "🤝",
      completed: "🎉",
      cancelled: "❌",
    };
    void sendTelegramMessage(
      customer.telegramId,
      `${emoji[options.status] ?? "ℹ️"} <b>${STATUS_LABELS[options.status] ?? options.status}</b>\n\nBuyurtma: <b>${order.orderNumber}</b>${
        options.note ? `\n${options.note}` : ""
      }`,
    );
  }

  return toOrderDTO(order);
}

export async function cancelOrderByCustomer(orderId: string, customerId: string, reason?: string): Promise<OrderDTO | null> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)))
    .limit(1);
  const order = rows[0];
  if (!order) return null;
  if (!["new", "accepted"].includes(order.status)) return null;

  await db
    .update(orders)
    .set({ status: "cancelled", cancelReason: reason ?? "Mijoz bekor qildi", updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  await db.insert(orderEvents).values({
    orderId,
    status: "cancelled",
    label: "Bekor qilindi",
    note: reason ?? "Mijoz buyurtmani bekor qildi",
    actorType: "customer",
  });

  await enqueueJob({
    type: "CANCEL_ORDER",
    dedupeKey: `cancel:${orderId}`,
    payload: { orderId, posOrderId: order.posOrderId, reason: reason ?? "customer_cancelled" },
    orderId,
  });

  return toOrderDTO(order);
}
