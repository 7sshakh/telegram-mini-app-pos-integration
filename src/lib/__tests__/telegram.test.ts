import { beforeAll, describe, expect, it } from "vitest";

import type { validateInitData as ValidateInitData, hashInitData as HashInitData } from "@/lib/telegram";

const BOT_TOKEN = "987654321:AAHfiqksKZ8WmoMTs_dX5tOZMxGkcGfrtXc";

let validateInitData: typeof ValidateInitData;
let hashInitData: typeof HashInitData;

const user = {
  id: 700123456,
  first_name: "Aziz",
  last_name: "Karimov",
  username: "aziz_k",
  language_code: "uz",
};

function buildInitData(authDate: number, overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAF17ceAAAAA0XNxTWxVzX8");
  for (const [key, value] of Object.entries(overrides)) params.set(key, value);
  const hash = hashInitData(params.toString(), BOT_TOKEN);
  params.set("hash", hash);
  return params.toString();
}

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.ALLOW_UNVERIFIED_INITDATA = "false";
  const module = await import("@/lib/telegram");
  validateInitData = module.validateInitData;
  hashInitData = module.hashInitData;
});

describe("Telegram initData validation", () => {
  it("accepts a correctly signed payload", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = validateInitData(buildInitData(now), { botToken: BOT_TOKEN, now: Date.now() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified).toBe(true);
    expect(result.user.id).toBe(700123456);
    expect(result.user.username).toBe("aziz_k");
  });

  it("rejects a tampered user id (privilege escalation)", () => {
    const now = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams(buildInitData(now));
    const tamperedUser = { ...user, id: 1, username: "pos_admin" };
    params.set("user", JSON.stringify(tamperedUser));
    const result = validateInitData(params.toString(), { botToken: BOT_TOKEN, now: Date.now() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNAUTHORIZED");
    expect(result.message).toContain("imzasi");
  });

  it("rejects a payload signed with a different bot token", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = validateInitData(buildInitData(now), { botToken: "111111111:AAAnotherTokenValueXXXXXXXXXXXXXXXXXXX", now: Date.now() });
    expect(result.ok).toBe(false);
  });

  it("rejects expired sessions", () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 48 * 3600;
    const result = validateInitData(buildInitData(twoDaysAgo), {
      botToken: BOT_TOKEN,
      now: Date.now(),
      maxAgeSeconds: 86_400,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SESSION_EXPIRED");
  });

  it("rejects garbage input", () => {
    expect(validateInitData("", { botToken: BOT_TOKEN }).ok).toBe(false);
    expect(validateInitData("hash=deadbeef", { botToken: BOT_TOKEN }).ok).toBe(false);
    expect(validateInitData("user=notjson&auth_date=1&hash=ab", { botToken: BOT_TOKEN }).ok).toBe(false);
  });
});
