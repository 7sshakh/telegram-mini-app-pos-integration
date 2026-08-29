import type { PromotionDef, PromoExplanation, QuoteLine } from "@/lib/types";

export type PromoCustomerContext = {
  phone: string | null;
  completedOrders: number;
  promoUseCount: number;
};

export type PromoEvaluation = {
  /** Winning promotion (highest discount), or null when nothing applies. */
  applied: {
    code: string;
    title: string;
    discount: number;
    freeItems: { productId: string; name: string; qty: number }[];
  } | null;
  explanations: PromoExplanation[];
};

/** A single product unit eligible for a reward, used to price the free item. */
type EligibleUnit = { productId: string; name: string; basePrice: number };

function isInRange(promo: PromotionDef, now: Date): boolean {
  if (promo.activeFrom && now.getTime() < new Date(promo.activeFrom).getTime()) return false;
  if (promo.activeUntil && now.getTime() > new Date(promo.activeUntil).getTime()) return false;
  return true;
}

export function isPromotionActive(promo: PromotionDef, now: Date): boolean {
  return promo.enabled && isInRange(promo, now);
}

/** Cart value that a PERCENT/FIXED promotion is allowed to discount. */
function eligibleSubtotalFor(
  promo: PromotionDef,
  lines: QuoteLine[],
  categoryOf: (productId: string) => string | undefined,
): number {
  if (promo.eligibleCategoryIds.length === 0 && promo.eligibleProductIds.length === 0) {
    return lines.reduce((sum, line) => sum + line.lineTotal, 0);
  }
  return lines.reduce((sum, line) => {
    const categoryId = categoryOf(line.productId);
    const byCategory =
      promo.eligibleCategoryIds.length > 0 && !!categoryId && promo.eligibleCategoryIds.includes(categoryId);
    const byProduct = promo.eligibleProductIds.length > 0 && promo.eligibleProductIds.includes(line.productId);
    return byCategory || byProduct ? sum + line.lineTotal : sum;
  }, 0);
}

function collectEligibleUnits(
  promo: PromotionDef,
  lines: QuoteLine[],
  categoryOf: (productId: string) => string | undefined,
): EligibleUnit[] {
  const units: EligibleUnit[] = [];
  for (const line of lines) {
    if (line.isFreeReward) continue;
    const categoryId = categoryOf(line.productId);
    const byCategory = promo.eligibleCategoryIds.length > 0 && !!categoryId && promo.eligibleCategoryIds.includes(categoryId);
    const byProduct = promo.eligibleProductIds.length > 0 && promo.eligibleProductIds.includes(line.productId);
    if (promo.eligibleCategoryIds.length === 0 && promo.eligibleProductIds.length === 0) {
      // Promo applies to the whole menu.
    } else if (!byCategory && !byProduct) {
      continue;
    }
    for (let i = 0; i < line.qty; i += 1) {
      units.push({ productId: line.productId, name: line.name, basePrice: line.unitPrice - line.modifiers.reduce((s, m) => s + m.price * m.qty, 0) });
    }
  }
  return units;
}

/**
 * Pure promotion evaluator. Runs on the cloud for display/pricing and is mirrored
 * by the local POS before an order is accepted — the POS verdict always wins.
 *
 * Supported mechanics:
 *  - FOUR_PLUS_ONE / TWO_PLUS_ONE: cart must hold (minQty + 1) eligible units,
 *    then the cheapest eligible unit(s) become free. 4+1 => 5 units in cart,
 *    1 free. 2+1 => 3 units in cart, 1 free.
 *  - PERCENT / FIXED: classic cart level discount.
 */
export function evaluatePromotions(options: {
  promotions: PromotionDef[];
  lines: QuoteLine[];
  categoryOf: (productId: string) => string | undefined;
  customer: PromoCustomerContext;
  requestedCode?: string | null;
  subtotal: number;
  now?: Date;
}): PromoEvaluation {
  const { promotions, lines, categoryOf, customer, subtotal } = options;
  const now = options.now ?? new Date();
  const requested = (options.requestedCode ?? "").trim().toUpperCase();

  const explanations: PromoExplanation[] = [];
  let best: PromoEvaluation["applied"] = null;

  const sorted = [...promotions].sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));

  for (const promo of sorted) {
    if (!promo.enabled) {
      explanations.push({
        code: promo.code,
        title: promo.title,
        applied: false,
        available: false,
        reason: "Aksiya vaqtincha to‘xtatilgan.",
        discount: 0,
      });
      continue;
    }

    if (!isInRange(promo, now)) {
      explanations.push({
        code: promo.code,
        title: promo.title,
        applied: false,
        available: false,
        reason: promo.activeUntil
          ? "Aksiya muddati tugagan."
          : "Aksiya hali boshlanmagan.",
        discount: 0,
      });
      continue;
    }

    if (promo.requiresPhone && !customer.phone) {
      explanations.push({
        code: promo.code,
        title: promo.title,
        applied: false,
        available: false,
        reason: "Bu aksiya uchun telefon raqamingiz kerak. Profilda raqam qo‘shing.",
        discount: 0,
      });
      continue;
    }

    if (promo.requiresHistory && customer.completedOrders < 1) {
      explanations.push({
        code: promo.code,
        title: promo.title,
        applied: false,
        available: false,
        reason: "Aksiya doimiy mijozlar uchun: birinchi buyurtmangizdan keyin ochiladi.",
        discount: 0,
      });
      continue;
    }

    if (promo.maxUsesPerCustomer !== null && customer.promoUseCount >= promo.maxUsesPerCustomer) {
      explanations.push({
        code: promo.code,
        title: promo.title,
        applied: false,
        available: false,
        reason: `Bu aksiyadan siz ${promo.maxUsesPerCustomer} marta foydalangansiz.`,
        discount: 0,
      });
      continue;
    }

    if (promo.type === "FOUR_PLUS_ONE" || promo.type === "TWO_PLUS_ONE") {
      const units = collectEligibleUnits(promo, lines, categoryOf);
      const need = promo.minQty + 1;
      const rewards = Math.floor(units.length / need);
      const cheapest = [...units].sort((a, b) => a.basePrice - b.basePrice).slice(0, rewards);
      const discount = cheapest.reduce((sum, unit) => sum + unit.basePrice, 0);

      if (rewards > 0 && discount > 0) {
        const freeItems = Object.values(
          cheapest.reduce<Record<string, { productId: string; name: string; qty: number }>>((acc, unit) => {
            acc[unit.productId] = acc[unit.productId] ?? { productId: unit.productId, name: unit.name, qty: 0 };
            acc[unit.productId].qty += 1;
            return acc;
          }, {}),
        );
        const explanation: PromoExplanation = {
          code: promo.code,
          title: promo.title,
          applied: true,
          available: true,
          reason:
            rewards === 1
              ? `${promo.minQty}+1: ${freeItems.map((f) => f.name).join(", ")} bepul qo‘llandi.`
              : `${rewards} ta bepul mahsulot qo‘shildi.`,
          discount,
        };
        explanations.push(explanation);
        if (!best || discount > best.discount) {
          best = { code: promo.code, title: promo.title, discount, freeItems };
        }
        continue;
      }

      explanations.push({
        code: promo.code,
        title: promo.title,
        applied: false,
        available: true,
        reason: `Yana ${Math.max(need - units.length, 1)} ta mos mahsulot qo‘shing — bepul bo‘ladi.`,
        discount: 0,
        progress: { have: units.length, need },
      });
      continue;
    }

    if (promo.type === "PERCENT" || promo.type === "FIXED") {
      // percentage / fixed discounts only apply to eligible items, never the whole cart
      const eligibleBase = eligibleSubtotalFor(promo, lines, categoryOf);
      const percent = promo.discountPercent ?? 0;
      const fixed = promo.discountAmount ?? 0;
      let discount = promo.type === "PERCENT" ? Math.round((eligibleBase * percent) / 100) : fixed;
      discount = Math.max(0, Math.min(discount, eligibleBase));
      if (eligibleBase <= 0 || discount <= 0) {
        explanations.push({
          code: promo.code,
          title: promo.title,
          applied: false,
          available: false,
          reason: "Bu aksiyaga mos mahsulot savatchada yo‘q.",
          discount: 0,
        });
        continue;
      }
      explanations.push({
        code: promo.code,
        title: promo.title,
        applied: true,
        available: true,
        reason:
          promo.type === "PERCENT"
            ? `${percent}% chegirma qo‘llandi.`
            : `${discount.toLocaleString("ru-RU")} so‘m chegirma qo‘llandi.`,
        discount,
      });
      if (!best || discount > best.discount) {
        best = { code: promo.code, title: promo.title, discount, freeItems: [] };
      }
    }
  }

  // When the customer explicitly asks for a promo code, honour it if valid.
  if (requested) {
    const match = explanations.find((e) => e.code.toUpperCase() === requested);
    if (!match) {
      explanations.push({
        code: requested,
        title: requested,
        applied: false,
        available: false,
        reason: "Bunday aksiya kodi topilmadi yoki shartlari bajarilmadi.",
        discount: 0,
      });
    } else if (match.applied && best && best.code !== match.code && match.discount < best.discount) {
      // keep the better automatic promo but tell the user why
      match.reason = `Bu kod qo‘llanmadi: sizga foydaliroq "${best.title}" aksiyasi ishlayapti.`;
      match.applied = false;
    }
  }

  return { applied: best, explanations };
}
