import crypto from "node:crypto";

import { env } from "@/lib/env";

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
};

export type InitDataResult =
  | { ok: true; verified: boolean; user: TelegramUser; authDate: number; startParam?: string }
  | { ok: false; code: "UNAUTHORIZED" | "SESSION_EXPIRED"; message: string };

export function hashInitData(initData: string, botToken: string): string {
  const params = new URLSearchParams(initData);
  params.delete("hash");
  params.delete("signature");

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  return crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

/**
 * Validates Telegram WebApp initData exactly as documented by Telegram:
 * secret_key = HMAC_SHA256(bot_token, "WebAppData"), then
 * expected_hash = HMAC_SHA256(data_check_string, secret_key).
 * Any tampering with user id / name / payload invalidates the hash.
 */
export function validateInitData(
  initData: string | null | undefined,
  options?: { now?: number; botToken?: string; maxAgeSeconds?: number },
): InitDataResult {
  if (!initData || typeof initData !== "string" || initData.length < 8) {
    return { ok: false, code: "UNAUTHORIZED", message: "Telegram ma’lumotlari topilmadi." };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, code: "UNAUTHORIZED", message: "Telegram ma’lumotlari buzilgan." };
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    return { ok: false, code: "UNAUTHORIZED", message: "Telegram foydalanuvchisi aniqlanmadi." };
  }

  let user: TelegramUser;
  try {
    const parsed = JSON.parse(userRaw) as TelegramUser;
    if (!parsed || typeof parsed.id !== "number" || parsed.id <= 0) {
      return { ok: false, code: "UNAUTHORIZED", message: "Telegram foydalanuvchisi noto‘g‘ri." };
    }
    user = parsed;
  } catch {
    return { ok: false, code: "UNAUTHORIZED", message: "Telegram foydalanuvchisi o‘qilmadi." };
  }

  const now = options?.now ?? Date.now();
  const maxAge = (options?.maxAgeSeconds ?? env.telegramAuthTtl) * 1000;
  const authDate = Number.parseInt(params.get("auth_date") ?? "0", 10);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, code: "SESSION_EXPIRED", message: "Telegram sessiyasi eskirgan." };
  }
  if (now - authDate * 1000 > maxAge) {
    return { ok: false, code: "SESSION_EXPIRED", message: "Telegram sessiyasi muddati tugagan. Ilovani qaytadan oching." };
  }

  const botToken = options?.botToken ?? env.telegramBotToken;
  const providedHash = params.get("hash");

  if (!env.telegramConfigured) {
    if (env.allowUnverifiedInitData) {
      // Development only: never enabled in production.
      return { ok: true, verified: false, user, authDate, startParam: params.get("start_param") ?? undefined };
    }
    return { ok: false, code: "UNAUTHORIZED", message: "TELEGRAM_BOT_TOKEN sozlanmagan." };
  }

  if (!providedHash) {
    return { ok: false, code: "UNAUTHORIZED", message: "Telegram imzosi topilmadi." };
  }

  const expected = hashInitData(initData, botToken);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(providedHash.toLowerCase(), "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "UNAUTHORIZED", message: "Telegram imzasi noto‘g‘ri." };
  }

  return { ok: true, verified: true, user, authDate, startParam: params.get("start_param") ?? undefined };
}

const telegramApi = (method: string) => `https://api.telegram.org/bot${env.telegramBotToken}/${method}`;

/** Fire and forget bot notification. Never throws into the request path. */
export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: { replyMarkup?: unknown; disablePreview?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  if (!env.telegramConfigured || !env.telegramNotify || !chatId) {
    return { ok: false, error: "bot-not-configured" };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(telegramApi("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: options?.disablePreview ?? true,
        reply_markup: options?.replyMarkup,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return { ok: false, error: `telegram-${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "network" };
  }
}

export function maskToken(token: string): string {
  if (!token) return "(empty)";
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
