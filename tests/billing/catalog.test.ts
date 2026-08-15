import { describe, expect, it } from "vitest";
import {
  degradesGeneration,
  EVALUATION_COST_CENTS,
  PACK_BUILD_COST_CENTS,
  subsidisesPackBuilds,
  isPlanId,
  ONBOARDING_COST_CENTS,
  promisedCostCents,
  SESSION_COST_CENTS,
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

  it("keeps §20.1's and §14.9.7's evaluation numbers for free and pro", () => {
    // The quotas predate the four-tier decision and must survive it.
    expect(PLANS.free.entitlements.evaluationsPerMonth).toBe(1);
    expect(PLANS.pro.entitlements.evaluationsPerMonth).toBe(10);
    expect(PLANS.pro.spendCapCents).toBe(1_500);
  });

  it("gives free a ceiling that can actually pay for free", () => {
    // 100¢ could not: §20.1's free row is 71¢ of onboarding plus 221¢ of
    // sessions plus a 45¢ evaluation. The two numbers were written in
    // different sections and never reconciled.
    expect(PLANS.free.spendCapCents).toBe(120);
    expect(promisedCostCents("free")).toBeLessThanOrEqual(120);
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

  it.each(PLAN_IDS)("lets %s afford everything it advertises, not just marking", (id) => {
    // The wider version, and the one that would have caught §20.1's free tier
    // before it shipped: sessions and onboarding cost money too.
    const promised = promisedCostCents(id);
    if (promised === null) return; // unlimited sessions — the cap is the limit
    expect(PLANS[id].spendCapCents).toBeGreaterThanOrEqual(promised);
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

describe("the free tier's shape", () => {
  it("gives free a session allowance and everyone else the cap", () => {
    // One, matching the one lesson. Two sessions where only the first can carry
    // a new lesson would advertise a second session that has nothing new in it.
    expect(PLANS.free.entitlements.sessionsPerMonth).toBe(1);
    for (const id of ["trial", "learner", "pro"] as const) {
      expect(PLANS[id].entitlements.sessionsPerMonth).toBeNull();
    }
  });

  it("gives free half the tutor turns, which is what §20.2 actually priced", () => {
    // "Learning session (content + ~15 tutor turns) | $0.17". Permitting thirty
    // on free meant the free budget quoted a figure that assumed half the
    // conversation.
    expect(PLANS.free.entitlements.tutorTurnsPerSession).toBe(15);
    for (const id of ["trial", "learner", "pro"] as const) {
      expect(PLANS[id].entitlements.tutorTurnsPerSession).toBe(30);
    }
  });

  it("keeps the generated curriculum off free, and gives it one pack ever", () => {
    /*
     * The two most expensive discretionary things a click can start, treated
     * differently on purpose. A curriculum is 55¢ *per learner* and there is a
     * free alternative that is genuinely good — `canonicalCurriculum` is
     * arithmetic over the same graph — so free does without it. A pack is ~78¢
     * *per subject*, shared by everyone who ever takes it, and doing without it
     * meant free was "the seven subjects we happen to have".
     */
    expect(PLANS.free.entitlements.aiCurriculum).toBe(false);
    expect(PLANS.free.entitlements.packBuildsLifetime).toBe(1);
  });

  it("gives free exactly one lesson per course, and paid plans no limit", () => {
    expect(PLANS.free.entitlements.lessonsPerCourse).toBe(1);
    for (const id of ["trial", "learner", "pro"] as const) {
      expect(PLANS[id].entitlements.lessonsPerCourse).toBeNull();
    }
  });

  it("gives every paid plan the curriculum and no lifetime build quota", () => {
    for (const id of ["trial", "learner", "pro"] as const) {
      expect(PLANS[id].entitlements.aiCurriculum).toBe(true);
      expect(PLANS[id].entitlements.packBuildsLifetime).toBeNull();
    }
  });

  it("subsidises builds exactly where there is a lifetime quota", () => {
    /*
     * The two travel together by construction, and this is the assertion that
     * keeps them together. A plan with a hard quota does not also pay per build
     * — its cap has no room for one — and a plan without a quota pays for its
     * own out of the cap that bounds everything else it does. A row where they
     * disagreed would be either an unbounded free tier or a paid learner
     * charged for an asset they do not own.
     */
    for (const id of PLAN_IDS) {
      expect(subsidisesPackBuilds(id)).toBe(
        PLANS[id].entitlements.packBuildsLifetime !== null,
      );
    }
    expect(subsidisesPackBuilds("free")).toBe(true);
    expect(subsidisesPackBuilds("pro")).toBe(false);
  });

  it("cannot let free pay for the build it is allowed to commission", () => {
    // The reason the catalogue absorbs it rather than the learner. What is left
    // of a free month after its own promises does not cover a single pack, so
    // charging it would mean the first person to ask for a subject gets a
    // visibly worse free tier than everyone who takes it afterwards.
    const spare = PLANS.free.spendCapCents - promisedCostCents("free")!;
    expect(spare).toBeLessThan(PACK_BUILD_COST_CENTS);
  });
});

describe("promisedCostCents", () => {
  it("adds sessions, marking and onboarding at §20.2's measured prices", () => {
    expect(promisedCostCents("free")).toBe(
      1 * SESSION_COST_CENTS + 1 * EVALUATION_COST_CENTS + ONBOARDING_COST_CENTS,
    );
  });

  it("is unanswerable for a plan with unlimited sessions", () => {
    // Not zero, and not a guess: there is no budget to compute, and the cap is
    // the limit. Returning a number here would invent one.
    expect(promisedCostCents("pro")).toBeNull();
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
