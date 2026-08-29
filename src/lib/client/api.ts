"use client";

export type ApiErrorShape = { code: string; message: string; details?: unknown };

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(status: number, shape: ApiErrorShape) {
    super(shape.message);
    this.status = status;
    this.code = shape.code;
    this.details = shape.details;
  }
}

const TOKEN_KEY = "vibe.session.v1";
const CART_KEY = "vibe.cart.v1";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode / storage disabled
  }
}

export function readPersistedCart<T>(): T | null {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function persistCart(value: unknown): void {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function newIdempotencyKey(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ord-${Date.now().toString(36)}-${random}`.slice(0, 100);
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  retries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Small fetch wrapper with:
 *  - bearer session auth
 *  - network-error retries with backoff (safe: order POSTs are idempotent)
 *  - Uzbek error surfaces so the UI never shows raw HTTP text
 */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, token = getToken(), retries = 2, timeoutMs = 15_000 } = options;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort);

    try {
      const response = await fetch(path, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });

      const text = await response.text();
      const data = text ? (JSON.parse(text) as unknown) : null;

      if (!response.ok) {
        const shape = (data as { error?: ApiErrorShape } | null)?.error;
        const error = new ApiError(response.status, shape ?? { code: "INTERNAL", message: "Server bilan aloqa xatosi." });
        // 4xx (except 429) are deterministic -> do not retry
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
        if (attempt === retries) throw error;
      } else {
        return (data ?? {}) as T;
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error;
      if (attempt === retries) {
        throw new ApiError(0, {
          code: "NETWORK",
          message: "Internet aloqasi yo‘q. Internetni tekshirib, qayta urinib ko‘ring.",
        });
      }
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }

    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1) * (attempt + 1)));
  }

  throw lastError instanceof Error
    ? new ApiError(0, { code: "NETWORK", message: lastError.message })
    : new ApiError(0, { code: "NETWORK", message: "Noma’lum xatolik." });
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}
