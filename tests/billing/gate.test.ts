import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { agentRun, spendLedger, subscription, user } from "@/db/schema";
import { PLANS } from "@/lib/billing/catalog";
import { aiAccess, nudgeAt, overCapMessage } from "@/lib/billing/gate";

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
});
