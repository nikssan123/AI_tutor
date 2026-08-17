import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import {
  agentRun,
  learningGoal,
  learningSession,
  spendLedger,
  subscription,
  user,
} from "@/db/schema";
import { PLANS } from "@/lib/billing/catalog";
import {
  aiAccess,
  assistantAllowance,
  nudgeAt,
  overCapMessage,
  sessionsLocked,
  SESSIONS_RESERVED,
} from "@/lib/billing/gate";

/**
 * §14.9.7 limit 1, for the six call sites that never checked it.
 *
 * The behaviour under test is the half the original ladder did not cover: what
 * to do when the call being gated is *already* on the cheapest model. "Degrade
 * Opus → Sonnet" is written for the deep tier, and the tutor, the lesson
 * generator and the goal interview all run on Sonnet already — so degrading
 * them changes nothing, saves nothing, and is how the cap came to bind on
 * precisely nothing a free learner does.
 */

describe("overCapMessage", () => {
  it("offers free a way out", () => {
    expect(overCapMessage("free")).toMatch(/Pro carries on now/);
  });

  it("does not offer a paid plan more of what it already bought", () => {
    expect(overCapMessage("pro")).not.toMatch(/Pro/);
  });

  it("never mentions cents, tokens or spend", () => {
    // §6 of the brief — do not expose token economics. This would be the only
    // place in the product that did.
    for (const id of ["free", "trial", "learner", "pro"] as const) {
      expect(overCapMessage(id)).not.toMatch(/cent|token|\$|¢|spend/i);
    }
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  const LEARNER = "billing-gate-learner";
  const NOW = new Date("2026-08-15T12:00:00.000Z");

  const spend = async (cents: number) => {
    await db.insert(spendLedger).values({
      userId: LEARNER,
      period: "2026-08",
      costCents: cents,
      updatedAt: NOW,
    });
  };

  beforeEach(async () => {
    await db.delete(agentRun).where(inArray(agentRun.userId, [LEARNER]));
    await db.delete(user).where(inArray(user.id, [LEARNER]));
    await db
      .insert(user)
      .values({ id: LEARNER, name: "Ana", email: "ana@billing-gate.local" });
  });

  describe("under the cap", () => {
    it("allows a standard call and does not degrade a premium plan", async () => {
      await spend(10);
      expect(await aiAccess(db, LEARNER, "pro", "standard", NOW)).toMatchObject({
        overCap: false,
        degraded: false,
        blocked: false,
      });
    });

    it("still degrades a plan that never bought the deep tier", async () => {
      // Entitlement, not budget — a Learner is on standard models however
      // little they have spent.
      await spend(10);
      expect(await aiAccess(db, LEARNER, "learner", "deep", NOW)).toMatchObject({
        overCap: false,
        degraded: true,
        blocked: false,
      });
    });

    it("reports the numbers the caller needs to explain itself", async () => {
      await spend(42);
      const access = await aiAccess(db, LEARNER, "free", "standard", NOW);
      expect(access.spentCents).toBe(42);
      expect(access.capCents).toBe(PLANS.free.spendCapCents);
    });
  });

  describe("over the cap", () => {
    it("degrades a deep call rather than refusing it", async () => {
      // There is somewhere cheaper to go, so service continues — which is what
      // §14.9.7 has always specified and what already shipped.
      await spend(PLANS.pro.spendCapCents);
      expect(await aiAccess(db, LEARNER, "pro", "deep", NOW)).toMatchObject({
        overCap: true,
        degraded: true,
        blocked: false,
      });
    });

    it("blocks a standard call, because there is nothing cheaper", async () => {
      // The change. Letting this through is what made the free ceiling
      // decorative: the tutor is already on Sonnet, so "degrading" it spends
      // exactly as much as not degrading it.
      await spend(PLANS.free.spendCapCents);
      expect(await aiAccess(db, LEARNER, "free", "standard", NOW)).toMatchObject({
        overCap: true,
        degraded: true,
        blocked: true,
      });
    });

    it("blocks at the cap, not one cent past it", async () => {
      await spend(PLANS.free.spendCapCents);
      expect(
        (await aiAccess(db, LEARNER, "free", "standard", NOW)).blocked,
      ).toBe(true);
    });

    it("lets the last cent through", async () => {
      await spend(PLANS.free.spendCapCents - 1);
      expect(
        (await aiAccess(db, LEARNER, "free", "standard", NOW)).blocked,
      ).toBe(false);
    });

    it("blocks a paying learner too — the ceiling is not a free-tier feature", async () => {
      await spend(PLANS.pro.spendCapCents);
      expect(
        (await aiAccess(db, LEARNER, "pro", "standard", NOW)).blocked,
      ).toBe(true);
    });
  });

  describe("periods", () => {
    it("does not carry last month's spend into this one", async () => {
      await db.insert(spendLedger).values({
        userId: LEARNER,
        period: "2026-07",
        costCents: 9_999,
        updatedAt: NOW,
      });

      expect(
        (await aiAccess(db, LEARNER, "free", "standard", NOW)).blocked,
      ).toBe(false);
    });

    it("treats an account that has spent nothing as under the cap", async () => {
      expect(await aiAccess(db, LEARNER, "free", "standard", NOW)).toMatchObject(
        { overCap: false, blocked: false, spentCents: 0 },
      );
    });

    it("defaults its clock to the present", async () => {
      expect((await aiAccess(db, LEARNER, "free", "standard")).blocked).toBe(
        false,
      );
    });
  });

  /**
   * The wall, asked for *before* the button rather than after it.
   *
   * `startSessionAction` has always refused past the month's allowance and sent
   * the learner back with `?error=sessions`. That made the only route to
   * finding out "press the product's biggest button and be bounced", so a free
   * account that never pressed twice was never told there was anything to buy —
   * and `/path` went on offering "Start today's session" either way.
   */
  describe("sessionsLocked", () => {
    const startSession = async (at: Date) => {
      const [goal] = await db
        .insert(learningGoal)
        .values({ userId: LEARNER, rawGoalText: "learn something" })
        .returning({ id: learningGoal.id });

      await db.insert(learningSession).values({
        userId: LEARNER,
        goalId: goal!.id,
        blocks: [],
        responses: [],
        startedAt: at,
      });
    };

    it("is open while the month still has one in it", async () => {
      expect(await sessionsLocked(db, LEARNER, "free", NOW)).toBe(false);
    });

    it("shuts once the month's allowance is gone", async () => {
      for (let i = 0; i < PLANS.free.entitlements.sessionsPerMonth!; i += 1) {
        await startSession(NOW);
      }

      expect(await sessionsLocked(db, LEARNER, "free", NOW)).toBe(true);
    });

    it("opens again on the 1st", async () => {
      await startSession(new Date("2026-07-20T12:00:00.000Z"));
      expect(await sessionsLocked(db, LEARNER, "free", NOW)).toBe(false);
    });

    it("never shuts on a plan with no session count", async () => {
      // `null` is "as many as the spend ceiling allows" — a different limit,
      // enforced somewhere else, and not a wall this draws.
      expect(PLANS.pro.entitlements.sessionsPerMonth).toBeNull();
      await startSession(NOW);
      await startSession(NOW);

      expect(await sessionsLocked(db, LEARNER, "pro", NOW)).toBe(false);
    });
  });

  describe("nudgeAt", () => {
    it("asks a free learner who has spent their marking", async () => {
      await db.insert(spendLedger).values({
        userId: LEARNER,
        period: "2026-08",
        costCents: 0,
        evaluationsUsed: PLANS.free.entitlements.evaluationsPerMonth,
        updatedAt: NOW,
      });

      const nudge = await nudgeAt(db, LEARNER, "free", "evaluation_landed", NOW);
      expect(nudge?.reason).toBe("evaluation_landed");
      expect(nudge?.href).toBe("/pricing");
    });

    it("stays silent while they still have marking left", async () => {
      expect(
        await nudgeAt(db, LEARNER, "free", "evaluation_landed", NOW),
      ).toBeUndefined();
    });

    it("stays silent for somebody already on the plan being sold", async () => {
      await db.insert(spendLedger).values({
        userId: LEARNER,
        period: "2026-08",
        costCents: 0,
        evaluationsUsed: PLANS.pro.entitlements.evaluationsPerMonth,
        updatedAt: NOW,
      });

      expect(
        await nudgeAt(db, LEARNER, "pro", "evaluation_landed", NOW),
      ).toBeUndefined();
    });

    it("defaults its clock to the present", async () => {
      // The default parameter is a branch like any other.
      expect(
        await nudgeAt(db, LEARNER, "free", "evaluation_landed"),
      ).toBeUndefined();
    });

    /**
     * Which ask a wall makes, which is a different question from whether it
     * makes one.
     *
     * Every nudge used to point a free learner at a monthly subscription. The
     * cheapest yes in the catalogue is four days for €3, and somebody who has
     * just been stopped is deciding whether this product works *on them* —
     * which is the question a trial answers and a subscription defers.
     */
    describe("the way in it offers", () => {
      const spendTheirMarking = () =>
        db.insert(spendLedger).values({
          userId: LEARNER,
          period: "2026-08",
          costCents: 0,
          evaluationsUsed: PLANS.free.entitlements.evaluationsPerMonth,
          updatedAt: NOW,
        });

      it("offers the four days to somebody who has never had them", async () => {
        await spendTheirMarking();

        const nudge = await nudgeAt(db, LEARNER, "free", "evaluation_landed", NOW);
        expect(nudge?.cta).toBe("Try everything for four days");
      });

      it("does not re-offer a trial this account has already taken", async () => {
        /*
         * `hasUsedTrial` asks the whole subscription history rather than the
         * current row, so a trial that was cancelled, refunded or simply ran
         * out still counts — all three mean this person has had their four
         * days, and `startCheckoutAction` would bounce them at the till. An
         * offer the next screen refuses is worse than no offer.
         */
        await spendTheirMarking();
        await db.insert(subscription).values({
          userId: LEARNER,
          stripeSubscriptionId: "sub_gate_trial",
          stripeCustomerId: "cus_gate",
          planId: "trial",
          interval: "month",
          currency: "eur",
          amountCents: 300,
          status: "canceled",
          currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        });

        const nudge = await nudgeAt(db, LEARNER, "free", "evaluation_landed", NOW);

        // Still asked — the wall is the same wall.
        expect(nudge).toBeDefined();
        expect(nudge!.cta).toBe("See what Pro includes");
      });
    });
  });

  /**
   * The reserve — `ASSISTANT-PLAN.md` §10.1.
   *
   * `aiAccess` answers "is there budget" first-come-first-served, which is
   * right for a session and wrong for the assistant: both spend from this same
   * ledger, so a chatty afternoon could take the budget the session needed.
   * These assert the ordering that fixes it — the support surface is refused
   * while the product still has work owed to it.
   */
  describe("assistantAllowance", () => {
    it("holds back what the month's sessions and evaluations will need", async () => {
      const allowance = await assistantAllowance(db, LEARNER, "free", NOW);

      // Free: one evaluation at 45¢ and one session at 17¢, of a 120¢ ceiling.
      expect(allowance.reserveCents).toBe(62);
      expect(allowance.allowanceCents).toBe(58);
      expect(allowance.blocked).toBe(false);
    });

    it("refuses the assistant while the cap itself still has room", async () => {
      await spend(60);

      // 60¢ of 120¢ — `aiAccess` would wave this through, and the learner's
      // session would then be the thing that could not run.
      expect(await aiAccess(db, LEARNER, "free", "standard", NOW)).toMatchObject({
        blocked: false,
      });
      expect(await assistantAllowance(db, LEARNER, "free", NOW)).toMatchObject({
        blocked: true,
      });
    });

    /**
     * The reserve shrinks as the month is actually used, which is the whole
     * reason it is computed rather than fixed: a learner who has taken their
     * sessions gets the rest of the budget for questions.
     */
    it("gives back the budget of work already done", async () => {
      // A ledger row has to exist before the month can record work against it.
      await spend(0);
      const before = await assistantAllowance(db, LEARNER, "free", NOW);

      await db
        .update(spendLedger)
        .set({ evaluationsUsed: 1 })
        .where(eq(spendLedger.userId, LEARNER));

      const after = await assistantAllowance(db, LEARNER, "free", NOW);
      expect(after.reserveCents).toBe(before.reserveCents - 45);
      expect(after.allowanceCents).toBeGreaterThan(before.allowanceCents);
    });

    /** A plan with no session count cannot reserve infinity. */
    it("reserves a realistic month for a plan with unlimited sessions", async () => {
      const allowance = await assistantAllowance(db, LEARNER, "pro", NOW);

      // 10 evaluations at 45¢, plus twelve reserved sessions at 17¢.
      expect(allowance.reserveCents).toBe(450 + SESSIONS_RESERVED * 17);
      expect(allowance.allowanceCents).toBe(
        PLANS.pro.spendCapCents - allowance.reserveCents,
      );
    });

    /** Nothing further is owed to somebody who has used more than the nominal
        allowance, and a negative reserve would raise the ceiling above the cap. */
    it("never reserves less than nothing", async () => {
      await spend(0);
      await db
        .update(spendLedger)
        .set({ evaluationsUsed: 99 })
        .where(eq(spendLedger.userId, LEARNER));

      const allowance = await assistantAllowance(db, LEARNER, "free", NOW);
      expect(allowance.reserveCents).toBeGreaterThanOrEqual(0);
      expect(allowance.allowanceCents).toBeLessThanOrEqual(
        PLANS.free.spendCapCents,
      );
    });
  });
});
