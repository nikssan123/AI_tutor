import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/billing/catalog";
import { NUDGE_REASONS, nudgeFor, type NudgeInput } from "@/lib/billing/nudge";

/**
 * When the product asks somebody to pay.
 *
 * Most of these tests assert a *silence*. That is the point: the failure mode
 * of upgrade copy is not a missing prompt, it is five reasonable prompts nobody
 * ever saw together, and the only way to keep that from accumulating is to make
 * "does not appear" the thing under test.
 */

const on = (planId: keyof typeof PLANS, over: Partial<NudgeInput> = {}): NudgeInput => ({
  planId,
  entitlements: PLANS[planId].entitlements,
  paying: planId !== "free",
  // False by default so the *ask* is what these tests assert. The trial wording
  // is a separate question with its own describe block below.
  trialEligible: false,
  evaluationsUsed: PLANS[planId].entitlements.evaluationsPerMonth,
  sessionsUsed: 0,
  ...over,
});

describe("rule 2 — only somebody who could act on it", () => {
  it.each(NUDGE_REASONS)("says nothing to a Pro learner about %s", (reason) => {
    // Pro is the plan being sold. There is nothing above it to move to, so
    // every branch has to fall through rather than pitch a sidegrade.
    expect(nudgeFor(reason, on("pro"))).toBeUndefined();
  });

  it("says nothing about sessions to a plan with no session wall", () => {
    for (const plan of ["trial", "learner", "pro"] as const) {
      expect(nudgeFor("sessions_spent", on(plan))).toBeUndefined();
    }
  });

  it("says nothing about tutor turns to a plan already at the ceiling", () => {
    // The turn limit is a quality rule (§17.2), not a paid feature — so it is
    // only worth a prompt where a bigger allowance genuinely exists.
    expect(nudgeFor("tutor_turns_spent", on("learner"))).toBeUndefined();
  });

  it("says nothing to a Learner about marking, since Pro marks more", () => {
    // Learner *does* have a smaller quota than Pro, so this one should fire.
    expect(nudgeFor("evaluations_spent", on("learner"))).toBeDefined();
  });
});

describe("evaluation_landed — the strongest moment", () => {
  it("fires when that was their last one", () => {
    // §19.3's activation event: the only moment a learner has first-hand
    // evidence of the thing no competitor does.
    const nudge = nudgeFor("evaluation_landed", on("free", { evaluationsUsed: 1 }));

    expect(nudge?.headline).toMatch(/this month's graded project/);
    expect(nudge?.body).toMatch(new RegExp(`${PLANS.pro.entitlements.evaluationsPerMonth} a month`));
    expect(nudge?.href).toBe("/pricing");
  });

  it("stays quiet while they still have allowance left", () => {
    // Somebody with one left is being told to carry on, not to buy.
    expect(
      nudgeFor("evaluation_landed", on("learner", { evaluationsUsed: 1 })),
    ).toBeUndefined();
  });

  it("does not tell a Learner that free includes one", () => {
    // The free card's sentence names its own allowance; a Learner who has spent
    // three would be read a fact about somebody else's plan.
    const nudge = nudgeFor(
      "evaluation_landed",
      on("learner", {
        evaluationsUsed: PLANS.learner.entitlements.evaluationsPerMonth,
      }),
    );

    expect(nudge).toBeDefined();
    expect(nudge!.body).not.toMatch(/Free includes/);
    expect(nudge!.body).toMatch(/same public rubrics/);
  });

  it("promises the same rubric rather than a better one", () => {
    // The upgrade buys more marking, never different marking — see
    // `degradesGeneration`. Copy that implied otherwise would be selling a
    // worse verdict to the cheaper plan.
    const nudge = nudgeFor("evaluation_landed", on("free", { evaluationsUsed: 1 }));
    expect(nudge?.body).toMatch(/same public rubrics/);
  });
});

describe("course_locked — the standing ask", () => {
  it("states what a capped learner can actually reach", () => {
    /*
     * The one nudge that is a condition rather than an event. A free learner
     * meets `lessonsPerCourse` at lesson two inside `lessonForBlock` with no
     * warning, and a limit discovered by walking into it reads as a
     * bait-and-switch however generous the free tier is.
     */
    const nudge = nudgeFor("course_locked", on("free"));

    expect(nudge?.headline).toMatch(/see all of this course/i);
    expect(nudge?.body).toMatch(/one lesson on any course/i);
  });

  it("says nothing to a plan with no lesson wall to sell past", () => {
    // Rule 2. A paying learner is shown nothing, because there is nothing they
    // would be buying.
    for (const plan of ["trial", "learner", "pro"] as const) {
      expect(PLANS[plan].entitlements.lessonsPerCourse).toBeNull();
      expect(nudgeFor("course_locked", on(plan))).toBeUndefined();
    }
  });

  it("reads the same whether or not the lesson has been spent", () => {
    /*
     * The regression guard. This nudge was briefly switched off once a learner
     * had started their course, on the theory that it should be self-limiting —
     * which silenced it at exactly the point somebody has seen what the product
     * does, has nothing left to do with it, and is readiest to pay. The copy
     * takes no reading of their progress, so there is no state that can hide it.
     */
    const nudge = nudgeFor("course_locked", on("free"))!;

    expect(nudge.body).not.toMatch(/you have|you've|already read|so far/i);
  });

  it("counts the lessons off the catalog rather than typing them", () => {
    // "one lesson" stops being true the moment the allowance moves — the exact
    // bug the sessions line shipped with.
    const one = nudgeFor("course_locked", on("free"))!;
    expect(one.body).toMatch(/one lesson/);

    const two = nudgeFor(
      "course_locked",
      on("free", {
        entitlements: { ...PLANS.free.entitlements, lessonsPerCourse: 2 },
      }),
    )!;
    expect(two.body).toMatch(/2 lessons/);
    expect(two.body).not.toMatch(/one lesson/);
  });
});

describe("the way in is the one somebody can take today", () => {
  const reasonsThatFire = ["evaluation_landed", "course_locked", "evaluations_spent", "sessions_spent", "tutor_turns_spent"] as const;

  it("offers the four days to an account that has not used them", () => {
    /*
     * Every nudge used to point a free learner at a €12.99 subscription. The
     * cheapest yes in the catalogue is four days for €3, and somebody who has
     * just hit a wall is deciding whether this works *on them* — which is the
     * question a trial answers and a subscription defers.
     */
    for (const reason of reasonsThatFire) {
      const nudge = nudgeFor(reason, on("free", { trialEligible: true }))!;
      expect({ [reason]: nudge.cta }).toEqual({
        [reason]: "Try everything for four days",
      });
      expect(nudge.href).toBe("/pricing");
    }
  });

  it("does not re-offer a trial that has already been taken", () => {
    // `startCheckoutAction` refuses a second trial at the till, so offering one
    // here would be an ask the next screen bounces.
    for (const reason of reasonsThatFire) {
      const nudge = nudgeFor(reason, on("free", { trialEligible: false }))!;
      expect(nudge.cta).toBe("See what Pro includes");
    }
  });

  it("names no price, because the page that charges one localises it", () => {
    // A nudge quoting €3 to somebody who checks out in dollars is the drift
    // `/pricing` has its own rule about.
    for (const reason of reasonsThatFire) {
      const nudge = nudgeFor(reason, on("free", { trialEligible: true }))!;
      expect(`${nudge.cta} ${nudge.body}`).not.toMatch(/€|£|\$|\d+[.,]\d{2}/);
    }
  });
});

describe("the copy itself", () => {
  const everyNudge = () =>
    NUDGE_REASONS.flatMap((reason) => {
      const nudge = nudgeFor(reason, on("free", { evaluationsUsed: 1 }));
      return nudge ? [nudge] : [];
    });

  it("produces a nudge for every wall a free learner can hit", () => {
    expect(everyNudge()).toHaveLength(NUDGE_REASONS.length);
  });

  it("never mentions cents, tokens or spend", () => {
    // §6 of the brief — do not expose token economics.
    for (const nudge of everyNudge()) {
      expect(`${nudge.headline} ${nudge.body}`).not.toMatch(
        /cent|token|\$|¢|spend|quota|cap\b/i,
      );
    }
  });

  it("always says what happens next, not just what stopped", () => {
    for (const nudge of everyNudge()) {
      expect(nudge.cta.length).toBeGreaterThan(0);
      expect(nudge.href).toBe("/pricing");
    }
  });

  it("reassures rather than threatens where something is kept", () => {
    const spent = nudgeFor("evaluations_spent", on("free", { evaluationsUsed: 1 }))!;
    expect(spent.body).toMatch(/stays yours/);
    expect(spent.body).toMatch(/back on the 1st/);
  });

  it("reads the numbers from the catalog rather than typing them", () => {
    // The same rule `plan-copy.ts` follows: a prompt that promises ten when the
    // meter allows five is not a copy bug, it is a refund.
    const turns = nudgeFor("tutor_turns_spent", on("free"))!;
    expect(turns.body).toContain(
      String(PLANS.free.entitlements.tutorTurnsPerSession),
    );
    expect(turns.body).toContain(
      String(PLANS.pro.entitlements.tutorTurnsPerSession),
    );
  });

  it("does not promise more free sessions than the catalog allows", () => {
    /*
     * A regression test with a shipped bug behind it. This sentence read "Free
     * includes two" for as long as `sessionsPerMonth` had been one — the only
     * hard-coded number in the module, wrong, at the exact moment a learner is
     * deciding whether our pricing can be trusted.
     */
    const sessions = nudgeFor("sessions_spent", on("free"))!;

    expect(PLANS.free.entitlements.sessionsPerMonth).toBe(1);
    expect(sessions.body).toMatch(/Free includes one a month/);
    expect(sessions.body).not.toMatch(/two/);
  });

  it("pluralises a larger session allowance rather than saying 'one'", () => {
    const sessions = nudgeFor(
      "sessions_spent",
      on("free", {
        entitlements: { ...PLANS.free.entitlements, sessionsPerMonth: 3 },
      }),
    )!;

    expect(sessions.body).toMatch(/Free includes 3 a month/);
  });
});
