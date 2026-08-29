import { describe, expect, it } from "vitest";

import { buildQuote, cashChange, deliveryFeeFor, validateMixedPayment } from "@/lib/pricing";
import type { PosCatalog, PromotionDef } from "@/lib/types";

const catalog: PosCatalog = {
  version: "test",
  source: "pos",
  currency: "UZS",
  generatedAt: new Date().toISOString(),
  categories: [
    { id: "hotdog", name: "Hotdoglar", sortOrder: 1 },
    { id: "drink", name: "Ichimliklar", sortOrder: 2 },
  ],
  products: [
    {
      id: "hd1",
      categoryId: "hotdog",
      name: "Classic hotdog",
      price: 22000,
      isAvailable: true,
      stock: 10,
      modifiers: [
        { id: "cheese", name: "Pishloq", price: 3000, maxQty: 3 },
        { id: "jalapeno", name: "Xalapenyo", price: 2000, maxQty: 2 },
      ],
    },
    {
      id: "hd2",
      categoryId: "hotdog",
      name: "Cheese hotdog",
      price: 27000,
      isAvailable: true,
      stock: 2,
      modifiers: [],
    },
    {
      id: "drink1",
      categoryId: "drink",
      name: "Cola",
      price: 9000,
      isAvailable: true,
      stock: null,
      modifiers: [],
    },
    {
      id: "off",
      categoryId: "hotdog",
      name: "O‘chirilgan",
      price: 10000,
      isAvailable: false,
      stock: 5,
      modifiers: [],
    },
  ],
  settings: {
    brandName: "VIBE",
    currency: "UZS",
    deliveryEnabled: true,
    pickupEnabled: true,
    dineInEnabled: false,
    deliveryFee: 12000,
    freeDeliveryFrom: 150000,
    minOrderAmount: 30000,
    prepMinutes: 15,
    deliveryMinutes: 25,
    paymentMethods: [
      { id: "cash", label: "Naqd", enabled: true, requiresOnline: false },
      { id: "mixed", label: "Aralash", enabled: true, requiresOnline: false },
    ],
    workHours: null,
    address: "",
    phone: "",
    location: { lat: 41, lng: 69 },
  },
};

const noPromotions: PromotionDef[] = [];
const customer = { phone: "+998901234567", completedOrders: 3, promoUseCount: 0 };

describe("buildQuote", () => {
  it("computes line totals from POS prices, including modifiers", () => {
    const result = buildQuote({
      catalog,
      lines: [{ productId: "hd1", qty: 2, modifiers: [{ id: "cheese", qty: 1 }, { id: "jalapeno", qty: 2 }] }],
      orderType: "pickup",
      promotions: noPromotions,
      customer,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 22000 + 3000 + 2*2000 = 29000 per unit
    expect(result.quote.lines[0].unitPrice).toBe(29000);
    expect(result.quote.itemsTotal).toBe(58000);
    expect(result.quote.deliveryFee).toBe(0);
    expect(result.quote.total).toBe(58000);
    expect(result.quote.etaMinutes).toBe(15);
  });

  it("rejects unknown products with an Uzbek message", () => {
    const result = buildQuote({
      catalog,
      lines: [{ productId: "nope", qty: 1, modifiers: [] }],
      orderType: "pickup",
      promotions: noPromotions,
      customer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(result.error.message).toContain("menyuda topilmadi");
  });

  it("rejects unavailable products", () => {
    const result = buildQuote({
      catalog,
      lines: [{ productId: "off", qty: 1, modifiers: [] }],
      orderType: "pickup",
      promotions: noPromotions,
      customer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("validates POS stock", () => {
    const result = buildQuote({
      catalog,
      lines: [{ productId: "hd2", qty: 3, modifiers: [] }],
      orderType: "pickup",
      promotions: noPromotions,
      customer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("OUT_OF_STOCK");
    expect(result.error.message).toContain("faqat 2 ta qoldi");
  });

  it("treats null stock as unlimited", () => {
    const result = buildQuote({
      catalog,
      lines: [{ productId: "drink1", qty: 40, modifiers: [] }],
      orderType: "pickup",
      promotions: noPromotions,
      customer,
    });
    expect(result.ok).toBe(true);
  });

  it("adds delivery fee and enforces the minimum order amount", () => {
    const tooSmall = buildQuote({
      catalog,
      lines: [{ productId: "drink1", qty: 1, modifiers: [] }],
      orderType: "delivery",
      promotions: noPromotions,
      customer,
    });
    expect(tooSmall.ok).toBe(false);
    if (tooSmall.ok) return;
    expect(tooSmall.error.code).toBe("MIN_ORDER");

    const result = buildQuote({
      catalog,
      lines: [{ productId: "hd1", qty: 2, modifiers: [] }],
      orderType: "delivery",
      promotions: noPromotions,
      customer,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.deliveryFee).toBe(12000);
    expect(result.quote.total).toBe(56000);
    expect(result.quote.etaMinutes).toBe(40);
  });

  it("gives free delivery above the threshold", () => {
    expect(deliveryFeeFor(catalog.settings, "delivery", 150000)).toBe(0);
    expect(deliveryFeeFor(catalog.settings, "delivery", 149999)).toBe(12000);
    expect(deliveryFeeFor(catalog.settings, "pickup", 150000)).toBe(0);
  });

  it("ignores client supplied prices entirely", () => {
    const result = buildQuote({
      catalog,
      lines: [
        {
          productId: "hd1",
          qty: 1,
          modifiers: [],
          // @ts-expect-error simulating a hostile client that injects a price
          price: 1,
          unitPrice: 1,
        },
      ],
      orderType: "pickup",
      promotions: noPromotions,
      customer,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.total).toBe(22000);
  });
});

describe("cash + mixed payments", () => {
  it("computes change", () => {
    expect(cashChange(100000, 86000)).toEqual({ ok: true, change: 14000, missing: 0 });
    expect(cashChange(50000, 86000)).toEqual({ ok: false, change: 0, missing: 36000 });
    expect(cashChange(0, 86000).ok).toBe(false);
  });

  it("validates mixed payment splits", () => {
    expect(validateMixedPayment(40000, 46000, 86000).ok).toBe(true);
    expect(validateMixedPayment(40000, 40000, 86000).ok).toBe(false);
    expect(validateMixedPayment(0, 0, 86000).ok).toBe(false);
    expect(validateMixedPayment(-1, 86001, 86000).ok).toBe(false);
  });
});
