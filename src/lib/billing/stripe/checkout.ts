import type { EnvLike } from "@/lib/env-types";
import { canonical } from "@/lib/site";
import type { Interval } from "../catalog";
import { type Currency, type PaidPlanId, requirePrice } from "../prices";
import type { StripeClient } from "./client";

/**
 * Starting a checkout — PLAN-MONETIZATION §3 and §7.
 *
 * Two things happen here that are not "call Stripe": the price the page showed
 * is checked against the price Stripe holds, and the €3 trial is expressed as a
 * subscription rather than as a product of its own.
 */

/** The subset of Stripe's Price object this needs. */
export interface StripePrice {
  id: string;
  unit_amount: number | null;
  currency: string;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
}

export class PriceMismatchError extends Error {
  constructor(
    readonly expected: { amountCents: number; currency: Currency },
    readonly actual: { amountCents: number | null; currency: string },
  ) {
    super(
      `The price on the page and the price in Stripe disagree: page says ${expected.amountCents} ${expected.currency}, Stripe says ${actual.amountCents} ${actual.currency}. Refusing to create a checkout session.`,
    );
    this.name = "PriceMismatchError";
  }
}

/**
 * §6.3 rule 1, enforced in code rather than by hope.
 *
 * *"If the pricing page shows €25 and checkout charges $25, that is a P0 bug,
 * not a rounding difference."* The page renders from `prices.ts`; Stripe holds
 * the amount it will actually charge; this is the only moment the two can be
 * compared before somebody's card is touched.
 *
 * It throws rather than falling back to Stripe's number. Charging an amount the
 * customer was never shown is the failure being prevented, not a recovery from
 * it — and a silent correction would make the bug invisible for exactly as long
 * as it took to become a chargeback.
 */
export function assertPriceMatches(
  expected: { amountCents: number; currency: Currency },
  actual: StripePrice,
): void {
  if (
    actual.unit_amount !== expected.amountCents ||
    actual.currency.toLowerCase() !== expected.currency
  ) {
    throw new PriceMismatchError(expected, {
      amountCents: actual.unit_amount,
      currency: actual.currency,
    });
  }
}

/**
 * The Stripe Price id for a row in our table.
 *
 * Ids live in the environment because they differ between test and live mode;
 * amounts live in `prices.ts` because a static page has to render one without a
 * network call. `envVar` is the join between them.
 */
export function priceIdFor(envVar: string, env: EnvLike = process.env): string {
  const id = env[envVar];
  if (!id) {
    throw new Error(
      `${envVar} is not set, so there is no Stripe price to charge. Create the price in Stripe and put its id in the environment.`,
    );
  }
  return id;
}

export interface CheckoutInput {
  userId: string;
  planId: PaidPlanId;
  interval: Interval;
  currency: Currency;
  /** Reused as the Stripe customer when this account has paid before. */
  customerId?: string | null;
  email?: string | null;
  successPath?: string;
  cancelPath?: string;
}

/** §7 — four days, then Pro renews. */
export const TRIAL_DAYS = 4;

/**
 * Build the Checkout Session body.
 *
 * Separated from the call so the shape can be asserted in a test without a
 * client, because the shape *is* the product decision: a trial that bills €3
 * now and €24.99 on day 4 is three fields in this object and nothing else.
 *
 * For the trial:
 * - the line item is the **Pro** price, because that is what renews;
 * - `trial_period_days` stops Stripe charging it today;
 * - `add_invoice_items` puts the €3 fee on the first invoice, which during a
 *   trial is issued immediately at €0 — so €3 is taken now.
 *
 * That last step is the one mechanic in this plan asserted from documentation
 * rather than measurement. §15 step 3 verifies it in test mode before anything
 * depends on it.
 */
export function checkoutBody(
  input: CheckoutInput,
  ids: { subscriptionPriceId: string; trialFeePriceId?: string },
): Record<string, unknown> {
  const isTrial = input.planId === "trial";

  return {
    mode: "subscription",
    // Stripe Tax computes destination VAT. It does not file it — see
    // `stripe/client.ts` and §13 risk 1.
    automatic_tax: { enabled: true },
    line_items: [{ price: ids.subscriptionPriceId, quantity: 1 }],
    success_url: canonical(input.successPath ?? "/today") + "?checkout=done",
    cancel_url: canonical(input.cancelPath ?? "/pricing"),
    ...(input.customerId
      ? { customer: input.customerId }
      : { customer_email: input.email ?? undefined }),
    // Carried so the webhook can attribute a session to an account without
    // trusting anything the browser sent back.
    client_reference_id: input.userId,
    subscription_data: {
      metadata: { userId: input.userId, planId: input.planId },
      ...(isTrial
        ? {
            trial_period_days: TRIAL_DAYS,
            add_invoice_items: [{ price: ids.trialFeePriceId }],
          }
        : {}),
    },
    metadata: { userId: input.userId, planId: input.planId },
  };
}

/**
 * Create the session, having first checked that Stripe agrees about the price.
 *
 * The trial reads the **Pro** price row, because Pro is what the subscription
 * will charge; the €3 fee is a separate line whose amount is checked in the
 * same way.
 */
export async function createCheckoutSession(
  stripe: StripeClient,
  input: CheckoutInput,
  env: EnvLike = process.env,
): Promise<CheckoutSession> {
  const isTrial = input.planId === "trial";
  const subscriptionPlan: PaidPlanId = isTrial ? "pro" : input.planId;

  const subscriptionPrice = requirePrice(
    subscriptionPlan,
    input.interval,
    input.currency,
  );
  const subscriptionPriceId = priceIdFor(subscriptionPrice.envVar, env);

  assertPriceMatches(
    subscriptionPrice,
    await stripe.get<StripePrice>(`/prices/${subscriptionPriceId}`),
  );

  let trialFeePriceId: string | undefined;
  if (isTrial) {
    const fee = requirePrice("trial", "month", input.currency);
    trialFeePriceId = priceIdFor(fee.envVar, env);
    assertPriceMatches(
      fee,
      await stripe.get<StripePrice>(`/prices/${trialFeePriceId}`),
    );
  }

  return stripe.post<CheckoutSession>(
    "/checkout/sessions",
    checkoutBody(input, { subscriptionPriceId, trialFeePriceId }),
    // One in-flight checkout per account per plan and currency. A double-submit
    // returns the same session rather than creating a second subscription.
    `checkout:${input.userId}:${input.planId}:${input.interval}:${input.currency}`,
  );
}

/**
 * Stripe's own billing portal, for card updates and invoice history.
 *
 * Not rebuilt here. Handling a card number is the one thing in this product
 * that would drag PCI scope into a codebase that currently has none.
 */
export async function createPortalSession(
  stripe: StripeClient,
  customerId: string,
  returnPath = "/account/billing",
): Promise<{ url: string }> {
  return stripe.post<{ url: string }>("/billing_portal/sessions", {
    customer: customerId,
    return_url: canonical(returnPath),
  });
}
