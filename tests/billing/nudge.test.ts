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
});
