import { describe, expect, it } from "vitest";

import { evaluatePromotions } from "@/lib/promotions";
import type { PromotionDef, QuoteLine } from "@/lib/types";

const promo = (overrides: Partial<PromotionDef>): PromotionDef => ({
  code: "4PLUS1",
  title: "4+1 hotdog",
  type: "FOUR_PLUS_ONE",
  eligibleCategoryIds: ["hotdog"],
  eligibleProductIds: [],
  minQty: 4,
  requiresPhone: true,
  requiresHistory: true,
  maxUsesPerCustomer: 5,
  activeFrom: null,
  activeUntil: null,
  enabled: true,
  priority: 100,
  ...overrides,
});

const line = (productId: string, basePrice: number, qty: number, categoryId = "hotdog"): QuoteLine => ({
  productId,
  name: productId,
  qty,
  unitPrice: basePrice,
  modifiers: [],
  lineTotal: basePrice * qty,
});

const categoryOf = (productId: string) => (productId.startsWith("drink") ? "drink" : "hotdog");

describe("evaluatePromotions", () => {
  it("applies 4+1 when the cart holds 5 eligible units (cheapest is free)", () => {
    const lines = [line("hd1", 22000, 4), line("hd2", 27000, 1)];
    const result = evaluatePromotions({
      promotions: [promo({})],
      lines,
      categoryOf,
      customer: { phone: "+998901234567", completedOrders: 2, promoUseCount: 0 },
      subtotal: lines.reduce((sum, item) => sum + item.lineTotal, 0),
    });

    expect(result.applied?.code).toBe("4PLUS1");
    expect(result.applied?.discount).toBe(22000);
    expect(result.applied?.freeItems).toEqual([{ productId: "hd1", name: "hd1", qty: 1 }]);
    expect(result.explanations[0].applied).toBe(true);
    expect(result.explanations[0].reason).toContain("bepul");
  });

  it("gives two free items when the cart holds 10 eligible units", () => {
    const lines = [line("hd1", 22000, 8), line("hd2", 27000, 2)];
    const result = evaluatePromotions({
      promotions: [promo({})],
      lines,
      categoryOf,
      customer: { phone: "+998901234567", completedOrders: 2, promoUseCount: 0 },
      subtotal: 230000,
    });
    expect(result.applied?.discount).toBe(44000);
    expect(result.explanations[0].reason).toContain("2 ta bepul");
  });

  it("explains what is missing instead of applying the promo", () => {
    const lines = [line("hd1", 22000, 3)];
    const result = evaluatePromotions({
      promotions: [promo({})],
      lines,
      categoryOf,
      customer: { phone: "+998901234567", completedOrders: 2, promoUseCount: 0 },
      subtotal: 66000,
    });

    expect(result.applied).toBeNull();
    expect(result.explanations[0].progress).toEqual({ have: 3, need: 5 });
    expect(result.explanations[0].available).toBe(true);
  });

  it("requires a verified phone number", () => {
    const result = evaluatePromotions({
      promotions: [promo({})],
      lines: [line("hd1", 22000, 5)],
      categoryOf,
      customer: { phone: null, completedOrders: 5, promoUseCount: 0 },
      subtotal: 110000,
    });
    expect(result.applied).toBeNull();
    expect(result.explanations[0].reason).toContain("telefon raqamingiz kerak");
  });

  it("requires previous order history (loyalty promo for returning customers)", () => {
    const result = evaluatePromotions({
      promotions: [promo({})],
      lines: [line("hd1", 22000, 5)],
      categoryOf,
      customer: { phone: "+998901234567", completedOrders: 0, promoUseCount: 0 },
      subtotal: 110000,
    });
    expect(result.applied).toBeNull();
    expect(result.explanations[0].reason).toContain("birinchi buyurtmangizdan keyin");
  });

  it("respects per customer usage limits", () => {
    const result = evaluatePromotions({
      promotions: [promo({ maxUsesPerCustomer: 1 })],
      lines: [line("hd1", 22000, 5)],
      categoryOf,
      customer: { phone: "+998901234567", completedOrders: 2, promoUseCount: 1 },
      subtotal: 110000,
    });
    expect(result.applied).toBeNull();
    expect(result.explanations[0].reason).toContain("1 marta");
  });

  it("ignores expired and disabled promotions", () => {
    const expired = evaluatePromotions({
      promotions: [promo({ activeUntil: "2020-01-01T00:00:00.000Z" })],
      lines: [line("hd1", 22000, 5)],
      categoryOf,
      customer: { phone: "+998901234567", completedOrders: 2, promoUseCount: 0 },
      subtotal: 110000,
    });
    expect(expired.applied).toBeNull();
    expect(expired.explanations[0].reason).toContain("muddati tugagan");

    const disabled = evaluatePromotions({
      promotions: [promo({ enabled: false })],
      lines: [line("hd1", 22000, 5)],
      categoryOf,
      customer: { phone: "+998901234567", completedOrders: 2, promoUseCount: 0 },
      subtotal: 110000,
    });
    expect(disabled.applied).toBeNull();
    expect(disabled.explanations[0].reason).toContain("to‘xtatilgan");
  });

  it("only counts eligible categories for 2+1 opening promo", () => {
    const opening = promo({
      code: "OPENING_2PLUS1",
      title: "Ochilish 2+1",
      type: "TWO_PLUS_ONE",
      eligibleCategoryIds: ["burger"],
      minQty: 2,
      requiresPhone: false,
      requiresHistory: false,
      maxUsesPerCustomer: null,
    });

    const withBurgers = evaluatePromotions({
      promotions: [opening],
      lines: [line("bg1", 39000, 3, "burger")],
      categoryOf: (id) => (id === "bg1" ? "burger" : "hotdog"),
      customer: { phone: null, completedOrders: 0, promoUseCount: 0 },
      subtotal: 117000,
    });
    expect(withBurgers.applied?.discount).toBe(39000);

    const onlyHotdogs = evaluatePromotions({
      promotions: [opening],
      lines: [line("hd1", 22000, 5)],
      categoryOf,
      customer: { phone: null, completedOrders: 0, promoUseCount: 0 },
      subtotal: 110000,
    });
    expect(onlyHotdogs.applied).toBeNull();
    expect(onlyHotdogs.explanations[0].progress).toEqual({ have: 0, need: 3 });
  });

  it("keeps the more valuable promo and explains why the code was not used", () => {
    const promos = [
      promo({ code: "SMALL", title: "Kichik chegirma", type: "PERCENT", discountPercent: 5, minQty: 1, requiresPhone: false, requiresHistory: false, priority: 10 }),
      promo({ code: "BIG", title: "Katta chegirma", type: "PERCENT", discountPercent: 20, minQty: 1, requiresPhone: false, requiresHistory: false, priority: 20 }),
    ];
    const result = evaluatePromotions({
      promotions: promos,
      lines: [line("hd1", 22000, 5)],
      categoryOf,
      customer: { phone: null, completedOrders: 0, promoUseCount: 0 },
      subtotal: 110000,
      requestedCode: "SMALL",
    });

    expect(result.applied?.code).toBe("BIG");
    const small = result.explanations.find((item) => item.code === "SMALL");
    expect(small?.applied).toBe(false);
    expect(small?.reason).toContain("foydaliroq");
  });

  it("applies PERCENT discounts only to eligible items, never the whole cart", () => {
    const comboPromo = promo({
      code: "VIBE10",
      title: "Kombolarga 10%",
      type: "PERCENT",
      discountPercent: 10,
      eligibleCategoryIds: ["combo"],
      eligibleProductIds: [],
      minQty: 1,
      requiresPhone: false,
      requiresHistory: false,
      maxUsesPerCustomer: null,
    });

    // 1 combo (50 000) + 2 hotdogs (44 000) -> only the combo is discounted
    const result = evaluatePromotions({
      promotions: [comboPromo],
      lines: [line("cb1", 50000, 1, "combo"), line("hd1", 22000, 2, "hotdog")],
      categoryOf: (id) => (id.startsWith("cb") ? "combo" : "hotdog"),
      customer: { phone: null, completedOrders: 0, promoUseCount: 0 },
      subtotal: 94000,
    });

    expect(result.applied?.discount).toBe(5000);

    // no eligible item -> not available, with a clear reason
    const withoutCombo = evaluatePromotions({
      promotions: [comboPromo],
      lines: [line("hd1", 22000, 2, "hotdog")],
      categoryOf: (id) => (id.startsWith("cb") ? "combo" : "hotdog"),
      customer: { phone: null, completedOrders: 0, promoUseCount: 0 },
      subtotal: 44000,
    });
    expect(withoutCombo.applied).toBeNull();
    expect(withoutCombo.explanations[0].reason).toContain("mos mahsulot savatchada yo‘q");
  });

  it("marks unknown promo codes clearly", () => {
    const result = evaluatePromotions({
      promotions: [],
      lines: [line("hd1", 22000, 5)],
      categoryOf,
      customer: { phone: null, completedOrders: 0, promoUseCount: 0 },
      subtotal: 110000,
      requestedCode: "HACKER",
    });
    expect(result.applied).toBeNull();
    expect(result.explanations.at(-1)?.reason).toContain("kodi topilmadi");
  });
});
