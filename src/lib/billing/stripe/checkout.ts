import { canonical } from "@/lib/site";
import type { Interval } from "../catalog";
import {
  type Currency,
  type PaidPlanId,
  type Price,
  requirePrice,
  taxBehavior,
} from "../prices";
import type { StripeClient } from "./client";

/**
 * Starting a checkout — PLAN-MONETIZATION §3 and §7.
 *
 * **There is no price catalogue in Stripe.** Every line carries its own
 * `price_data`, built from `prices.ts` when the session is created, so Stripe
 * never holds a copy of a number this product could disagree with. That is §6.3
 * rule 1 — *the displayed price must equal the charged price* — met by
 * construction rather than by a check. The previous shape kept eight Price ids
 * in the environment and read each amount back off Stripe before selling; the
 * mismatch it guarded against is now unrepresentable, and eight environment
 * variables per mode went with it.
 *
 * What that costs is Stripe's own bookkeeping: products and prices are created
 * ad-hoc per session, so the Dashboard's product reports are noise. Revenue by
 * plan comes from `metadata.planId`, which every session and every subscription
 * carries, and which the webhook already reads.
 */

export interface CheckoutSession {
  id: string;
  url: string | null;
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
 * What the receipt calls each thing.
 *
 * Deliberately not `PLAN_COPY[planId].name`. Those strings are card headings —
 * "Try Pro" is an instruction to a reader — and these are read a year later on
 * a bank statement beside a charge somebody is deciding whether to dispute.
 * They have to name a product, so they are written once, here.
 */
export const PRODUCT_NAMES: Record<PaidPlanId, string> = {
  trial: "MeritKeep Pro — 4-day trial",
  learner: "MeritKeep Learner",
  pro: "MeritKeep Pro",
};

/**
 * One line item, priced inline.
 *
 * `tax_behavior` is the field that must not be got wrong: euro amounts are
 * VAT-inclusive because EU consumer law requires the price shown to be the
 * price paid, dollar amounts are net with sales tax added on top (§6.2). It is
 * derived from the currency rather than passed in, so the two columns cannot
 * drift apart at the one call site that spends money.
 *
 * `recurring` is absent for the trial fee, and that absence is the whole trial
 * mechanic: a one-off line on a subscription session lands on the **first**
 * invoice only, and during a trial that invoice is issued immediately — so €3
 * is taken today and the €24.99 beside it is not.
 */
export function lineItem(
  price: Price,
  name: string,
  recurring: boolean,
): Record<string, unknown> {
  return {
    quantity: 1,
    price_data: {
      currency: price.currency,
      unit_amount: price.amountCents,
      tax_behavior: taxBehavior(price.currency),
      // No `tax_code`: the account's default from Tax Settings applies, which
      // is one place to set it rather than one per line.
      product_data: { name },
      ...(recurring ? { recurring: { interval: price.interval } } : {}),
    },
  };
}

/**
 * Build the Checkout Session body.
 *
 * Separated from the call so the shape can be asserted without a client,
 * because the shape *is* the product decision: "€3 today, €24.99 on day 4" is a
 * second line item and one field, and nothing else in the system says it.
 *
 * For the trial the recurring line is the **Pro** price, because Pro is what
 * renews; `trial_period_days` stops Stripe charging it today; the fee rides
 * alongside as the one-off described on `lineItem`.
 */
export function checkoutBody(input: CheckoutInput): Record<string, unknown> {
  const isTrial = input.planId === "trial";
  const subscriptionPlan: PaidPlanId = isTrial ? "pro" : input.planId;

  const lineItems = [
    lineItem(
      requirePrice(subscriptionPlan, input.interval, input.currency),
      PRODUCT_NAMES[subscriptionPlan],
      true,
    ),
  ];

  if (isTrial) {
    lineItems.push(
      lineItem(
        requirePrice("trial", "month", input.currency),
        PRODUCT_NAMES.trial,
        false,
      ),
    );
  }

  return {
    mode: "subscription",
    // Stripe Tax computes destination VAT. It does not file it — see
    // `stripe/client.ts` and §13 risk 1.
    automatic_tax: { enabled: true },
    line_items: lineItems,
    success_url: canonical(input.successPath ?? "/today") + "?checkout=done",
    cancel_url: canonical(input.cancelPath ?? "/pricing"),
    ...(input.customerId
      ? {
          customer: input.customerId,
          // Without this, a returning customer is taxed on whatever address
          // Stripe already had rather than the one they just typed — someone
          // who moved country pays the old country's VAT.
          customer_update: { address: "auto" },
        }
      : { customer_email: input.email ?? undefined }),
    // Carried so the webhook can attribute a session to an account without
    // trusting anything the browser sent back.
    client_reference_id: input.userId,
    subscription_data: {
      metadata: { userId: input.userId, planId: input.planId },
      ...(isTrial ? { trial_period_days: TRIAL_DAYS } : {}),
    },
    metadata: { userId: input.userId, planId: input.planId },
  };
}

/** Create the session. */
export async function createCheckoutSession(
  stripe: StripeClient,
  input: CheckoutInput,
): Promise<CheckoutSession> {
  return stripe.post<CheckoutSession>(
    "/checkout/sessions",
    checkoutBody(input),
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
