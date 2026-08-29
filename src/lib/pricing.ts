import { evaluatePromotions, type PromoCustomerContext } from "@/lib/promotions";
import type {
  CartLineInput,
  OrderType,
  PosCatalog,
  PosProduct,
  PromotionDef,
  Quote,
  QuoteLine,
} from "@/lib/types";

export type PricingErrorCode = "VALIDATION" | "PRODUCT_UNAVAILABLE" | "OUT_OF_STOCK" | "MIN_ORDER";

export type PricingError = {
  code: PricingErrorCode;
  message: string;
  productId?: string;
};

export type BuildQuoteInput = {
  catalog: PosCatalog;
  lines: CartLineInput[];
  orderType: OrderType;
  promotions: PromotionDef[];
  promoCode?: string | null;
  customer: PromoCustomerContext;
  now?: Date;
};

export type BuildQuoteResult = { ok: true; quote: Quote } | { ok: false; error: PricingError };

export const MAX_LINE_QTY = 50;
export const MAX_CART_LINES = 40;

function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1;
  return Math.min(MAX_LINE_QTY, Math.max(1, Math.round(qty)));
}

export function deliveryFeeFor(
  settings: PosCatalog["settings"],
  orderType: OrderType,
  subtotal: number,
): number {
  if (orderType !== "delivery" || !settings.deliveryEnabled) return 0;
  if (settings.freeDeliveryFrom > 0 && subtotal >= settings.freeDeliveryFrom) return 0;
  return Math.max(0, settings.deliveryFee);
}

export function etaFor(settings: PosCatalog["settings"], orderType: OrderType): number {
  if (orderType === "delivery") return settings.prepMinutes + settings.deliveryMinutes;
  return settings.prepMinutes;
}

/**
 * Server authoritative pricing. The client never sends prices — only product /
 * modifier ids and quantities. Everything else is recomputed here and again
 * inside the local POS before the order is accepted.
 */
export function buildQuote(input: BuildQuoteInput): BuildQuoteResult {
  const { catalog, orderType, promotions, customer } = input;
  const now = input.now ?? new Date();

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, error: { code: "VALIDATION", message: "Savatcha bo‘sh." } };
  }
  if (input.lines.length > MAX_CART_LINES) {
    return { ok: false, error: { code: "VALIDATION", message: "Savatchada juda ko‘p pozitsiya bor." } };
  }

  const byId = new Map<string, PosProduct>();
  for (const product of catalog.products) byId.set(product.id, product);

  const categoryOf = (productId: string) => byId.get(productId)?.categoryId;
  const lines: QuoteLine[] = [];
  let itemsTotal = 0;

  for (const raw of input.lines) {
    const product = byId.get(raw.productId);
    if (!product) {
      return {
        ok: false,
        error: {
          code: "PRODUCT_UNAVAILABLE",
          productId: raw.productId,
          message: "Tanlangan taom menyuda topilmadi. Menyuni yangilang.",
        },
      };
    }
    if (!product.isAvailable) {
      return {
        ok: false,
        error: {
          code: "PRODUCT_UNAVAILABLE",
          productId: product.id,
          message: `${product.name} hozir mavjud emas.`,
        },
      };
    }

    const qty = clampQty(raw.qty ?? 1);
    if (product.stock !== null && product.stock < qty) {
      return {
        ok: false,
        error: {
          code: "OUT_OF_STOCK",
          productId: product.id,
          message:
            product.stock <= 0
              ? `${product.name} tugagan. Boshqa taom tanlang.`
              : `${product.name} dan faqat ${product.stock} ta qoldi.`,
        },
      };
    }

    const modifiers: QuoteLine["modifiers"] = [];
    for (const rawModifier of raw.modifiers ?? []) {
      const modifier = product.modifiers.find((m) => m.id === rawModifier.id);
      if (!modifier) {
        return {
          ok: false,
          error: {
            code: "VALIDATION",
            productId: product.id,
            message: `${product.name} uchun mos moslama topilmadi.`,
          },
        };
      }
      const modifierQty = clampQty(rawModifier.qty ?? 1);
      const max = modifier.maxQty ?? MAX_LINE_QTY;
      if (modifierQty > max) {
        return {
          ok: false,
          error: {
            code: "VALIDATION",
            productId: product.id,
            message: `${modifier.name}: maksimal ${max} ta.`,
          },
        };
      }
      modifiers.push({ id: modifier.id, name: modifier.name, price: modifier.price, qty: modifierQty });
    }

    const unitPrice = product.price + modifiers.reduce((sum, m) => sum + m.price * m.qty, 0);
    const lineTotal = unitPrice * qty;
    itemsTotal += lineTotal;

    lines.push({
      productId: product.id,
      name: product.name,
      qty,
      unitPrice,
      modifiers,
      note: raw.note?.slice(0, 240),
      lineTotal,
    });
  }

  const evaluation = evaluatePromotions({
    promotions,
    lines,
    categoryOf,
    customer,
    requestedCode: input.promoCode,
    subtotal: itemsTotal,
    now,
  });

  const promoDiscount = Math.min(evaluation.applied?.discount ?? 0, itemsTotal);
  const subtotal = itemsTotal - promoDiscount;
  const deliveryFee = deliveryFeeFor(catalog.settings, orderType, subtotal);
  const total = subtotal + deliveryFee;

  if (orderType === "delivery" && catalog.settings.minOrderAmount > 0 && subtotal < catalog.settings.minOrderAmount) {
    return {
      ok: false,
      error: {
        code: "MIN_ORDER",
        message: `Yetkazib berish uchun minimal buyurtma ${catalog.settings.minOrderAmount.toLocaleString("ru-RU")} so‘m.`,
      },
    };
  }

  const quote: Quote = {
    lines,
    itemsTotal,
    subtotal,
    promoDiscount,
    promo: evaluation.applied
      ? { code: evaluation.applied.code, title: evaluation.applied.title, discount: evaluation.applied.discount, freeItems: evaluation.applied.freeItems }
      : null,
    deliveryFee,
    total,
    etaMinutes: etaFor(catalog.settings, orderType),
    explanations: evaluation.explanations,
  };

  return { ok: true, quote };
}

/** Cash change calculation, used by the client for preview and server for truth. */
export function cashChange(cashGiven: number, total: number): { ok: boolean; change: number; missing: number } {
  const given = Math.round(cashGiven ?? 0);
  if (given <= 0) return { ok: false, change: 0, missing: total };
  if (given < total) return { ok: false, change: 0, missing: total - given };
  return { ok: true, change: given - total, missing: 0 };
}

/** Mixed payment split validation. */
export function validateMixedPayment(cashPart: number, cardPart: number, total: number): { ok: boolean; message?: string } {
  const cash = Math.round(cashPart ?? 0);
  const card = Math.round(cardPart ?? 0);
  if (cash < 0 || card < 0) return { ok: false, message: "To‘lov summasi manfiy bo‘lmasligi kerak." };
  if (cash === 0 && card === 0) return { ok: false, message: "Naqd yoki karta qismidan birini kiriting." };
  if (cash + card !== total) {
    return {
      ok: false,
      message: `Naqd + karta yig‘indisi jami summagа teng bo‘lishi kerak: ${total.toLocaleString("ru-RU")} so‘m.`,
    };
  }
  return { ok: true };
}
