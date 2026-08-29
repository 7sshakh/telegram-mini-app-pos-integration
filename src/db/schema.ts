import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  OrderAddress,
  OrderPayment,
  OrderStatus,
  OrderTotals,
  OrderType,
  PosCatalog,
  PosSyncStatus,
  PromotionDef,
  Quote,
  QuoteLine,
  QuotePromo,
  StoreSettings,
} from "@/lib/types";

/** Telegram customers. The local POS stays the source of truth for orders. */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name"),
    username: text("username"),
    phone: text("phone"),
    languageCode: text("language_code"),
    photoUrl: text("photo_url"),
    authDate: integer("auth_date"),
    completedOrders: integer("completed_orders").notNull().default(0),
    totalSpent: integer("total_spent").notNull().default(0),
    loyaltyEligible: boolean("loyalty_eligible").notNull().default(false),
    isBlocked: boolean("is_blocked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("customers_telegram_id_key").on(table.telegramId)],
);

/** Opaque bearer sessions issued after Telegram initData validation. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
    index("sessions_customer_idx").on(table.customerId),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("other"),
    addressLine: text("address_line").notNull(),
    apartment: text("apartment"),
    entrance: text("entrance"),
    floor: text("floor"),
    landmark: text("landmark"),
    note: text("note"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("addresses_customer_idx").on(table.customerId)],
);

/** Mirror of the local POS menu. Never authoritative, only a read cache. */
export const catalogSnapshots = pgTable(
  "catalog_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: text("version").notNull(),
    source: text("source").notNull(),
    payload: jsonb("payload").$type<PosCatalog>().notNull(),
    promotions: jsonb("promotions").$type<PromotionDef[]>().notNull().default([]),
    settings: jsonb("settings").$type<StoreSettings | null>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("catalog_snapshots_fetched_idx").on(table.fetchedAt)],
);

/** Registered POS bridge devices (one per computer running the Electron POS). */
export const posDevices = pgTable(
  "pos_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: text("device_id").notNull(),
    name: text("name").notNull(),
    /** Hash of the registration secret issued by the admin (never the raw value). */
    secretHash: text("secret_hash").notNull(),
    /** Hash of the long lived agent token used by the local bridge agent. */
    tokenHash: text("token_hash").notNull(),
    fingerprint: text("fingerprint"),
    status: text("status").notNull().default("offline"),
    posVersion: text("pos_version"),
    agentVersion: text("agent_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull().default("admin"),
  },
  (table) => [uniqueIndex("pos_devices_device_id_key").on(table.deviceId)],
);

/** Durable outbox queue: cloud -> local POS. Survives POS downtime. */
export const posJobs = pgTable(
  "pos_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    orderId: uuid("order_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(30),
    lastError: text("last_error"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    claimedByDeviceId: text("claimed_by_device_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pos_jobs_dedupe_key").on(table.dedupeKey),
    index("pos_jobs_status_idx").on(table.status, table.availableAt),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNumber: text("order_number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    /** Client generated key, guarantees "duplicate tap" never creates 2 orders. */
    idempotencyKey: text("idempotency_key").notNull(),
    posOrderId: text("pos_order_id"),
    posOrderNumber: text("pos_order_number"),
    status: text("status").$type<OrderStatus>().notNull().default("new"),
    posSyncStatus: text("pos_sync_status").$type<PosSyncStatus>().notNull().default("pending"),
    orderType: text("order_type").$type<OrderType>().notNull(),
    asap: boolean("asap").notNull().default(true),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    address: jsonb("address").$type<OrderAddress | null>(),
    items: jsonb("items").$type<QuoteLine[]>().notNull(),
    totals: jsonb("totals").$type<OrderTotals>().notNull(),
    payment: jsonb("payment").$type<OrderPayment>().notNull(),
    promo: jsonb("promo").$type<QuotePromo>(),
    quote: jsonb("quote").$type<Quote | null>(),
    customerNote: text("customer_note"),
    etaMinutes: integer("eta_minutes").notNull().default(0),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    posSyncedAt: timestamp("pos_synced_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("orders_customer_idempotency_key").on(table.customerId, table.idempotencyKey),
    index("orders_customer_created_idx").on(table.customerId, table.createdAt),
    index("orders_pos_order_id_idx").on(table.posOrderId),
    index("orders_status_idx").on(table.status),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    label: text("label").notNull(),
    note: text("note"),
    actorType: text("actor_type").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("order_events_order_idx").on(table.orderId, table.createdAt)],
);

export const promoUsage = pgTable(
  "promo_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    promoCode: text("promo_code").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("promo_usage_customer_idx").on(table.customerId, table.promoCode)],
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    method: text("method").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("UZS"),
    status: text("status").notNull().default("created"),
    externalId: text("external_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    index("payment_intents_order_idx").on(table.orderId),
    index("payment_intents_status_idx").on(table.status),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_created_idx").on(table.createdAt)],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
