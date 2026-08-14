import type { EnvLike } from "@/lib/env-types";

/**
 * Stripe over plain `fetch` — PLAN-MONETIZATION §6.
 *
 * No `stripe` package, for the reason `ResendTransport` gives about Resend: one
 * fewer dependency to audit, and nothing in the SDK this product needs. Four
 * endpoints, form-encoded bodies, one signature to verify.
 *
 * §1 decision 1 chose Stripe over the Merchant of Record §18.1 specified. The
 * consequence lives outside this file and is worth stating where somebody will
 * read it: **we now owe EU VAT ourselves.** Below the €10,000/yr cross-border
 * threshold that is home-country VAT and simple; above it, OSS registration and
 * quarterly returns. Stripe Tax computes; it does not file.
 */

export const STRIPE_API = "https://api.stripe.com/v1";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
}

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Stripe rejected the request (${status}): ${detail || "no body"}`);
    this.name = "StripeError";
  }
}

/**
 * Stripe wants `application/x-www-form-urlencoded`, including for nested
 * structures, which it spells `a[b][c]=d`.
 *
 * Written out rather than reached for from a library because the shapes this
 * product sends are shallow and known: a checkout session, a portal session.
 * Arrays use the index form Stripe documents (`line_items[0][price]`), and
 * `undefined` is dropped so an optional field is absent rather than the string
 * "undefined" — which Stripe would accept and store.
 */
export function encodeForm(
  value: Record<string, unknown>,
  prefix = "",
): string {
  const parts: string[] = [];

  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(raw)) {
      raw.forEach((item, i) => {
        const indexed = `${name}[${i}]`;
        parts.push(
          typeof item === "object" && item !== null
            ? encodeForm(item as Record<string, unknown>, indexed)
            : `${encodeURIComponent(indexed)}=${encodeURIComponent(String(item))}`,
        );
      });
      continue;
    }

    if (typeof raw === "object") {
      parts.push(encodeForm(raw as Record<string, unknown>, name));
      continue;
    }

    parts.push(
      `${encodeURIComponent(name)}=${encodeURIComponent(String(raw))}`,
    );
  }

  return parts.filter((part) => part.length > 0).join("&");
}

export class StripeClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: StripeConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  get webhookSecret(): string {
    return this.config.webhookSecret;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /**
   * Every write carries an `Idempotency-Key`.
   *
   * A checkout session created twice because a server action was retried is two
   * subscriptions and one refund conversation. Stripe deduplicates on this
   * header for 24 hours, which is longer than any retry this product performs.
   */
  async post<T>(
    path: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    return this.request<T>("POST", path, body, idempotencyKey);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await this.fetchImpl(`${STRIPE_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey === undefined
          ? {}
          : { "idempotency-key": idempotencyKey }),
      },
      ...(body === undefined ? {} : { body: encodeForm(body) }),
    });

    if (!response.ok) {
      // Stripe puts the actionable part — which parameter, which id, which
      // mode — in the body. A status code alone sends whoever reads the log to
      // the dashboard to find out what we already had.
      const detail = await response.text().catch(() => "");
      throw new StripeError(response.status, detail);
    }

    return (await response.json()) as T;
  }
}

/**
 * An in-process Stripe that charges nobody.
 *
 * The same device as `MemoryTransport`, and it exists for the same two reasons:
 * the suite must run with no keys and no network while still covering this code,
 * and local development must reach a checkout screen without a Stripe account.
 *
 * It records what it was asked to do so a test can assert on the request rather
 * than on a mock of `fetch`.
 */
export interface RecordedCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}

export class MemoryStripe extends StripeClient {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly responses: Record<string, unknown> = {}) {
    super({ secretKey: "sk_test_memory", webhookSecret: "whsec_memory" });
  }

  override async get<T>(path: string): Promise<T> {
    this.calls.push({ method: "GET", path });
    return this.reply<T>(path);
  }

  override async post<T>(
    path: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    this.calls.push({ method: "POST", path, body, idempotencyKey });
    return this.reply<T>(path);
  }

  private reply<T>(path: string): T {
    const canned = this.responses[path];
    if (canned === undefined) {
      throw new StripeError(404, `MemoryStripe has no response for ${path}`);
    }
    return canned as T;
  }
}

/**
 * The configured client, or the in-memory one.
 *
 * Mirrors `resolveTransport` exactly, including the loud middle case: a secret
 * key with no webhook secret is worse than no key at all, because checkouts
 * would succeed and nothing would ever be told they had. Failing at resolve
 * time turns that into a startup error rather than a silent revenue leak.
 */
export function resolveStripe(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): StripeClient {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) return new MemoryStripe();

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error(
      "STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not. Without it every webhook is rejected, so subscriptions would be created and never recorded. Copy it from `stripe listen` or the Stripe dashboard.",
    );
  }

  return new StripeClient({ secretKey, webhookSecret, fetchImpl });
}

let client: StripeClient | undefined;

export function getStripe(): StripeClient {
  client ??= resolveStripe();
  return client;
}

/** The test seam, matching `setTransport`. */
export function setStripe(next: StripeClient | undefined): void {
  client = next;
}
