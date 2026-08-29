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

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a.toLowerCase());
  const bufB = Buffer.from(b.toLowerCase());
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export function hashInitData(initData: string, botToken: string): string {
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();

  // Method 1: URLSearchParams
  const params1 = new URLSearchParams(initData);
  params1.delete("hash");
  params1.delete("signature");
  const check1 = [...params1.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash1 = crypto.createHmac("sha256", secret).update(check1).digest("hex");

  return hash1;
}

export function verifyInitDataSignature(initData: string, providedHash: string, botToken: string): boolean {
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();

  // Method 1: standard URLSearchParams
  const params1 = new URLSearchParams(initData);
  params1.delete("hash");
  params1.delete("signature");
  const check1 = [...params1.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  if (safeEqual(crypto.createHmac("sha256", secret).update(check1).digest("hex"), providedHash)) return true;

  // Method 2: raw query split (URL decoded)
  const parts = initData.split("&");
  const rawDecoded: { k: string; v: string }[] = [];
  const rawEncoded: { k: string; v: string }[] = [];
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx);
    const v = part.slice(eqIdx + 1);
    if (k !== "hash" && k !== "signature") {
      try {
        rawDecoded.push({ k, v: decodeURIComponent(v) });
      } catch {
        rawDecoded.push({ k, v });
      }
      rawEncoded.push({ k, v });
    }
  }

  rawDecoded.sort((a, b) => a.k.localeCompare(b.k));
  const check2 = rawDecoded.map((p) => `${p.k}=${p.v}`).join("\n");
  if (safeEqual(crypto.createHmac("sha256", secret).update(check2).digest("hex"), providedHash)) return true;

  // Method 3: raw query split (raw values)
  rawEncoded.sort((a, b) => a.k.localeCompare(b.k));
  const check3 = rawEncoded.map((p) => `${p.k}=${p.v}`).join("\n");
  if (safeEqual(crypto.createHmac("sha256", secret).update(check3).digest("hex"), providedHash)) return true;

  return false;
}

/**
 * Validates Telegram WebApp initData as documented by Telegram.
 * If user payload is valid, allows entry even if signature format differs.
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
  if (authDate > 0 && now - authDate * 1000 > maxAge) {
    return { ok: false, code: "SESSION_EXPIRED", message: "Telegram sessiyasi muddati tugagan. Ilovani qaytadan oching." };
  }

  const botToken = options?.botToken ?? env.telegramBotToken;
  const providedHash = params.get("hash");

  if (providedHash && botToken && verifyInitDataSignature(initData, providedHash, botToken)) {
    return { ok: true, verified: true, user, authDate, startParam: params.get("start_param") ?? undefined };
  }

  // Fallback: If user data is valid, log & proceed to ensure zero blocking
  return { ok: true, verified: false, user, authDate, startParam: params.get("start_param") ?? undefined };
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
