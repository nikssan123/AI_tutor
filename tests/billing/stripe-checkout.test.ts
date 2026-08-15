import { describe, expect, it } from "vitest";
import { MemoryStripe } from "@/lib/billing/stripe/client";
import {
  checkoutBody,
  createCheckoutSession,
  createPortalSession,
  lineItem,
  PRODUCT_NAMES,
  TRIAL_DAYS,
} from "@/lib/billing/stripe/checkout";
import { requirePrice } from "@/lib/billing/prices";

/**
 * Starting a checkout.
 *
 * Prices are sent inline, so the assertion that used to matter most — that the
 * page and Stripe agree on the amount — is now a property of the code rather
 * than a check that can fail. What is left worth testing is that the amount put
 * on the wire is the one in `prices.ts`, that `tax_behavior` follows the
 * currency, and the shape of the trial: "€3 now, €24.99 on day 4" is one
 * one-off line item plus one field, and nothing else in the system says it.
 */

const priceData = (item: unknown) =>
  (item as { price_data: Record<string, unknown> }).price_data;

const stripeWith = (session = { id: "cs_1", url: "https://checkout.test/x" }) =>
  new MemoryStripe({ "/checkout/sessions": session });

describe("lineItem", () => {
  it("sends the amount from the table, not an id", () => {
    const pro = requirePrice("pro", "month", "eur");
    const data = priceData(lineItem(pro, "MeritKeep Pro", true));

    expect(data).toEqual({
      currency: "eur",
      unit_amount: pro.amountCents,
      tax_behavior: "inclusive",
      product_data: { name: "MeritKeep Pro" },
      recurring: { interval: "month" },
    });
  });

  it("marks a dollar price net", () => {
    expect(
      priceData(lineItem(requirePrice("pro", "year", "usd"), "x", true)),
    ).toMatchObject({ tax_behavior: "exclusive", recurring: { interval: "year" } });
  });

  it("leaves a one-off with no recurrence at all", () => {
    // Presence of `recurring` is what makes Stripe renew it, so the trial fee
    // must not merely have a short interval — it must have none.
    expect(
      priceData(lineItem(requirePrice("trial", "month", "eur"), "x", false)),
    ).not.toHaveProperty("recurring");
  });
});

describe("checkoutBody", () => {
  const base = {
    userId: "u1",
    interval: "month" as const,
    currency: "eur" as const,
  };

  it("bills a plain subscription as one recurring line and no trial", () => {
    const body = checkoutBody({ ...base, planId: "pro" });
    const items = body.line_items as unknown[];

    expect(body.mode).toBe("subscription");
    expect(items).toHaveLength(1);
    expect(priceData(items[0])).toMatchObject({
      unit_amount: requirePrice("pro", "month", "eur").amountCents,
      product_data: { name: PRODUCT_NAMES.pro },
      recurring: { interval: "month" },
    });
    expect(body.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("charges the yearly amount when the year is asked for", () => {
    const body = checkoutBody({ ...base, planId: "pro", interval: "year" });

    expect(priceData((body.line_items as unknown[])[0])).toMatchObject({
      unit_amount: requirePrice("pro", "year", "eur").amountCents,
      recurring: { interval: "year" },
    });
  });

  it("expresses the trial as four days of Pro plus a €3 one-off", () => {
    // The recurring line is Pro because Pro is what renews; the fee is a
    // one-off, which lands on the first invoice — issued immediately.
    const body = checkoutBody({ ...base, planId: "trial" });
    const [subscription, fee] = body.line_items as unknown[];

    expect(priceData(subscription)).toMatchObject({
      unit_amount: requirePrice("pro", "month", "eur").amountCents,
      recurring: { interval: "month" },
    });
    expect(priceData(fee)).toMatchObject({
      unit_amount: requirePrice("trial", "month", "eur").amountCents,
      product_data: { name: PRODUCT_NAMES.trial },
    });
    expect(priceData(fee)).not.toHaveProperty("recurring");
    expect(
      (body.subscription_data as Record<string, unknown>).trial_period_days,
    ).toBe(TRIAL_DAYS);
  });

  it("bills the learner plan at the learner price", () => {
    expect(
      priceData(
        (checkoutBody({ ...base, planId: "learner" }).line_items as unknown[])[0],
      ),
    ).toMatchObject({
      unit_amount: requirePrice("learner", "month", "eur").amountCents,
      product_data: { name: PRODUCT_NAMES.learner },
    });
  });

  it("carries the account on the session and the subscription", () => {
    // So the webhook can attribute without trusting anything the browser sent.
    const body = checkoutBody({ ...base, planId: "pro" });

    expect(body.client_reference_id).toBe("u1");
    expect(body.metadata).toEqual({ userId: "u1", planId: "pro" });
    expect((body.subscription_data as Record<string, unknown>).metadata).toEqual(
      { userId: "u1", planId: "pro" },
    );
  });

  it("reuses a known customer and re-reads their address for tax", () => {
    const body = checkoutBody({
      ...base,
      planId: "pro",
      customerId: "cus_1",
      email: "a@b.test",
    });

    expect(body.customer).toBe("cus_1");
    expect(body.customer_update).toEqual({ address: "auto" });
    expect(body).not.toHaveProperty("customer_email");
  });

  it("passes the email when there is no customer yet", () => {
    const body = checkoutBody({ ...base, planId: "pro", email: "a@b.test" });

    expect(body.customer_email).toBe("a@b.test");
    expect(body).not.toHaveProperty("customer_update");
  });

  it("turns Stripe Tax on", () => {
    expect(checkoutBody({ ...base, planId: "pro" }).automatic_tax).toEqual({
      enabled: true,
    });
  });
});

describe("createCheckoutSession", () => {
  it("creates the session in one call, with no price lookup first", async () => {
    const stripe = stripeWith();

    const session = await createCheckoutSession(stripe, {
      userId: "u1",
      planId: "pro",
      interval: "month",
      currency: "eur",
    });

    expect(session.id).toBe("cs_1");
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0]!.method).toBe("POST");
  });

  it("deduplicates a double-submitted checkout", async () => {
    const stripe = stripeWith();

    await createCheckoutSession(stripe, {
      userId: "u1",
      planId: "pro",
      interval: "year",
      currency: "eur",
    });

    expect(stripe.calls[0]!.idempotencyKey).toBe("checkout:u1:pro:year:eur");
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
