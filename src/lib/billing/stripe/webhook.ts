import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { referral, subscription, user } from "@/db/schema";
import { capture } from "@/lib/observability";
import { type PlanId, resolvePlanId } from "../catalog";
import { isCurrency } from "../prices";
import { rewardReferral } from "@/lib/referral/store";
import {
  closeEvent,
  recordEvent,
  revokeGrantsForReferral,
  saveSubscription,
} from "../store";

/**
 * What Stripe tells us, turned into rows — PLAN-MONETIZATION §6.
 *
 * The ordering rule for everything here: **file the event first, act second.**
 * The unique index on `billing_event.stripe_event_id` is the idempotency
 * mechanism, and it only works if the insert happens before any side effect.
 */

/** The events this endpoint acts on. Everything else is acknowledged and dropped. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type HandleResult =
  | { status: "handled"; event: string }
  | { status: "ignored"; event: string }
  | { status: "replay"; event: string };

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Whatever was thrown, as a sentence for the `billing_event` row.
 *
 * Its own function rather than a ternary inside the catch because a `throw`
 * that is not an `Error` cannot be provoked through the handler — every path
 * into it throws from Drizzle or from `fetch` — and a branch no test can reach
 * is a design problem rather than a coverage problem.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Stripe sends seconds; Postgres wants a Date. */
export function secondsToDate(value: unknown): Date | null {
  const seconds = num(value);
  return seconds === null ? null : new Date(seconds * 1000);
}

/**
 * Which of our plans a Stripe subscription represents.
 *
 * Read from the metadata we set at checkout rather than inferred from the price
 * id, because the price id is an environment variable that differs between test
 * and live mode and would have to be resolved on every delivery. A subscription
 * still inside its trial is `trial` whatever its metadata says — that is the
 * one case where Stripe knows better than the note we left ourselves.
 */
export function planFromSubscription(
  object: Record<string, unknown>,
): PlanId {
  if (str(object.status) === "trialing") return "trial";

  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  return resolvePlanId(metadata.planId);
}

/** The account a Stripe object belongs to, by the id we attached at checkout. */
export function userIdFrom(object: Record<string, unknown>): string | null {
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  return str(metadata.userId) ?? str(object.client_reference_id);
}

/**
 * A subscription object, written to our row.
 *
 * The amount and currency are read off the first item's price rather than off
 * the subscription, because a subscription with an added invoice item — which
 * is exactly what the €3 trial is — reports a total that is not the recurring
 * amount. What we store is what will renew.
 */
async function writeSubscription(
  db: Db,
  object: Record<string, unknown>,
  now: Date,
): Promise<boolean> {
  const stripeSubscriptionId = str(object.id);
  const stripeCustomerId = str(object.customer);
  const userId = userIdFrom(object);
  if (!stripeSubscriptionId || !stripeCustomerId || !userId) return false;

  const items = (object.items ?? {}) as { data?: unknown };
  const first = (Array.isArray(items.data) ? items.data[0] : undefined) as
    | { price?: Record<string, unknown> }
    | undefined;
  const price = first?.price ?? {};

  const currency = str(price.currency)?.toLowerCase();
  const recurring = (price.recurring ?? {}) as Record<string, unknown>;

  await saveSubscription(
    db,
    {
      userId,
      stripeSubscriptionId,
      stripeCustomerId,
      planId: planFromSubscription(object),
      interval: str(recurring.interval) ?? "month",
      currency: isCurrency(currency) ? currency : "usd",
      amountCents: num(price.unit_amount) ?? 0,
      status: str(object.status) ?? "incomplete",
      currentPeriodEnd:
        secondsToDate(object.current_period_end) ?? new Date(now),
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      trialEndsAt: secondsToDate(object.trial_end),
      endedAt: secondsToDate(object.ended_at),
    },
    now,
  );

  // Keep the Stripe customer on the account so a later portal session and a
  // resubscribe reuse it instead of creating a duplicate customer.
  await db
    .update(user)
    .set({ stripeCustomerId, updatedAt: now })
    .where(eq(user.id, userId));

  return true;
}

/**
 * A successful payment qualifies a pending referral.
 *
 * The trigger is the money arriving, never the signup — §9.3's "reward before
 * payment" rule, and the only one of the five that cannot be expressed as a
 * database constraint. The grant itself is written by the referral module; this
 * marks the row and says so.
 */
async function qualifyReferral(
  db: Db,
  userId: string,
  now: Date,
): Promise<void> {
  const rows = await db
    .update(referral)
    .set({ status: "qualified", firstPaymentAt: now, updatedAt: now })
    // `pending` only: a rejected referral must not be resurrected by a payment,
    // and an already-rewarded one must not have its clock restarted by the
    // second month's invoice.
    .where(and(eq(referral.refereeId, userId), eq(referral.status, "pending")))
    .returning({ id: referral.id });

  if (rows.length === 0) return;

  capture("referral_qualified", { referral_id: rows[0]!.id });

  // §9.2 — the referrer's fourteen days, now that the money has arrived.
  await rewardReferral(db, userId, now);
}

/**
 * A payment landed: find who made it, and qualify their referral if they have one.
 *
 * Its own function rather than three lines inside the switch, because "we could
 * not work out whose money this was" is a real outcome worth naming and worth
 * testing on its own — an invoice does not inherit the subscription's metadata,
 * so the customer id is usually the only link back to an account, and when both
 * are missing the honest answer is to do nothing.
 *
 * Returns whether an account was identified.
 */
export async function onInvoicePaid(
  db: Db,
  object: Record<string, unknown>,
  now: Date,
): Promise<boolean> {
  const userId = userIdFrom(object) ?? (await ownerOf(db, object));
  if (!userId) return false;

  await qualifyReferral(db, userId, now);
  return true;
}

/**
 * A refund or a dispute withdraws whatever the referral paid for.
 *
 * Revoking rather than waiting out a refund window is §9.3's call: the reward
 * is a date, so taking it back costs nothing, and a referrer who has to wait a
 * week for a reward promised on payment stops referring.
 */
async function reverseReferral(
  db: Db,
  chargeCustomerId: string | null,
  now: Date,
): Promise<void> {
  if (!chargeCustomerId) return;

  const [owner] = await db
    .select({ userId: subscription.userId })
    .from(subscription)
    .where(eq(subscription.stripeCustomerId, chargeCustomerId))
    .limit(1);
  if (!owner) return;

  const [row] = await db
    .update(referral)
    .set({ status: "rejected", rejectedReason: "refunded", updatedAt: now })
    .where(eq(referral.refereeId, owner.userId))
    .returning({ id: referral.id });
  if (!row) return;

  await revokeGrantsForReferral(db, row.id, now);
}

/**
 * File the event, then act on it.
 *
 * Returns `replay` without doing anything when Stripe has delivered this id
 * before — which it does, routinely, because any response that is not a 200
 * within its timeout is retried.
 */
export async function handleEvent(
  db: Db,
  event: StripeEvent,
  now: Date = new Date(),
): Promise<HandleResult> {
  const fresh = await recordEvent(
    db,
    { id: event.id, type: event.type, payload: event },
    now,
  );
  if (!fresh) return { status: "replay", event: event.type };

  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    // Acknowledged and dropped. Filed anyway, because "what did Stripe actually
    // send us" is a question worth being able to answer.
    await closeEvent(db, event.id, null, now);
    return { status: "ignored", event: event.type };
  }

  const object = event.data.object;

  try {
    switch (event.type as HandledEvent) {
      case "checkout.session.completed":
        // Nothing is written here. The session tells us a checkout finished;
        // `customer.subscription.created` tells us what was actually bought,
        // arrives for every subscription however it was started, and is the
        // only one of the two that carries the price.
        capture("checkout_started", {
          plan: str((object.metadata as Record<string, unknown>)?.planId),
        });
        break;

      case "customer.subscription.created":
        if (await writeSubscription(db, object, now)) {
          capture("subscription_created", {
            plan: planFromSubscription(object),
            trial: str(object.status) === "trialing",
          });
        }
        break;

      case "customer.subscription.updated":
        await writeSubscription(db, object, now);
        if (object.cancel_at_period_end === true) {
          capture("subscription_cancelled", { at_period_end: true });
        }
        break;

      case "customer.subscription.deleted":
        await writeSubscription(db, { ...object, status: "canceled" }, now);
        capture("subscription_cancelled", { at_period_end: false });
        break;

      case "invoice.paid":
        await onInvoicePaid(db, object, now);
        break;

      case "invoice.payment_failed":
        // Nothing is written: Stripe moves the subscription to `past_due` and
        // sends `customer.subscription.updated`, which is what this product
        // reads. §5 carries entitlements through one dunning cycle from there.
        break;

      case "charge.refunded":
      case "charge.dispute.created":
        await reverseReferral(db, str(object.customer), now);
        break;
    }

    await closeEvent(db, event.id, null, now);
    return { status: "handled", event: event.type };
  } catch (error) {
    // Recorded on the row rather than swallowed, and rethrown so the route
    // answers non-2xx and Stripe retries. The replay is safe: the filed row is
    // already there, so a retry that succeeds this time still cannot double up
    // the side effects that did land.
    await closeEvent(db, event.id, messageOf(error), now);
    throw error;
  }
}

/** The account behind a Stripe customer, when the object carried no metadata. */
async function ownerOf(
  db: Db,
  object: Record<string, unknown>,
): Promise<string | null> {
  const customerId = str(object.customer);
  if (!customerId) return null;

  const [row] = await db
    .select({ userId: subscription.userId })
    .from(subscription)
    .where(eq(subscription.stripeCustomerId, customerId))
    .limit(1);

  return row?.userId ?? null;
}
