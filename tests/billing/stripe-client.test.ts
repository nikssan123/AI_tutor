import { describe, expect, it, vi } from "vitest";
import {
  encodeForm,
  MemoryStripe,
  resolveStripe,
  StripeClient,
  StripeError,
  getStripe,
  setStripe,
} from "@/lib/billing/stripe/client";

/**
 * The Stripe client.
 *
 * Form encoding gets the most attention here because it is the part that fails
 * silently: Stripe accepts a body it does not understand, ignores the field and
 * creates something subtly different from what was asked for. A wrong nesting
 * is not an error, it is a wrong subscription.
 */

const ok = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe("encodeForm", () => {
  it("encodes a flat object", () => {
    expect(encodeForm({ mode: "subscription", quantity: 1 })).toBe(
      "mode=subscription&quantity=1",
    );
  });

  it("nests with Stripe's bracket syntax", () => {
    expect(encodeForm({ automatic_tax: { enabled: true } })).toBe(
      "automatic_tax%5Benabled%5D=true",
    );
  });

  it("indexes arrays of objects", () => {
    expect(encodeForm({ line_items: [{ price: "price_1", quantity: 2 }] })).toBe(
      "line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=2",
    );
  });

  it("indexes arrays of scalars", () => {
    expect(encodeForm({ expand: ["a", "b"] })).toBe(
      "expand%5B0%5D=a&expand%5B1%5D=b",
    );
  });

  it("drops undefined and null rather than sending them as strings", () => {
    // Stripe would accept "undefined" and store it.
    expect(encodeForm({ a: 1, b: undefined, c: null })).toBe("a=1");
  });

  it("escapes values that would otherwise break the body", () => {
    expect(encodeForm({ return_url: "https://x.test/a?b=c&d=e" })).toBe(
      "return_url=https%3A%2F%2Fx.test%2Fa%3Fb%3Dc%26d%3De",
    );
  });

  it("omits an empty nested object rather than emitting a stray separator", () => {
    expect(encodeForm({ a: 1, meta: {} })).toBe("a=1");
  });
});

describe("StripeClient", () => {
  it("sends the key, the form content type and the body", async () => {
    const fetchImpl = ok({ id: "cs_1" });
    const client = new StripeClient({
      secretKey: "sk_test_x",
      webhookSecret: "whsec_x",
      fetchImpl,
    });

    await client.post("/checkout/sessions", { mode: "subscription" }, "key-1");

    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("mode=subscription");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk_test_x");
    expect(headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("omits the idempotency header when none was given", async () => {
    const fetchImpl = ok({});
    const client = new StripeClient({
      secretKey: "sk",
      webhookSecret: "wh",
      fetchImpl,
    });

    await client.post("/x", {});
    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("idempotency-key");
  });

  it("sends no body on a GET", async () => {
    const fetchImpl = ok({ id: "price_1" });
    const client = new StripeClient({
      secretKey: "sk",
      webhookSecret: "wh",
      fetchImpl,
    });

    await client.get("/prices/price_1");
    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });

  it("puts Stripe's own explanation in the error", async () => {
    // A status code alone sends whoever reads the log to the dashboard to find
    // out what we already had.
    const fetchImpl = vi.fn(
      async () => new Response("No such price: price_x", { status: 404 }),
    );
    const client = new StripeClient({
      secretKey: "sk",
      webhookSecret: "wh",
      fetchImpl,
    });

    await expect(client.get("/prices/price_x")).rejects.toThrow(
      /404.*No such price/,
    );
  });

  it("survives an error response with no readable body", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("stream closed");
      },
    })) as unknown as typeof fetch;

    const client = new StripeClient({
      secretKey: "sk",
      webhookSecret: "wh",
      fetchImpl,
    });
    await expect(client.get("/x")).rejects.toThrow(/500.*no body/);
  });

  it("exposes the webhook secret it was configured with", () => {
    expect(
      new StripeClient({ secretKey: "sk", webhookSecret: "whsec_z" })
        .webhookSecret,
    ).toBe("whsec_z");
  });
});

describe("MemoryStripe", () => {
  it("answers from its canned responses and records the call", async () => {
    const stripe = new MemoryStripe({ "/prices/p1": { id: "p1" } });

    expect(await stripe.get("/prices/p1")).toEqual({ id: "p1" });
    expect(stripe.calls).toEqual([{ method: "GET", path: "/prices/p1" }]);
  });

  it("records a post with its body and key", async () => {
    const stripe = new MemoryStripe({ "/x": { ok: true } });
    await stripe.post("/x", { a: 1 }, "k");

    expect(stripe.calls[0]).toEqual({
      method: "POST",
      path: "/x",
      body: { a: 1 },
      idempotencyKey: "k",
    });
  });

  it("throws for a path it was not given, rather than returning undefined", async () => {
    // A silent undefined would surface much later as an unreadable failure in
    // whatever consumed the response.
    await expect(new MemoryStripe().get("/nope")).rejects.toThrow(StripeError);
  });
});

describe("resolveStripe", () => {
  it("falls back to the in-memory client with no key", () => {
    // What lets the suite run, and a developer reach a checkout screen, with no
    // Stripe account at all.
    expect(resolveStripe({})).toBeInstanceOf(MemoryStripe);
  });

  it("refuses a secret key with no webhook secret", () => {
    // Worse than no key: checkouts would succeed and nothing would ever be told
    // they had.
    expect(() => resolveStripe({ STRIPE_SECRET_KEY: "sk_live_x" })).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
  });

  it("builds a real client when both are present", () => {
    const client = resolveStripe({
      STRIPE_SECRET_KEY: "sk_live_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    });
    expect(client).toBeInstanceOf(StripeClient);
    expect(client).not.toBeInstanceOf(MemoryStripe);
    expect(client.webhookSecret).toBe("whsec_x");
  });
});

describe("getStripe", () => {
  it("caches, and can be replaced for a test", () => {
    setStripe(undefined);
    const first = getStripe();
    expect(getStripe()).toBe(first);

    const fake = new MemoryStripe();
    setStripe(fake);
    expect(getStripe()).toBe(fake);
    setStripe(undefined);
  });
});
