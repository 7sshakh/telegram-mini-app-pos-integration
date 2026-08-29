import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateCustomer, type AuthedCustomer } from "@/lib/auth";
import { apiError, type ApiErrorCode } from "@/lib/uz";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function fail(code: ApiErrorCode, message?: string, status = 400, details?: unknown) {
  return NextResponse.json(apiError(code, { message, details }), { status, headers: { "cache-control": "no-store" } });
}

export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  console.error("[api]", message);
  if (message === "POS_CATALOG_UNAVAILABLE") {
    return fail("POS_OFFLINE", undefined, 503);
  }
  if (message === "ONLINE_PAYMENT_NOT_CONFIGURED") {
    return fail("VALIDATION", "Online to‘lov hozir sozlanmagan.", 400);
  }
  return fail("INTERNAL", undefined, 500);
}

export async function requireCustomer(request: Request): Promise<AuthedCustomer | NextResponse> {
  const authed = await authenticateCustomer(request);
  if (!authed) return fail("UNAUTHORIZED", undefined, 401);
  return authed;
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<
  { ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }
> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail("VALIDATION", "So‘rov formati noto‘g‘ri.", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      response: fail("VALIDATION", `${first?.path?.join(".") ?? "ma’lumot"}: ${first?.message ?? "noto‘g‘ri"}`, 422),
    };
  }
  return { ok: true, data: parsed.data };
}

// --- request schemas -------------------------------------------------------

export const modifierInputSchema = z.object({
  id: z.string().min(1).max(80),
  qty: z.coerce.number().int().min(0).max(20).default(1),
});

export const cartLineSchema = z.object({
  productId: z.string().min(1).max(80),
  qty: z.coerce.number().int().min(1).max(50),
  modifiers: z.array(modifierInputSchema).max(20).default([]),
  note: z.string().max(240).optional(),
});

export const orderTypeSchema = z.enum(["delivery", "pickup", "dine_in"]);
export const paymentMethodSchema = z.enum(["cash", "card_transfer", "terminal", "mixed", "online"]);

export const addressSchema = z.object({
  label: z.enum(["home", "work", "other"]).default("other"),
  addressLine: z.string().min(3).max(300),
  apartment: z.string().max(60).optional(),
  entrance: z.string().max(60).optional(),
  floor: z.string().max(60).optional(),
  landmark: z.string().max(160).optional(),
  note: z.string().max(300).optional(),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
});

export const quoteRequestSchema = z.object({
  cart: z.array(cartLineSchema).min(1).max(40),
  orderType: orderTypeSchema,
  promoCode: z.string().max(40).nullish(),
});

export const createOrderSchema = z.object({
  idempotencyKey: z.string().min(8).max(120),
  orderType: orderTypeSchema,
  asap: z.boolean().default(true),
  scheduledFor: z.string().min(8).max(40).nullish(),
  address: addressSchema.nullish(),
  cart: z.array(cartLineSchema).min(1).max(40),
  promoCode: z.string().max(40).nullish(),
  customerNote: z.string().max(500).nullish(),
  payment: z.object({
    method: paymentMethodSchema,
    cashGiven: z.coerce.number().int().min(0).max(100_000_000).optional(),
    cashPart: z.coerce.number().int().min(0).max(100_000_000).optional(),
    cardPart: z.coerce.number().int().min(0).max(100_000_000).optional(),
  }),
});

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?998\d{9}$|^\d{9}$/, "Telefon raqamini +998XXXXXXXXX ko‘rinishida kiriting");

export const deviceRegisterSchema = z.object({
  deviceId: z.string().min(4).max(80),
  deviceSecret: z.string().min(8).max(200),
  name: z.string().min(2).max(80),
  fingerprint: z.string().max(200).optional(),
  agentVersion: z.string().max(40).optional(),
  posVersion: z.string().max(40).optional(),
});

export const jobResultSchema = z.object({
  ok: z.boolean(),
  posOrderId: z.string().max(120).optional(),
  posOrderNumber: z.string().max(120).optional(),
  status: z.enum(["new", "accepted", "preparing", "ready", "on_the_way", "delivered", "completed", "cancelled"]).optional(),
  error: z.string().max(500).optional(),
  fatal: z.boolean().optional(),
  retryInSeconds: z.coerce.number().int().min(1).max(3600).optional(),
});

export const pushCatalogSchema = z.object({
  catalog: z.object({
    version: z.string().min(1).max(80),
    source: z.enum(["pos", "mock"]).default("pos"),
    currency: z.enum(["UZS"]).default("UZS"),
    generatedAt: z.string().max(60).optional(),
    categories: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          name: z.string().min(1).max(120),
          emoji: z.string().max(12).optional(),
          sortOrder: z.coerce.number().int().default(0),
        }),
      )
      .max(60),
    products: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          categoryId: z.string().min(1).max(80),
          name: z.string().min(1).max(200),
          description: z.string().max(600).optional(),
          price: z.coerce.number().int().min(0),
          oldPrice: z.coerce.number().int().min(0).optional(),
          imageUrl: z.string().url().max(600).optional(),
          isAvailable: z.boolean().default(true),
          stock: z.coerce.number().int().min(0).nullable().optional(),
          modifiers: z
            .array(
              z.object({
                id: z.string().min(1).max(80),
                name: z.string().min(1).max(160),
                price: z.coerce.number().int().min(0).default(0),
                groupName: z.string().max(120).optional(),
                maxQty: z.coerce.number().int().min(1).max(20).optional(),
              }),
            )
            .max(60)
            .default([]),
          tags: z.array(z.string().max(30)).max(10).optional(),
        }),
      )
      .max(500),
    settings: z.object({
      brandName: z.string().min(1).max(160),
      currency: z.enum(["UZS"]).default("UZS"),
      deliveryEnabled: z.boolean().default(true),
      pickupEnabled: z.boolean().default(true),
      dineInEnabled: z.boolean().default(false),
      deliveryFee: z.coerce.number().int().min(0).default(0),
      freeDeliveryFrom: z.coerce.number().int().min(0).default(0),
      minOrderAmount: z.coerce.number().int().min(0).default(0),
      prepMinutes: z.coerce.number().int().min(0).default(15),
      deliveryMinutes: z.coerce.number().int().min(0).default(20),
      paymentMethods: z
        .array(
          z.object({
            id: paymentMethodSchema,
            label: z.string().max(80),
            hint: z.string().max(160).optional(),
            enabled: z.boolean().default(true),
            requiresOnline: z.boolean().default(false),
          }),
        )
        .max(10),
      workHours: z
        .object({ open: z.string().max(10), close: z.string().max(10) })
        .nullable()
        .optional(),
      address: z.string().max(300).default(""),
      phone: z.string().max(60).default(""),
      location: z.object({ lat: z.coerce.number(), lng: z.coerce.number() }).default({ lat: 41.2755, lng: 69.2075 }),
    }),
  }),
  promotions: z
    .array(
      z.object({
        code: z.string().min(1).max(60),
        title: z.string().min(1).max(160),
        description: z.string().max(400).optional(),
        type: z.enum(["FOUR_PLUS_ONE", "TWO_PLUS_ONE", "PERCENT", "FIXED"]),
        eligibleCategoryIds: z.array(z.string().max(80)).max(40).default([]),
        eligibleProductIds: z.array(z.string().max(80)).max(200).default([]),
        minQty: z.coerce.number().int().min(1).max(50).default(1),
        discountPercent: z.coerce.number().int().min(0).max(100).optional(),
        discountAmount: z.coerce.number().int().min(0).optional(),
        requiresPhone: z.boolean().default(false),
        requiresHistory: z.boolean().default(false),
        maxUsesPerCustomer: z.coerce.number().int().min(1).max(1000).nullable().optional(),
        activeFrom: z.string().max(60).nullable().optional(),
        activeUntil: z.string().max(60).nullable().optional(),
        enabled: z.boolean().default(true),
        priority: z.coerce.number().int().min(0).max(1000).default(0),
      }),
    )
    .max(40)
    .default([]),
});

export const pushStatusSchema = z.object({
  orderId: z.string().uuid().optional(),
  posOrderId: z.string().max(120).optional(),
  status: z.enum(["new", "accepted", "preparing", "ready", "on_the_way", "delivered", "completed", "cancelled"]),
  note: z.string().max(400).nullish(),
});
