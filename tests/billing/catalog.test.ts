import { describe, expect, it } from "vitest";
import {
  degradesGeneration,
  EVALUATION_COST_CENTS,
  isPlanId,
  LISTED_PLAN_IDS,
  PLAN_IDS,
  PLANS,
  planFor,
  resolvePlanId,
  SPEND_CAP_CENTS,
} from "@/lib/billing/catalog";

/**
 * The plan catalog.
 *
 * Two kinds of test here. The first kind guards the numbers §20.1 and §14.9.7
 * already fixed, so that a later edit to a "new" tier cannot quietly move a
 * documented one. The second kind guards the direction of failure: an
 * unrecognised plan has to land on `free`, because the alternative is handing
 * out premium models to a typo.
 */

describe("PLANS", () => {
  it("defines every id in PLAN_IDS, keyed by its own id", () => {
    for (const id of PLAN_IDS) expect(PLANS[id].id).toBe(id);
  });

  it("keeps §20.1's and §14.9.7's numbers for free and pro", () => {
    // These two rows predate the four-tier decision and must survive it.
    expect(PLANS.free.entitlements.evaluationsPerMonth).toBe(1);
    expect(PLANS.free.spendCapCents).toBe(100);
    expect(PLANS.pro.entitlements.evaluationsPerMonth).toBe(10);
    expect(PLANS.pro.spendCapCents).toBe(1_500);
  });

  it.each(PLAN_IDS)("lets %s afford the evaluations it advertises", (id) => {
    // The invariant that makes a quota honest. If the cap cannot pay for the
    // advertised evaluations at §20.2's measured $0.45, the learner hits the
    // cap first and the number on the pricing page is unreachable.
    const plan = PLANS[id];
    const advertised =
      plan.entitlements.evaluationsPerMonth * EVALUATION_COST_CENTS;
    expect(plan.spendCapCents).toBeGreaterThanOrEqual(advertised);
  });

  it("gives the trial a four-day quota rather than Pro's monthly one", () => {
    // Pro's ten-a-month inside a four-day window would let the trial cost more
    // than the first paid month it exists to sell.
    expect(PLANS.trial.entitlements.evaluationsPerMonth).toBeLessThan(
      PLANS.pro.entitlements.evaluationsPerMonth,
    );
  });

  it("gives learner a smaller quota than pro but the same unlimited sessions", () => {
    expect(PLANS.learner.entitlements.evaluationsPerMonth).toBeLessThan(
      PLANS.pro.entitlements.evaluationsPerMonth,
    );
  });

  it("reserves premium models for the plans that are paid for at full rate", () => {
    expect(PLANS.free.entitlements.premiumModels).toBe(false);
    expect(PLANS.learner.entitlements.premiumModels).toBe(false);
    expect(PLANS.trial.entitlements.premiumModels).toBe(true);
    expect(PLANS.pro.entitlements.premiumModels).toBe(true);
  });

  it("orders the spend caps the way the prices are ordered", () => {
    expect(PLANS.free.spendCapCents).toBeLessThan(PLANS.trial.spendCapCents);
    expect(PLANS.trial.spendCapCents).toBeLessThan(
      PLANS.learner.spendCapCents,
    );
    expect(PLANS.learner.spendCapCents).toBeLessThan(PLANS.pro.spendCapCents);
  });
});

describe("degradesGeneration", () => {
  it("drops the deep tier for the plans without premium models", () => {
    expect(degradesGeneration("free")).toBe(true);
    expect(degradesGeneration("learner")).toBe(true);
  });

  it("leaves it alone for the plans that pay for it", () => {
    expect(degradesGeneration("trial")).toBe(false);
    expect(degradesGeneration("pro")).toBe(false);
  });

  it("agrees with the catalog rather than restating it", () => {
    for (const id of PLAN_IDS) {
      expect(degradesGeneration(id)).toBe(!PLANS[id].entitlements.premiumModels);
    }
  });
});

describe("LISTED_PLAN_IDS", () => {
  it("lists all four, cheapest first and ending on pro", () => {
    expect(LISTED_PLAN_IDS).toEqual(["free", "trial", "learner", "pro"]);
  });

  it("contains only plans marked listed", () => {
    for (const id of LISTED_PLAN_IDS) expect(PLANS[id].listed).toBe(true);
  });
});

describe("isPlanId", () => {
  it.each(PLAN_IDS)("accepts %s", (id) => {
    expect(isPlanId(id)).toBe(true);
  });

  it.each([["enterprise"], [""], ["Pro"]])("rejects %s", (value) => {
    expect(isPlanId(value)).toBe(false);
  });

  it.each([[null], [undefined], [7], [{}]])("rejects %s", (value) => {
    expect(isPlanId(value)).toBe(false);
  });
});

describe("resolvePlanId", () => {
  it("passes a known plan through", () => {
    expect(resolvePlanId("learner")).toBe("learner");
  });

  it.each([[null], [undefined], ["nonsense"], [42]])(
    "falls back to free for %s",
    (value) => {
      // The safe direction: under-serving someone produces a complaint,
      // over-serving them produces a bill.
      expect(resolvePlanId(value)).toBe("free");
    },
  );
});

describe("planFor", () => {
  it("returns the definition for a known plan", () => {
    expect(planFor("pro")).toBe(PLANS.pro);
  });

  it("returns free's definition for anything else", () => {
    expect(planFor("nonsense")).toBe(PLANS.free);
  });
});

describe("SPEND_CAP_CENTS", () => {
  it("mirrors the catalog rather than restating it", () => {
    for (const id of PLAN_IDS) {
      expect(SPEND_CAP_CENTS[id]).toBe(PLANS[id].spendCapCents);
    }
  });
});
