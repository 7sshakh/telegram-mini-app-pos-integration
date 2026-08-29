import crypto from "node:crypto";

import { env } from "@/lib/env";

/**
 * Provider agnostic online payment layer.
 *
 * The Mini App never sees provider credentials: it only receives an opaque
 * intent id / checkout URL. An order paid online is marked "pending" until the
 * provider's webhook confirms it — the client cannot flip it to paid.
 */

export type IntentStatus = "created" | "pending" | "succeeded" | "failed" | "canceled";

export type CreateIntentInput = {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
};

export type CreateIntentResult = {
  intentId: string;
  provider: string;
  status: IntentStatus;
  checkoutUrl: string | null;
  instructionsUz: string | null;
};

export type WebhookResult =
  | { ok: true; externalId?: string; amount?: number; status: "succeeded" | "failed" }
  | { ok: false; error: string };

export interface PaymentProvider {
  key: string;
  labelUz: string;
  supportsOnline(): boolean;
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  /** Verify the signature of a raw webhook body and extract the verdict. */
  verifyWebhook(rawBody: string, headers: Headers): WebhookResult;
}

class ManualProvider implements PaymentProvider {
  key = "manual";
  labelUz = "Operator tasdiqlaydigan to‘lov";

  supportsOnline(): boolean {
    return false;
  }

  async createIntent(): Promise<CreateIntentResult> {
    throw new Error("ONLINE_PAYMENT_NOT_CONFIGURED");
  }

  verifyWebhook(): WebhookResult {
    return { ok: false, error: "manual-provider-has-no-webhook" };
  }
}

function hmacHex(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

abstract class HmacWebhookProvider implements PaymentProvider {
  abstract key: string;
  abstract labelUz: string;
  abstract supportsOnline(): boolean;
  abstract createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  protected abstract secret(): string | undefined;
  protected abstract headerName(): string;

  verifyWebhook(rawBody: string, headers: Headers): WebhookResult {
    const secret = this.secret();
    if (!secret) return { ok: false, error: `${this.key}-not-configured` };
    const provided = headers.get(this.headerName()) ?? "";
    const expected = hmacHex(secret, rawBody);
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: "invalid-signature" };
    }
    let parsed: { external_id?: string; amount?: number; status?: string } = {};
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      return { ok: false, error: "invalid-json" };
    }
    if (parsed.status !== "succeeded" && parsed.status !== "failed") {
      return { ok: false, error: "unknown-status" };
    }
    return {
      ok: true,
      externalId: parsed.external_id,
      amount: typeof parsed.amount === "number" ? parsed.amount : undefined,
      status: parsed.status,
    };
  }
}

class PaymeProvider extends HmacWebhookProvider {
  key = "payme";
  labelUz = "Payme";
  protected headerName() {
    return "x-payme-signature";
  }
  protected secret() {
    return process.env.PAYME_KEY || process.env.PAYME_WEBHOOK_SECRET || undefined;
  }
  supportsOnline() {
    return !!this.secret() && !!process.env.PAYME_MERCHANT_ID;
  }
  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (!this.supportsOnline()) throw new Error("ONLINE_PAYMENT_NOT_CONFIGURED");
    return {
      intentId: crypto.randomUUID(),
      provider: this.key,
      status: "pending",
      checkoutUrl: `${env.appBaseUrl}/api/payments/${this.key}/checkout?order=${input.orderNumber}&amount=${input.amount}`,
      instructionsUz: null,
    };
  }
}

class ClickProvider extends HmacWebhookProvider {
  key = "click";
  labelUz = "Click";
  protected headerName() {
    return "x-click-signature";
  }
  protected secret() {
    return process.env.CLICK_SECRET_KEY || undefined;
  }
  supportsOnline() {
    return !!this.secret() && !!process.env.CLICK_SERVICE_ID;
  }
  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (!this.supportsOnline()) throw new Error("ONLINE_PAYMENT_NOT_CONFIGURED");
    return {
      intentId: crypto.randomUUID(),
      provider: this.key,
      status: "pending",
      checkoutUrl: `${env.appBaseUrl}/api/payments/${this.key}/checkout?order=${input.orderNumber}&amount=${input.amount}`,
      instructionsUz: null,
    };
  }
}

class StripeProvider extends HmacWebhookProvider {
  key = "stripe";
  labelUz = "Karta (Stripe)";
  protected headerName() {
    return "x-stripe-signature";
  }
  protected secret() {
    return process.env.STRIPE_WEBHOOK_SECRET || undefined;
  }
  supportsOnline() {
    return !!process.env.STRIPE_SECRET_KEY && !!this.secret();
  }
  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (!this.supportsOnline()) throw new Error("ONLINE_PAYMENT_NOT_CONFIGURED");
    return {
      intentId: crypto.randomUUID(),
      provider: this.key,
      status: "pending",
      checkoutUrl: `${env.appBaseUrl}/api/payments/${this.key}/checkout?order=${input.orderNumber}&amount=${input.amount}`,
      instructionsUz: null,
    };
  }
}

const registry: Record<string, PaymentProvider> = {
  manual: new ManualProvider(),
  payme: new PaymeProvider(),
  click: new ClickProvider(),
  stripe: new StripeProvider(),
};

export function getPaymentProvider(key?: string): PaymentProvider {
  const resolved = (key ?? env.paymentProvider).toLowerCase();
  return registry[resolved] ?? registry.manual;
}

export function listPaymentProviders(): PaymentProvider[] {
  return Object.values(registry);
}

export function onlinePaymentAvailable(): boolean {
  return getPaymentProvider().supportsOnline();
}
