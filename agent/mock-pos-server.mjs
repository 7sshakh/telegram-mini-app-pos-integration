#!/usr/bin/env node
/**
 * Mock VIBE POS server (DEVELOPMENT ONLY)
 * ---------------------------------------------------------------------------
 * Implements the exact localhost-only HTTP contract the real Electron POS
 * adapter should implement (see docs/POS-INTEGRATION.md). It lets you run the
 * whole system without touching the real POS or its SQLite file:
 *
 *   cloud (POS_MODE=pos)  <-agent-  this server
 *
 * It re-prices every incoming order, validates promotions, deducts stock,
 * prints a kitchen receipt and exposes status changes — exactly like the
 * real POS is expected to do.
 *
 *   node agent/mock-pos-server.mjs
 */

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MOCK_POS_PORT || 8787);
const TOKEN = process.env.POS_TOKEN || process.env.AGENT_POS_TOKEN || "dev-local-pos-token";

const MODS = [
  { id: "mod_cheese", name: "Qo‘shimcha pishloq", price: 3000, groupName: "Qo‘shimchalar", maxQty: 3 },
  { id: "mod_jalapeno", name: "Xalapenyo", price: 2000, groupName: "Qo‘shimchalar", maxQty: 3 },
  { id: "mod_bacon", name: "Bekon", price: 6000, groupName: "Qo‘shimchalar", maxQty: 2 },
  { id: "mod_sauce", name: "Ekstra sous", price: 2000, groupName: "Souslar", maxQty: 4 },
];

const menu = {
  catalog: {
    version: `mock-pos-${new Date().toISOString().slice(0, 16)}`,
    source: "pos",
    currency: "UZS",
    generatedAt: new Date().toISOString(),
    categories: [
      { id: "cat_hotdog", name: "Hotdoglar", emoji: "🌭", sortOrder: 1 },
      { id: "cat_burger", name: "Burgerlar", emoji: "🍔", sortOrder: 2 },
      { id: "cat_drink", name: "Ichimliklar", emoji: "🥤", sortOrder: 3 },
      { id: "cat_extra", name: "Qo‘shimchalar", emoji: "🍟", sortOrder: 4 },
    ],
    products: [
      { id: "hd_classic", categoryId: "cat_hotdog", name: "VIBE Classic hotdog", price: 22000, stock: 40, isAvailable: true, modifiers: MODS },
      { id: "hd_cheese", categoryId: "cat_hotdog", name: "Cheese hotdog", price: 27000, stock: 32, isAvailable: true, modifiers: MODS },
      { id: "hd_spicy", categoryId: "cat_hotdog", name: "Spicy hotdog", price: 28000, stock: 18, isAvailable: true, modifiers: MODS },
      { id: "bg_vibe", categoryId: "cat_burger", name: "VIBE Burger", price: 39000, stock: 25, isAvailable: true, modifiers: MODS },
      { id: "bg_double", categoryId: "cat_burger", name: "Double Cheese Burger", price: 55000, stock: 15, isAvailable: true, modifiers: MODS },
      { id: "dr_cola", categoryId: "cat_drink", name: "Cola 0.5", price: 9000, stock: 120, isAvailable: true, modifiers: [] },
      { id: "dr_lemonade", categoryId: "cat_drink", name: "Uy limonadi 0.4", price: 14000, stock: 60, isAvailable: true, modifiers: [] },
      { id: "ex_fries", categoryId: "cat_extra", name: "Fri kartoshka", price: 15000, stock: 70, isAvailable: true, modifiers: [] },
    ],
    settings: {
      brandName: "VIBE — HotDog · Burger · Drinks",
      currency: "UZS",
      deliveryEnabled: true,
      pickupEnabled: true,
      dineInEnabled: true,
      deliveryFee: 12000,
      freeDeliveryFrom: 150000,
      minOrderAmount: 30000,
      prepMinutes: 15,
      deliveryMinutes: 25,
      paymentMethods: [
        { id: "cash", label: "Naqd pul", enabled: true, requiresOnline: false },
        { id: "card_transfer", label: "Karta o‘tkazma", enabled: true, requiresOnline: false },
        { id: "terminal", label: "Bank terminal", enabled: true, requiresOnline: false },
        { id: "mixed", label: "Aralash to‘lov", enabled: true, requiresOnline: false },
        { id: "online", label: "Online to‘lov", enabled: false, requiresOnline: true },
      ],
      workHours: { open: "10:00", close: "23:30" },
      address: "Toshkent, Chilonzor 9-kvartal, VIBE",
      phone: "+998 90 000 00 00",
      location: { lat: 41.2755, lng: 69.2075 },
    },
  },
  promotions: [
    {
      code: "4PLUS1",
      title: "4+1 doimiy mijozlarga",
      type: "FOUR_PLUS_ONE",
      eligibleCategoryIds: ["cat_hotdog"],
      eligibleProductIds: [],
      minQty: 4,
      requiresPhone: true,
      requiresHistory: true,
      maxUsesPerCustomer: 5,
      activeFrom: null,
      activeUntil: null,
      enabled: true,
      priority: 100,
    },
    {
      code: "OPENING_2PLUS1",
      title: "Ochilish 2+1 burger",
      type: "TWO_PLUS_ONE",
      eligibleCategoryIds: ["cat_burger"],
      eligibleProductIds: [],
      minQty: 2,
      requiresPhone: false,
      requiresHistory: false,
      maxUsesPerCustomer: 1,
      activeFrom: null,
      activeUntil: new Date(Date.now() + 30 * 864e5).toISOString(),
      enabled: true,
      priority: 90,
    },
  ],
};

/** Simple recipe map: how much of each ingredient a product consumes. */
const RECIPES = {
  hd_classic: { bun: 1, sausage: 1, sauce: 2 },
  hd_cheese: { bun: 1, sausage: 1, cheese: 2, sauce: 2 },
  hd_spicy: { bun: 1, sausage: 1, cheese: 1, jalapeno: 3, sauce: 2 },
  bg_vibe: { bun: 1, beef: 1, cheese: 1, salad: 1, sauce: 2 },
  bg_double: { bun: 1, beef: 2, cheese: 2, salad: 1, sauce: 2 },
  dr_cola: { cola_bottle: 1 },
  dr_lemonade: { lemonade_cup: 1 },
  ex_fries: { potato: 1, sauce: 1 },
};

const stock = { bun: 200, sausage: 150, cheese: 120, jalapeno: 60, beef: 90, salad: 80, sauce: 400, cola_bottle: 140, lemonade_cup: 70, potato: 100 };

const orders = new Map(); // posOrderId -> order
const idempotency = new Map(); // idempotencyKey -> posOrderId
let counter = 1000;

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body);
}

function reprice(payload) {
  const products = menu.catalog.products;
  const lines = [];
  let itemsTotal = 0;

  for (const item of payload.items || []) {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product) return { error: `Mahsulot topilmadi: ${item.productId}` };
    if (!product.isAvailable) return { error: `${product.name} hozir mavjud emas` };
    if (product.stock !== null && product.stock < item.qty) {
      return { error: `${product.name} omborda yetarli emas (qoldi ${product.stock})` };
    }
    const modifiers = (item.modifiers || []).map((mod) => {
      const found = product.modifiers.find((entry) => entry.id === mod.id);
      if (!found) return null;
      return { id: found.id, name: found.name, price: found.price, qty: mod.qty || 1 };
    }).filter(Boolean);
    const unitPrice = product.price + modifiers.reduce((sum, mod) => sum + mod.price * mod.qty, 0);
    const lineTotal = unitPrice * item.qty;
    itemsTotal += lineTotal;
    lines.push({ productId: product.id, name: product.name, qty: item.qty, unitPrice, modifiers, lineTotal });
  }

  // promotions are re-validated by the POS (source of truth)
  let promo = null;
  let promoDiscount = 0;
  for (const promotion of menu.promotions) {
    if (!promotion.enabled) continue;
    if (promotion.type !== "FOUR_PLUS_ONE" && promotion.type !== "TWO_PLUS_ONE") continue;
    const units = [];
    for (const line of lines) {
      const product = products.find((entry) => entry.id === line.productId);
      if (!promotion.eligibleCategoryIds.includes(product.categoryId)) continue;
      for (let i = 0; i < line.qty; i += 1) units.push(product.price);
    }
    const need = promotion.minQty + 1;
    if (units.length >= need) {
      const cheapest = units.sort((a, b) => a - b)[0];
      promoDiscount += cheapest;
      promo = promotion;
    }
  }

  const subtotal = itemsTotal - promoDiscount;
  const deliveryFee = payload.orderType === "delivery" && subtotal < menu.catalog.settings.freeDeliveryFrom
    ? menu.catalog.settings.deliveryFee
    : 0;
  const total = subtotal + deliveryFee;

  return {
    lines,
    totals: { itemsTotal, subtotal, promoDiscount, deliveryFee, total, currency: "UZS" },
    promo: promo ? { code: promo.code, title: promo.title, discount: promoDiscount, freeItems: [] } : null,
  };
}

function deductStock(lines) {
  const products = menu.catalog.products;
  for (const line of lines) {
    const product = products.find((entry) => entry.id === line.productId);
    if (product && product.stock !== null) product.stock -= line.qty;
    const recipe = RECIPES[line.productId] || {};
    for (const [ingredient, amount] of Object.entries(recipe)) {
      if (stock[ingredient] !== undefined) stock[ingredient] = Math.max(0, stock[ingredient] - amount * line.qty);
    }
  }
}

function printKitchenReceipt(order) {
  console.log("\n================ OSHXONA CHEKI ================");
  console.log(`Buyurtma: ${order.orderNumber}  (${order.orderType})`);
  console.log(`Vaqt: ${order.createdAt.toISOString()}`);
  for (const line of order.items) {
    console.log(` ${line.qty} x ${line.name} ${line.modifiers.length ? "(" + line.modifiers.map((m) => m.name).join(", ") + ")" : ""}`);
  }
  console.log(` Jami: ${order.totals.total} so‘m  To‘lov: ${order.payment.method}`);
  if (order.address) console.log(` Manzil: ${order.address.addressLine}`);
  if (order.customerNote) console.log(` Izoh: ${order.customerNote}`);
  console.log("================================================\n");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const token = req.headers["x-pos-token"];

  if (token !== TOKEN) {
    return send(res, 401, { ok: false, message: "x-pos-token yaroqsiz" });
  }

  if (req.method === "GET" && url.pathname === "/internal/health") {
    return send(res, 200, { ok: true, service: "vibe-mock-pos", version: "1.0.0", orders: orders.size });
  }

  if (req.method === "GET" && url.pathname === "/internal/menu") {
    menu.catalog.version = `mock-pos-${new Date().toISOString().slice(0, 16)}`;
    menu.catalog.generatedAt = new Date().toISOString();
    return send(res, 200, menu);
  }

  if (req.method === "POST" && url.pathname === "/internal/orders") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

    const key = payload.idempotencyKey;
    if (key && idempotency.has(key)) {
      const existing = orders.get(idempotency.get(key));
      return send(res, 200, { ok: true, duplicate: true, orderId: existing.id, orderNumber: existing.orderNumber, status: existing.status });
    }

    const priced = reprice(payload);
    if (priced.error) {
      return send(res, 422, { ok: false, message: priced.error });
    }

    // POS is the pricing authority: mismatch => reject (never silently reprice)
    const expected = payload.validation?.expectedTotal;
    if (typeof expected === "number" && expected !== priced.totals.total) {
      return send(res, 422, {
        ok: false,
        message: `Narx mos kelmadi (cloud ${expected}, POS ${priced.totals.total}). Buyurtma rad etildi.`,
      });
    }

    const id = `pos-${crypto.randomUUID().slice(0, 8)}`;
    counter += 1;
    const order = {
      id,
      cloudOrderId: payload.orderId,
      orderNumber: `POS-${counter}`,
      orderType: payload.orderType,
      status: "accepted",
      statusNote: null,
      items: priced.lines,
      totals: priced.totals,
      promo: priced.promo,
      payment: payload.payment,
      address: payload.address,
      customerNote: payload.customerNote,
      createdAt: new Date(),
      changedAt: new Date().toISOString(),
    };

    deductStock(priced.lines);
    orders.set(id, order);
    if (key) idempotency.set(key, id);
    printKitchenReceipt(order);

    // simulate the kitchen starting the order
    setTimeout(() => {
      order.status = "preparing";
      order.changedAt = new Date().toISOString();
    }, 8000);

    return send(res, 200, { ok: true, orderId: id, orderNumber: order.orderNumber, status: order.status });
  }

  const statusMatch = url.pathname.match(/^\/internal\/orders\/([^/]+)\/status$/);
  if (req.method === "POST" && statusMatch) {
    const order = orders.get(statusMatch[1]);
    if (!order) return send(res, 404, { ok: false, message: "Buyurtma topilmadi" });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    order.status = body.status || order.status;
    order.statusNote = body.note || null;
    order.changedAt = new Date().toISOString();
    return send(res, 200, { ok: true, order });
  }

  const cancelMatch = url.pathname.match(/^\/internal\/orders\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const order = orders.get(cancelMatch[1]);
    if (!order) return send(res, 200, { ok: true, ignored: "unknown order" });
    order.status = "cancelled";
    order.statusNote = "POS/agent bekor qildi";
    order.changedAt = new Date().toISOString();
    return send(res, 200, { ok: true, order });
  }

  if (req.method === "GET" && url.pathname === "/internal/orders/changed") {
    const since = url.searchParams.get("since") || new Date(0).toISOString();
    const changed = [...orders.values()]
      .filter((order) => new Date(order.changedAt) > new Date(since))
      .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
      .slice(0, 50)
      .map((order) => ({
        posOrderId: order.id,
        cloudOrderId: order.cloudOrderId,
        orderNumber: order.orderNumber,
        status: order.status,
        statusNote: order.statusNote,
        changedAt: order.changedAt,
      }));
    return send(res, 200, { orders: changed });
  }

  if (req.method === "GET" && url.pathname === "/internal/stock") {
    return send(res, 200, { stock, products: menu.catalog.products.map((p) => ({ id: p.id, stock: p.stock })) });
  }

  return send(res, 404, { ok: false, message: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`VIBE mock POS listening on http://127.0.0.1:${PORT}`);
  console.log(`Token: ${TOKEN}`);
});
