import { describe, expect, it } from "vitest";
import { MemoryStripe } from "@/lib/billing/stripe/client";
import {
  assertPriceMatches,
  checkoutBody,
  createCheckoutSession,
  createPortalSession,
  PriceMismatchError,
  priceIdFor,
  TRIAL_DAYS,
} from "@/lib/billing/stripe/checkout";
import { requirePrice } from "@/lib/billing/prices";

/**
 * Starting a checkout.
 *
 * The two tests worth having are the price assertion — §6.3 rule 1 makes a
 * mismatch a P0 rather than a rounding difference — and the shape of the trial,
 * because "€3 now, €24.99 on day 4" is three fields in one object and nothing
 * else in the system says it.
 */

const ENV = {
  STRIPE_PRICE_PRO_MONTH_EUR: "price_pro_month_eur",
  STRIPE_PRICE_PRO_YEAR_EUR: "price_pro_year_eur",
  STRIPE_PRICE_LEARNER_MONTH_EUR: "price_learner_month_eur",
  STRIPE_PRICE_TRIAL_FEE_EUR: "price_trial_fee_eur",
  NEXT_PUBLIC_SITE_URL: "https://meritkeep.test",
};

const stripeWith = (prices: Record<string, unknown>, session = { id: "cs_1", url: "https://checkout.test/x" }) =>
  new MemoryStripe({ ...prices, "/checkout/sessions": session });

describe("assertPriceMatches", () => {
  it("passes when the amount and currency agree", () => {
    expect(() =>
      assertPriceMatches(
        { amountCents: 2_499, currency: "eur" },
        { id: "p", unit_amount: 2_499, currency: "eur" },
      ),
    ).not.toThrow();
  });

  it("accepts Stripe shouting the currency", () => {
    expect(() =>
      assertPriceMatches(
        { amountCents: 2_499, currency: "eur" },
        { id: "p", unit_amount: 2_499, currency: "EUR" },
      ),
    ).not.toThrow();
  });

  it("throws on a different amount", () => {
    expect(() =>
      assertPriceMatches(
        { amountCents: 2_499, currency: "eur" },
        { id: "p", unit_amount: 2_500, currency: "eur" },
      ),
    ).toThrow(PriceMismatchError);
  });

  it("throws on a different currency", () => {
    // The exact §6.3 rule 1 example: page says €25, checkout charges $25.
    expect(() =>
      assertPriceMatches(
        { amountCents: 2_499, currency: "eur" },
        { id: "p", unit_amount: 2_499, currency: "usd" },
      ),
    ).toThrow(/page says 2499 eur, Stripe says 2499 usd/);
  });

  it("throws on a price with no amount at all", () => {
    expect(() =>
      assertPriceMatches(
        { amountCents: 2_499, currency: "eur" },
        { id: "p", unit_amount: null, currency: "eur" },
      ),
    ).toThrow(PriceMismatchError);
  });
});

describe("priceIdFor", () => {
  it("reads the id out of the environment", () => {
    expect(priceIdFor("STRIPE_PRICE_PRO_MONTH_EUR", ENV)).toBe(
      "price_pro_month_eur",
    );
  });

  it("says which variable is missing", () => {
    expect(() => priceIdFor("STRIPE_PRICE_PRO_MONTH_USD", ENV)).toThrow(
      /STRIPE_PRICE_PRO_MONTH_USD is not set/,
    );
  });
});

describe("checkoutBody", () => {
  const base = {
    userId: "u1",
    interval: "month" as const,
    currency: "eur" as const,
  };

  it("bills a plain subscription with no trial fields", () => {
    const body = checkoutBody(
      { ...base, planId: "pro" },
      { subscriptionPriceId: "price_pro" },
    );

    expect(body.mode).toBe("subscription");
    expect(body.line_items).toEqual([{ price: "price_pro", quantity: 1 }]);
    const data = body.subscription_data as Record<string, unknown>;
    expect(data).not.toHaveProperty("trial_period_days");
    expect(data).not.toHaveProperty("add_invoice_items");
  });

  it("expresses the trial as four days of Pro with a €3 first invoice", () => {
    // The line item is Pro because Pro is what renews; the fee rides the first
    // invoice, which during a trial is issued immediately at zero.
    const body = checkoutBody(
      { ...base, planId: "trial" },
      { subscriptionPriceId: "price_pro", trialFeePriceId: "price_fee" },
    );

    expect(body.line_items).toEqual([{ price: "price_pro", quantity: 1 }]);
    const data = body.subscription_data as Record<string, unknown>;
    expect(data.trial_period_days).toBe(TRIAL_DAYS);
    expect(data.add_invoice_items).toEqual([{ price: "price_fee" }]);
  });

  it("carries the account on the session and the subscription", () => {
    // So the webhook can attribute without trusting anything the browser sent.
    const body = checkoutBody(
      { ...base, planId: "pro" },
      { subscriptionPriceId: "price_pro" },
    );

    expect(body.client_reference_id).toBe("u1");
    expect(body.metadata).toEqual({ userId: "u1", planId: "pro" });
    expect((body.subscription_data as Record<string, unknown>).metadata).toEqual(
      { userId: "u1", planId: "pro" },
    );
  });

  it("reuses a known customer instead of asking for an email again", () => {
    const body = checkoutBody(
      { ...base, planId: "pro", customerId: "cus_1", email: "a@b.test" },
      { subscriptionPriceId: "price_pro" },
    );

    expect(body.customer).toBe("cus_1");
    expect(body).not.toHaveProperty("customer_email");
  });

  it("passes the email when there is no customer yet", () => {
    const body = checkoutBody(
      { ...base, planId: "pro", email: "a@b.test" },
      { subscriptionPriceId: "price_pro" },
    );
    expect(body.customer_email).toBe("a@b.test");
  });

  it("turns Stripe Tax on", () => {
    expect(
      checkoutBody({ ...base, planId: "pro" }, { subscriptionPriceId: "p" })
        .automatic_tax,
    ).toEqual({ enabled: true });
  });
});

describe("createCheckoutSession", () => {
  const pro = requirePrice("pro", "month", "eur");
  const fee = requirePrice("trial", "month", "eur");

  it("checks the price with Stripe before creating anything", async () => {
    const stripe = stripeWith({
      "/prices/price_pro_month_eur": {
        id: "price_pro_month_eur",
        unit_amount: pro.amountCents,
        currency: "eur",
      },
    });

    const session = await createCheckoutSession(
      stripe,
      { userId: "u1", planId: "pro", interval: "month", currency: "eur" },
      ENV,
    );

    expect(session.id).toBe("cs_1");
    expect(stripe.calls[0]).toEqual({
      method: "GET",
      path: "/prices/price_pro_month_eur",
    });
  });

  it("refuses to charge an amount the page never showed", async () => {
    const stripe = stripeWith({
      "/prices/price_pro_month_eur": {
        id: "price_pro_month_eur",
        unit_amount: 9_900,
        currency: "eur",
      },
    });

    await expect(
      createCheckoutSession(
        stripe,
        { userId: "u1", planId: "pro", interval: "month", currency: "eur" },
        ENV,
      ),
    ).rejects.toThrow(PriceMismatchError);

    // Nothing was created.
    expect(stripe.calls.some((c) => c.path === "/checkout/sessions")).toBe(false);
  });

  it("checks both prices for a trial", async () => {
    const stripe = stripeWith({
      "/prices/price_pro_month_eur": {
        id: "price_pro_month_eur",
        unit_amount: pro.amountCents,
        currency: "eur",
      },
      "/prices/price_trial_fee_eur": {
        id: "price_trial_fee_eur",
        unit_amount: fee.amountCents,
        currency: "eur",
      },
    });

    await createCheckoutSession(
      stripe,
      { userId: "u1", planId: "trial", interval: "month", currency: "eur" },
      ENV,
    );

    expect(stripe.calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("refuses when the trial fee itself is wrong", async () => {
    const stripe = stripeWith({
      "/prices/price_pro_month_eur": {
        id: "price_pro_month_eur",
        unit_amount: pro.amountCents,
        currency: "eur",
      },
      "/prices/price_trial_fee_eur": {
        id: "price_trial_fee_eur",
        unit_amount: 500,
        currency: "eur",
      },
    });

    await expect(
      createCheckoutSession(
        stripe,
        { userId: "u1", planId: "trial", interval: "month", currency: "eur" },
        ENV,
      ),
    ).rejects.toThrow(PriceMismatchError);
  });

  it("deduplicates a double-submitted checkout", async () => {
    const stripe = stripeWith({
      "/prices/price_pro_year_eur": {
        id: "price_pro_year_eur",
        unit_amount: requirePrice("pro", "year", "eur").amountCents,
        currency: "eur",
      },
    });

    await createCheckoutSession(
      stripe,
      { userId: "u1", planId: "pro", interval: "year", currency: "eur" },
      ENV,
    );

    const post = stripe.calls.find((c) => c.method === "POST")!;
    expect(post.idempotencyKey).toBe("checkout:u1:pro:year:eur");
  });
});

describe("createPortalSession", () => {
  it("sends the customer and a return url", async () => {
    const stripe = new MemoryStripe({
      "/billing_portal/sessions": { url: "https://portal.test/x" },
    });

    const result = await createPortalSession(stripe, "cus_1");

    expect(result.url).toBe("https://portal.test/x");
    expect(stripe.calls[0]!.body).toMatchObject({ customer: "cus_1" });
    expect(String(stripe.calls[0]!.body!.return_url)).toContain(
      "/account/billing",
    );
  });
});
