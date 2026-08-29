/** All customer facing copy lives here. Language: Uzbek (Latin). */

export const STATUS_LABELS: Record<string, string> = {
  new: "Qabul qilinmoqda",
  accepted: "Qabul qilindi",
  preparing: "Tayyorlanmoqda",
  ready: "Tayyor",
  on_the_way: "Yo‘lda",
  delivered: "Yetkazib berildi",
  completed: "Yakunlandi",
  cancelled: "Bekor qilindi",
};

/** Ordered timeline shown to the customer. */
export const STATUS_FLOW: string[] = [
  "new",
  "accepted",
  "preparing",
  "ready",
  "on_the_way",
  "delivered",
  "completed",
];

export const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: "Yetkazib berish",
  pickup: "Olib ketish (Soboy)",
  dine_in: "Zalda (Dine-in)",
};

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Naqd pul",
  card_transfer: "Karta o‘tkazma",
  terminal: "Bank terminal",
  mixed: "Aralash to‘lov",
  online: "Online to‘lov",
};

export const ADDRESS_LABELS: Record<string, string> = {
  home: "Uy",
  work: "Ish",
  other: "Boshqa",
};

export const POS_SYNC_LABELS: Record<string, string> = {
  pending: "POS ga yuborilmoqda",
  synced: "POS da saqlandi",
  failed: "POS ga yuborilmadi",
  not_required: "—",
};

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "PRODUCT_UNAVAILABLE"
  | "OUT_OF_STOCK"
  | "MIN_ORDER"
  | "PROMO_NOT_AVAILABLE"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "IDEMPOTENCY"
  | "POS_OFFLINE"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL";

const MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: "Telegram akkauntingizni tekshirib bo‘lmadi. Iltimos, ilovani qaytadan oching.",
  SESSION_EXPIRED: "Sessiya muddati tugadi. Iltimos, ilovani yopib qaytadan oching.",
  FORBIDDEN: "Bu amal uchun ruxsat yo‘q.",
  VALIDATION: "Ma’lumotlar to‘liq emas. Iltimos, tekshirib qayta kiriting.",
  PRODUCT_UNAVAILABLE: "Tanlangan taom hozir mavjud emas.",
  OUT_OF_STOCK: "Tanlangan taom tugagan. Iltimos, savatchani yangilang.",
  MIN_ORDER: "Buyurtma summasi minimal summadan kichik.",
  PROMO_NOT_AVAILABLE: "Bu aksiya hozir mavjud emas.",
  PAYMENT_REQUIRED: "To‘lovni tasdiqlash talab qilinadi.",
  PAYMENT_FAILED: "To‘lov amalga oshmadi. Qayta urinib ko‘ring.",
  IDEMPOTENCY: "Buyurtma allaqachon yuborilgan.",
  POS_OFFLINE: "POS kompyuteri hozir offline. Buyurtma navbatga qo‘shildi va aloqa tikolgach yuboriladi.",
  NOT_FOUND: "Ma’lumot topilmadi.",
  RATE_LIMITED: "Juda ko‘p so‘rov yuborildi. Bir necha soniyadan keyin qayta urinib ko‘ring.",
  INTERNAL: "Serverda xatolik yuz berdi. Qayta urinib ko‘ring.",
};

export function errorMessage(code: ApiErrorCode, override?: string): string {
  return override ?? MESSAGES[code];
}

export function apiError(code: ApiErrorCode, options?: { message?: string; details?: unknown }) {
  return {
    error: { code, message: errorMessage(code, options?.message), details: options?.details ?? null },
  };
}

export function etaText(minutes: number): string {
  if (minutes <= 0) return "tez orada";
  return `~${minutes} daqiqa`;
}
