import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/billing/catalog";
import {
  activeGrant,
  entitlementsFor,
  type GrantSnapshot,
  grantActive,
  isSubscriptionStatus,
  PAST_DUE_GRACE_DAYS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionSnapshot,
  subscriptionEntitled,
} from "@/lib/billing/entitlements";

/**
 * The entitlement resolver.
 *
 * This is the file where a mistake is expensive in both directions — too
 * generous and a cancelled account keeps drawing inference, too strict and
 * somebody who paid this morning is locked out — so the precedence table from
 * §5 is asserted as a matrix rather than sampled.
 */

const NOW = new Date("2026-08-15T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

const sub = (
  over: Partial<SubscriptionSnapshot> = {},
): SubscriptionSnapshot => ({
  planId: "pro",
  status: "active",
  currentPeriodEnd: days(10),
  ...over,
});

const grant = (over: Partial<GrantSnapshot> = {}): GrantSnapshot => ({
  planId: "pro",
  startsAt: days(-1),
  endsAt: days(13),
  revokedAt: null,
  ...over,
});

describe("isSubscriptionStatus", () => {
  it.each(SUBSCRIPTION_STATUSES)("accepts %s", (status) => {
    expect(isSubscriptionStatus(status)).toBe(true);
  });

  it.each([["paused"], ["incomplete_expired"], [null], [undefined], [1]])(
    "rejects %s",
    (value) => {
      // Both absentees resolve to "not entitled" via the unknown path, which is
      // the safe direction.
      expect(isSubscriptionStatus(value)).toBe(false);
    },
  );
});

describe("subscriptionEntitled", () => {
  it("entitles an active subscription regardless of the period end", () => {
    // Stripe keeps the status `active` right up to the moment a cancellation
    // takes effect, so someone who cancelled on day 2 still reads as active and
    // still paid for the rest of the month.
    expect(subscriptionEntitled(sub({ currentPeriodEnd: days(-5) }), NOW)).toBe(
      true,
    );
  });

  it("entitles a trial until it ends, and not after", () => {
    expect(
      subscriptionEntitled(
        sub({ status: "trialing", currentPeriodEnd: days(1) }),
        NOW,
      ),
    ).toBe(true);
    expect(
      subscriptionEntitled(
        sub({ status: "trialing", currentPeriodEnd: days(-1) }),
        NOW,
      ),
    ).toBe(false);
  });

  it("carries past_due through the dunning window and drops it after", () => {
    const endedYesterday = sub({ status: "past_due", currentPeriodEnd: days(-1) });
    expect(subscriptionEntitled(endedYesterday, NOW)).toBe(true);

    const longGone = sub({
      status: "past_due",
      currentPeriodEnd: days(-(PAST_DUE_GRACE_DAYS + 1)),
    });
    expect(subscriptionEntitled(longGone, NOW)).toBe(false);
  });

  it.each(["canceled", "unpaid", "incomplete"] as const)(
    "entitles nothing when %s",
    (status) => {
      expect(subscriptionEntitled(sub({ status }), NOW)).toBe(false);
    },
  );
});

describe("grantActive", () => {
  it("accepts a grant inside its window", () => {
    expect(grantActive(grant(), NOW)).toBe(true);
  });

  it("rejects one that has not started", () => {
    expect(grantActive(grant({ startsAt: days(1) }), NOW)).toBe(false);
  });

  it("rejects one that has ended", () => {
    expect(grantActive(grant({ endsAt: days(-1) }), NOW)).toBe(false);
  });

  it("rejects a revoked grant even inside its window", () => {
    // The refund path depends on this: revocation has to beat the dates.
    expect(grantActive(grant({ revokedAt: days(-1) }), NOW)).toBe(false);
  });
});

describe("activeGrant", () => {
  it("finds nothing in an empty list", () => {
    expect(activeGrant([], NOW)).toBeUndefined();
  });

  it("ignores inactive grants", () => {
    expect(activeGrant([grant({ endsAt: days(-1) })], NOW)).toBeUndefined();
  });

  it("keeps the one that ends latest, not the one that started latest", () => {
    // Two referrals in one week should extend Pro time, not shorten it.
    const longer = grant({ startsAt: days(-5), endsAt: days(20) });
    const newer = grant({ startsAt: days(-1), endsAt: days(6) });
    expect(activeGrant([newer, longer], NOW)).toBe(longer);
    expect(activeGrant([longer, newer], NOW)).toBe(longer);
  });
});

describe("entitlementsFor", () => {
  it("falls back to the user.plan column when nothing else exists", () => {
    const resolved = entitlementsFor({ plan: "learner" }, NOW);
    expect(resolved.planId).toBe("learner");
    expect(resolved.source).toBe("plan");
    expect(resolved.entitlements).toEqual(PLANS.learner.entitlements);
  });

  it("treats an unreadable column as free", () => {
    expect(entitlementsFor({ plan: "nonsense" }, NOW).planId).toBe("free");
    expect(entitlementsFor({}, NOW).planId).toBe("free");
  });

  it("prefers the subscription over the column", () => {
    const resolved = entitlementsFor(
      { plan: "free", subscription: sub() },
      NOW,
    );
    expect(resolved.planId).toBe("pro");
    expect(resolved.source).toBe("subscription");
  });

  it("drops to free when a subscription exists but has lapsed", () => {
    // A missed webhook must not be able to hand out a paid plan indefinitely,
    // so a stale `user.plan` of "pro" is deliberately not consulted here.
    const resolved = entitlementsFor(
      { plan: "pro", subscription: sub({ status: "canceled" }) },
      NOW,
    );
    expect(resolved.planId).toBe("free");
    expect(resolved.source).toBe("subscription");
  });

  it("prefers an active grant over everything", () => {
    const resolved = entitlementsFor(
      {
        plan: "free",
        subscription: sub({ status: "canceled" }),
        grants: [grant()],
      },
      NOW,
    );
    expect(resolved.planId).toBe("pro");
    expect(resolved.source).toBe("grant");
    expect(resolved.entitlements).toEqual(PLANS.pro.entitlements);
  });

  it("caps a granted plan at the trial ceiling", () => {
    // §1 decision 10 — a grant is not a payment. Two colluding accounts should
    // draw trial-sized inference, not Pro-sized inference.
    const resolved = entitlementsFor({ grants: [grant()] }, NOW);
    expect(resolved.spendCapCents).toBe(PLANS.trial.spendCapCents);
    expect(resolved.spendCapCents).toBeLessThan(PLANS.pro.spendCapCents);
  });

  it("does not raise a cheaper granted plan to the trial ceiling", () => {
    const resolved = entitlementsFor(
      { grants: [grant({ planId: "free" })] },
      NOW,
    );
    expect(resolved.spendCapCents).toBe(PLANS.free.spendCapCents);
  });

  it("ignores a revoked grant and falls through", () => {
    const resolved = entitlementsFor(
      { plan: "free", grants: [grant({ revokedAt: days(-1) })] },
      NOW,
    );
    expect(resolved.planId).toBe("free");
    expect(resolved.source).toBe("plan");
  });

  it("carries the spend cap of whatever plan it resolved", () => {
    expect(entitlementsFor({ plan: "pro" }, NOW).spendCapCents).toBe(
      PLANS.pro.spendCapCents,
    );
    expect(
      entitlementsFor({ subscription: sub({ planId: "trial" }) }, NOW)
        .spendCapCents,
    ).toBe(PLANS.trial.spendCapCents);
  });

  it("defaults `now` to the present", () => {
    // The default parameter is a branch like any other.
    const live = grant({
      startsAt: new Date(Date.now() - 1_000),
      endsAt: new Date(Date.now() + 60_000),
    });
    expect(entitlementsFor({ grants: [live] }).source).toBe("grant");
  });
});
