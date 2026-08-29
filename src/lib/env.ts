/** Central env access + safe flags. Never import this from client components. */

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  appBaseUrl: (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  databaseUrl: process.env.DATABASE_URL ?? "",

  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-not-for-production",
  adminApiToken: process.env.ADMIN_API_TOKEN ?? "",

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME ?? "",
  telegramAuthTtl: int(process.env.TELEGRAM_AUTH_TTL, 86_400),
  telegramNotify: bool(process.env.TELEGRAM_NOTIFY, true),

  posMode: (process.env.POS_MODE === "pos" ? "pos" : "mock") as "pos" | "mock",
  allowMockFallback: bool(process.env.ALLOW_MOCK_FALLBACK, nodeEnv !== "production"),
  catalogTtlSeconds: int(process.env.CATALOG_TTL_SECONDS, 90),
  bridgePollSeconds: Math.min(Math.max(int(process.env.BRIDGE_POLL_SECONDS, 25), 5), 55),
  bridgeJobLeaseSeconds: int(process.env.BRIDGE_JOB_LEASE_SECONDS, 60),
  bridgeMaxAttempts: int(process.env.BRIDGE_MAX_ATTEMPTS, 30),

  paymentProvider: process.env.PAYMENT_PROVIDER ?? "manual",

  get devMode(): boolean {
    return bool(process.env.DEV_MODE, !this.isProduction);
  },
  get allowUnverifiedInitData(): boolean {
    return bool(process.env.ALLOW_UNVERIFIED_INITDATA, !this.isProduction);
  },
  get telegramConfigured(): boolean {
    return /^\d+:[A-Za-z0-9_-]{30,}$/.test(this.telegramBotToken);
  },
  get adminConfigured(): boolean {
    return this.adminApiToken.length >= 12;
  },
  get sessionSecretConfigured(): boolean {
    return process.env.SESSION_SECRET !== undefined && process.env.SESSION_SECRET.length >= 16;
  },
};
