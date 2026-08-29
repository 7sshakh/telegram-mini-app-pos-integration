/**
 * Shared domain types for the VIBE Telegram Mini App cloud layer.
 *
 * Money: all amounts are integer UZS (whole so'm). No floats anywhere in the
 * pricing path, so totals can never drift because of rounding.
 */

export type Currency = "UZS";

export type OrderType = "delivery" | "pickup" | "dine_in";

export type OrderStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "on_the_way"
  | "delivered"
  | "completed"
  | "cancelled";

export type PosSyncStatus = "pending" | "synced" | "failed" | "not_required";

export type PaymentMethod = "cash" | "card_transfer" | "terminal" | "mixed" | "online";

export type PaymentMethodInfo = {
  id: PaymentMethod;
  label: string;
  hint?: string;
  enabled: boolean;
  requiresOnline: boolean;
};

export type StoreSettings = {
  brandName: string;
  currency: Currency;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  dineInEnabled: boolean;
  deliveryFee: number;
  freeDeliveryFrom: number;
  minOrderAmount: number;
  prepMinutes: number;
  deliveryMinutes: number;
  paymentMethods: PaymentMethodInfo[];
  workHours: { open: string; close: string } | null;
  address: string;
  phone: string;
  location: { lat: number; lng: number };
};

export type PosCategory = {
  id: string;
  name: string;
  emoji?: string;
  sortOrder: number;
};

export type PosModifier = {
  id: string;
  name: string;
  price: number;
  groupName?: string;
  maxQty?: number;
};

export type PosProduct = {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  oldPrice?: number;
  imageUrl?: string;
  isAvailable: boolean;
  /** null = POS does not track stock for this product (always sellable) */
  stock: number | null;
  modifiers: PosModifier[];
  tags?: string[];
};

export type PosCatalog = {
  version: string;
  source: "pos" | "mock";
  currency: Currency;
  generatedAt: string;
  categories: PosCategory[];
  products: PosProduct[];
  settings: StoreSettings;
};

export type PromotionType = "FOUR_PLUS_ONE" | "TWO_PLUS_ONE" | "PERCENT" | "FIXED";

export type PromotionDef = {
  code: string;
  title: string;
  description?: string;
  type: PromotionType;
  /** Empty array = all categories / all products are eligible. */
  eligibleCategoryIds: string[];
  eligibleProductIds: string[];
  /** Number of eligible units required to unlock the reward (4 for 4+1). */
  minQty: number;
  discountPercent?: number;
  discountAmount?: number;
  requiresPhone: boolean;
  /** Customer must have at least one previously completed POS order. */
  requiresHistory: boolean;
  maxUsesPerCustomer: number | null;
  activeFrom: string | null;
  activeUntil: string | null;
  enabled: boolean;
  priority: number;
};

export type CartModifierInput = {
  id: string;
  qty: number;
};

export type CartLineInput = {
  productId: string;
  qty: number;
  modifiers: CartModifierInput[];
  note?: string;
};

export type QuoteModifier = {
  id: string;
  name: string;
  price: number;
  qty: number;
};

export type QuoteLine = {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  modifiers: QuoteModifier[];
  note?: string;
  lineTotal: number;
  isFreeReward?: boolean;
};

export type PromoExplanation = {
  code: string;
  title: string;
  applied: boolean;
  available: boolean;
  reason: string;
  discount: number;
  progress?: { have: number; need: number };
};

export type QuotePromo = {
  code: string;
  title: string;
  discount: number;
  freeItems: { productId: string; name: string; qty: number }[];
} | null;

export type Quote = {
  lines: QuoteLine[];
  itemsTotal: number;
  subtotal: number;
  promoDiscount: number;
  promo: QuotePromo;
  deliveryFee: number;
  total: number;
  etaMinutes: number;
  explanations: PromoExplanation[];
};

export type OrderAddress = {
  label: string;
  addressLine: string;
  apartment?: string;
  entrance?: string;
  floor?: string;
  landmark?: string;
  note?: string;
  lat: number | null;
  lng: number | null;
};

export type OrderPayment = {
  method: PaymentMethod;
  label: string;
  cashGiven?: number;
  change?: number;
  cashPart?: number;
  cardPart?: number;
  provider?: string;
  intentId?: string;
  onlineStatus?: "none" | "pending" | "paid" | "failed";
};

export type OrderTotals = {
  itemsTotal: number;
  subtotal: number;
  promoDiscount: number;
  deliveryFee: number;
  total: number;
  currency: Currency;
};

export type OrderDTO = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  posSyncStatus: PosSyncStatus;
  posOrderId: string | null;
  orderType: OrderType;
  asap: boolean;
  scheduledFor: string | null;
  items: QuoteLine[];
  totals: OrderTotals;
  payment: OrderPayment;
  promo: QuotePromo;
  address: OrderAddress | null;
  customerNote: string | null;
  etaMinutes: number;
  createdAt: string;
  updatedAt: string;
  timeline: { status: string; label: string; note?: string; at: string }[];
};

export type CustomerDTO = {
  id: string;
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  photoUrl: string | null;
  completedOrders: number;
  loyaltyEligible: boolean;
  isNew: boolean;
};

export type AddressDTO = {
  id: string;
  label: string;
  addressLine: string;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  landmark: string | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  createdAt: string;
};

export type JobType =
  | "CREATE_ORDER"
  | "REFRESH_CATALOG"
  | "CANCEL_ORDER"
  | "PING";
