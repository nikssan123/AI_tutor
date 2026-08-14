import {
  type Entitlements,
  PLANS,
  type PlanId,
  resolvePlanId,
} from "./catalog";

/**
 * Who is entitled to what — PLAN-MONETIZATION §5.
 *
 * A pure function over plain shapes rather than over Drizzle rows, for the
 * reason §5 gives: every branch has to be reachable from a unit test to satisfy
 * the 100% branch threshold, and a resolver that reads the database itself
 * cannot be exercised without one.
 *
 * The caller loads the rows; this decides what they mean.
 */

/**
 * Stripe's subscription statuses, narrowed to the ones this product can
 * actually be in.
 *
 * `incomplete_expired` and `paused` are absent deliberately: the first is
 * indistinguishable from never having subscribed, and the second requires
 * pause-collection behaviour we do not configure. Both arrive as unknown
 * strings and resolve to "not entitled", which is the safe direction.
 */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isSubscriptionStatus(
  value: unknown,
): value is SubscriptionStatus {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

export interface SubscriptionSnapshot {
  readonly planId: PlanId;
  readonly status: SubscriptionStatus;
  /** When the paid-for window ends. During a trial, when the trial ends. */
  readonly currentPeriodEnd: Date;
}

export interface GrantSnapshot {
  readonly planId: PlanId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly revokedAt: Date | null;
}

export interface EntitlementInput {
  /** The `user.plan` column — the fast path, and the fallback. */
  readonly plan?: unknown;
  readonly subscription?: SubscriptionSnapshot | null;
  readonly grants?: readonly GrantSnapshot[];
}

export interface ResolvedEntitlement {
  readonly planId: PlanId;
  readonly entitlements: Entitlements;
  readonly spendCapCents: number;
  readonly source: "grant" | "subscription" | "plan";
}

/**
 * How long a `past_due` subscription keeps working.
 *
 * §5: "cutting a paying customer off over a card that expired is how you lose
 * one who wanted to stay." Fourteen days past the period end is roughly Stripe's
 * own default retry schedule, so service ends at about the same moment Stripe
 * gives up rather than well before it — which means dunning email and lived
 * experience agree instead of contradicting each other.
 */
export const PAST_DUE_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Is this subscription currently worth anything to its owner?
 *
 * `active` is true regardless of `currentPeriodEnd`, and that is deliberate:
 * Stripe keeps the status `active` right up to the moment a cancellation takes
 * effect, so somebody who cancelled on day 2 of a month still reads as active —
 * and still paid for the rest of it. The status is the authority on entitlement;
 * the date is only consulted where the status is ambiguous about time.
 */
export function subscriptionEntitled(
  subscription: SubscriptionSnapshot,
  now: Date,
): boolean {
  switch (subscription.status) {
    case "active":
      return true;
    case "trialing":
      return now < subscription.currentPeriodEnd;
    case "past_due":
      return (
        now <
        new Date(
          subscription.currentPeriodEnd.getTime() +
            PAST_DUE_GRACE_DAYS * DAY_MS,
        )
      );
    case "canceled":
    case "unpaid":
    case "incomplete":
      return false;
  }
}

export function grantActive(grant: GrantSnapshot, now: Date): boolean {
  return (
    grant.revokedAt === null && now >= grant.startsAt && now < grant.endsAt
  );
}

/**
 * The best grant currently running, or nothing.
 *
 * "Best" is the one that ends latest rather than the one that started latest:
 * two referrals landing in the same week should extend a learner's Pro time,
 * and picking the newest would silently shorten it.
 */
export function activeGrant(
  grants: readonly GrantSnapshot[],
  now: Date,
): GrantSnapshot | undefined {
  let best: GrantSnapshot | undefined;
  for (const grant of grants) {
    if (!grantActive(grant, now)) continue;
    if (!best || grant.endsAt > best.endsAt) best = grant;
  }
  return best;
}

/**
 * §5's precedence: an active grant, then the subscription, then the column.
 *
 * The subscription wins over `user.plan` **whenever a subscription row exists at
 * all**, even an expired one. The column is a derived cache and a stale cache is
 * exactly what this ordering exists to survive; falling back to it for someone
 * whose subscription has plainly ended would let a missed webhook hand out a
 * paid plan indefinitely.
 */
export function entitlementsFor(
  input: EntitlementInput,
  now: Date = new Date(),
): ResolvedEntitlement {
  const grant = activeGrant(input.grants ?? [], now);
  if (grant) {
    const granted = PLANS[grant.planId];
    return {
      planId: grant.planId,
      entitlements: granted.entitlements,
      // §1 decision 10 — a grant is not a payment. Capped at the trial's
      // ceiling however generous the granted plan is, so two colluding accounts
      // draw trial-sized inference rather than Pro-sized inference.
      spendCapCents: Math.min(
        granted.spendCapCents,
        PLANS.trial.spendCapCents,
      ),
      source: "grant",
    };
  }

  const subscription = input.subscription;
  if (subscription) {
    const planId = subscriptionEntitled(subscription, now)
      ? subscription.planId
      : "free";
    const plan = PLANS[planId];
    return {
      planId,
      entitlements: plan.entitlements,
      spendCapCents: plan.spendCapCents,
      source: "subscription",
    };
  }

  const planId = resolvePlanId(input.plan);
  const plan = PLANS[planId];
  return {
    planId,
    entitlements: plan.entitlements,
    spendCapCents: plan.spendCapCents,
    source: "plan",
  };
}
