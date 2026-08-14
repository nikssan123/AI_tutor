import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { planGrant, referral, referralCode, user } from "@/db/schema";
import { PLANS } from "@/lib/billing/catalog";
import { entitlementsForUser, revokeGrantsForReferral } from "@/lib/billing/store";
import {
  attribute,
  codeFor,
  endsAfter,
  referrerFor,
  REWARD_DAYS,
  rewardReferral,
  summaryFor,
} from "@/lib/referral/store";

/**
 * The referral loop, against a real database.
 *
 * The three claims worth checking here are database claims: that "one referral
 * per person" survives two concurrent signups, that no grant exists for the
 * referrer before money has actually arrived, and that a refund puts both
 * parties back exactly where they were.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 4);
  afterAll(() => close());

  const ANA = "ref-store-ana";
  const BO = "ref-store-bo";
  const CY = "ref-store-cy";
  const IDS = [ANA, BO, CY];

  const NOW = new Date("2026-08-15T12:00:00.000Z");
  const PEPPER = "test-pepper";

  const planOf = async (id: string) => {
    const [row] = await db
      .select({ plan: user.plan })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);
    return row!.plan;
  };

  beforeEach(async () => {
    await db.delete(user).where(inArray(user.id, IDS));
    await db.insert(user).values([
      {
        id: ANA,
        name: "Ana Ivanova",
        email: "ana@ref-store.local",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      { id: BO, name: "Bo Petrov", email: "bo@ref-store.local" },
      { id: CY, name: "Cy Dimitrov", email: "cy@ref-store.local" },
    ]);
  });

  describe("codeFor", () => {
    it("makes one on first use and keeps it after", async () => {
      const first = await codeFor(db, ANA);
      expect(first).toHaveLength(8);
      expect(await codeFor(db, ANA)).toBe(first);
    });

    it("gives different accounts different codes", async () => {
      expect(await codeFor(db, ANA)).not.toBe(await codeFor(db, BO));
    });

    it("hands both of two concurrent requests the same code", async () => {
      // One insert wins; the other conflicts on `referral_code_user_idx` and
      // has to look again rather than generate a second code for one account.
      const [a, b] = await Promise.all([codeFor(db, CY), codeFor(db, CY)]);
      expect(a).toBe(b);

      const rows = await db
        .select({ id: referralCode.id })
        .from(referralCode)
        .where(eq(referralCode.userId, CY));
      expect(rows).toHaveLength(1);
    });

    it("generates another when the code is already somebody else's", async () => {
      // The one conflict SQL cannot resolve for us.
      const taken = await codeFor(db, ANA);
      const queue = [taken, "zzzzzzzz"];

      const code = await codeFor(db, CY, 3, () => queue.shift()!);
      expect(code).toBe("zzzzzzzz");
    });

    it("gives up rather than spinning forever", async () => {
      // Insurance against a broken random source — a `getRandomValues`
      // returning constants would otherwise loop until the process died.
      const taken = await codeFor(db, ANA);
      await expect(codeFor(db, CY, 2, () => taken)).rejects.toThrow(
        /Could not allocate/,
      );
    });
  });

  describe("referrerFor", () => {
    it("finds the owner of a code, however it was pasted", async () => {
      const code = await codeFor(db, ANA);

      expect((await referrerFor(db, code))?.userId).toBe(ANA);
      expect((await referrerFor(db, `/r/${code}`))?.userId).toBe(ANA);
      expect((await referrerFor(db, ` ${code.toUpperCase()} `))?.userId).toBe(
        ANA,
      );
    });

    it("finds nobody for a code that was never issued", async () => {
      expect(await referrerFor(db, "zzzzzzzz")).toBeUndefined();
    });
  });

  describe("attribute", () => {
    const invite = async (over: Record<string, unknown> = {}) => {
      const code = await codeFor(db, ANA);
      return attribute(db, {
        code,
        referee: { userId: BO, email: "bo@ref-store.local" },
        pepper: PEPPER,
        now: NOW,
        ...over,
      });
    };

    it("records the referral and gives the referee their days at once", async () => {
      // §9.3 cuts one way: the referee is rewarded now, the referrer is not.
      const result = await invite();
      expect(result.status).toBe("recorded");

      expect(await planOf(BO)).toBe("pro");
      const resolved = await entitlementsForUser(db, BO, "free", NOW);
      expect(resolved.source).toBe("grant");
      // A grant is not a payment — trial cap, not Pro's.
      expect(resolved.spendCapCents).toBe(PLANS.trial.spendCapCents);
    });

    it("gives the referrer nothing yet", async () => {
      await invite();
      expect(await planOf(ANA)).toBe("free");

      const grants = await db
        .select({ id: planGrant.id })
        .from(planGrant)
        .where(eq(planGrant.userId, ANA));
      expect(grants).toHaveLength(0);
    });

    it("ends the referee's days after the reward window", async () => {
      await invite();
      const [grant] = await db
        .select({ endsAt: planGrant.endsAt })
        .from(planGrant)
        .where(eq(planGrant.userId, BO));
      expect(grant!.endsAt).toEqual(endsAfter(REWARD_DAYS, NOW));
    });

    it("defaults its clock to the present", async () => {
      const code = await codeFor(db, ANA);
      const result = await attribute(db, {
        code,
        referee: { userId: BO, email: "bo@ref-store.local" },
        pepper: PEPPER,
      });
      expect(result.status).toBe("recorded");
    });

    it("ignores a code nobody owns", async () => {
      const result = await attribute(db, {
        code: "zzzzzzzz",
        referee: { userId: BO, email: "bo@ref-store.local" },
        pepper: PEPPER,
        now: NOW,
      });
      expect(result).toEqual({ status: "ignored", why: "unknown_code" });
    });

    it("records a self-referral as rejected rather than dropping it", async () => {
      // "How many were refused, and why" is the number that says whether the
      // scheme is being farmed.
      const code = await codeFor(db, ANA);
      const result = await attribute(db, {
        code,
        referee: { userId: ANA, email: "ana@ref-store.local" },
        pepper: PEPPER,
        now: NOW,
      });

      expect(result).toEqual({ status: "rejected", reason: "self_referral" });
      const [row] = await db
        .select({ status: referral.status, reason: referral.rejectedReason })
        .from(referral)
        .where(eq(referral.refereeId, ANA));
      expect(row).toEqual({ status: "rejected", reason: "self_referral" });
      // And no days were handed out.
      expect(await planOf(ANA)).toBe("free");
    });

    it("lets exactly one of two concurrent invitations land", async () => {
      // The unique index on referee_id is the rule; a check in code could be
      // raced by somebody opening two invite links.
      const code = await codeFor(db, ANA);
      const codeTwo = await codeFor(db, CY);

      const [a, b] = await Promise.all([
        attribute(db, {
          code,
          referee: { userId: BO, email: "bo@ref-store.local" },
          pepper: PEPPER,
          now: NOW,
        }),
        attribute(db, {
          code: codeTwo,
          referee: { userId: BO, email: "bo@ref-store.local" },
          pepper: PEPPER,
          now: NOW,
        }),
      ]);

      const outcomes = [a.status, b.status].sort();
      expect(outcomes).toEqual(["ignored", "recorded"]);

      const rows = await db
        .select({ id: referral.id })
        .from(referral)
        .where(eq(referral.refereeId, BO));
      expect(rows).toHaveLength(1);
    });

    it("stores the signup signals hashed", async () => {
      await invite({ ip: "203.0.113.9", userAgent: "Mozilla/5.0" });

      const [row] = await db
        .select({
          ip: referral.signupIpHash,
          ua: referral.signupUaHash,
        })
        .from(referral)
        .where(eq(referral.refereeId, BO));

      expect(row!.ip).not.toBeNull();
      expect(row!.ip).not.toContain("203.0.113.9");
      expect(row!.ua).not.toContain("Mozilla");
    });
  });

  describe("rewardReferral", () => {
    const setup = async () => {
      const code = await codeFor(db, ANA);
      await attribute(db, {
        code,
        referee: { userId: BO, email: "bo@ref-store.local" },
        pepper: PEPPER,
        now: NOW,
      });
    };

    it("refuses before the payment has been recorded", async () => {
      await setup();
      expect(await rewardReferral(db, BO, NOW)).toEqual({ rewarded: false });
      expect(await planOf(ANA)).toBe("free");
    });

    it("pays the referrer once the referral is qualified", async () => {
      await setup();
      await db
        .update(referral)
        .set({ status: "qualified", firstPaymentAt: NOW })
        .where(eq(referral.refereeId, BO));

      const outcome = await rewardReferral(db, BO, NOW);
      expect(outcome.rewarded).toBe(true);
      expect(outcome.referrerId).toBe(ANA);
      expect(await planOf(ANA)).toBe("pro");
    });

    it("does not pay twice", async () => {
      await setup();
      await db
        .update(referral)
        .set({ status: "qualified", firstPaymentAt: NOW })
        .where(eq(referral.refereeId, BO));

      expect((await rewardReferral(db, BO, NOW)).rewarded).toBe(true);
      expect((await rewardReferral(db, BO, NOW)).rewarded).toBe(false);

      const grants = await db
        .select({ id: planGrant.id })
        .from(planGrant)
        .where(eq(planGrant.userId, ANA));
      expect(grants).toHaveLength(1);
    });

    it("refuses for somebody nobody referred", async () => {
      expect(await rewardReferral(db, CY, NOW)).toEqual({ rewarded: false });
    });

    it("refuses a row marked qualified with no payment recorded", async () => {
      // Belt and braces on §9.3's "reward before payment": the status alone is
      // not the authority, the timestamp is.
      await setup();
      await db
        .update(referral)
        .set({ status: "qualified", firstPaymentAt: null })
        .where(eq(referral.refereeId, BO));

      expect(await rewardReferral(db, BO, NOW)).toEqual({ rewarded: false });
      expect(await planOf(ANA)).toBe("free");
    });

    it("refuses a row that was already paid out", async () => {
      await setup();
      await db
        .update(referral)
        .set({ status: "qualified", firstPaymentAt: NOW, rewardedAt: NOW })
        .where(eq(referral.refereeId, BO));

      expect(await rewardReferral(db, BO, NOW)).toEqual({ rewarded: false });
    });

    it("defaults its clock to the present", async () => {
      await setup();
      await db
        .update(referral)
        .set({ status: "qualified", firstPaymentAt: NOW })
        .where(eq(referral.refereeId, BO));

      expect((await rewardReferral(db, BO)).rewarded).toBe(true);
    });

    it("refuses a referral that was rejected at signup", async () => {
      const code = await codeFor(db, ANA);
      await attribute(db, {
        code,
        referee: { userId: ANA, email: "ana@ref-store.local" },
        pepper: PEPPER,
        now: NOW,
      });
      expect(await rewardReferral(db, ANA, NOW)).toEqual({ rewarded: false });
    });

    it("gives both sides back on a refund", async () => {
      await setup();
      await db
        .update(referral)
        .set({ status: "qualified", firstPaymentAt: NOW })
        .where(eq(referral.refereeId, BO));
      await rewardReferral(db, BO, NOW);

      expect(await planOf(ANA)).toBe("pro");
      expect(await planOf(BO)).toBe("pro");

      const [row] = await db
        .select({ id: referral.id })
        .from(referral)
        .where(eq(referral.refereeId, BO));
      await revokeGrantsForReferral(db, row!.id, NOW);

      expect(await planOf(ANA)).toBe("free");
      expect(await planOf(BO)).toBe("free");
    });
  });

  describe("summaryFor", () => {
    it("counts nothing for somebody who has invited nobody", async () => {
      expect(await summaryFor(db, ANA)).toEqual({
        invited: 0,
        paying: 0,
        rewardedDays: 0,
        recent: [],
      });
    });

    it("counts signups, subscribers and days earned", async () => {
      const code = await codeFor(db, ANA);
      for (const [id, email] of [
        [BO, "bo@ref-store.local"],
        [CY, "cy@ref-store.local"],
      ] as const) {
        await attribute(db, {
          code,
          referee: { userId: id, email },
          pepper: PEPPER,
          now: NOW,
        });
      }

      await db
        .update(referral)
        .set({ status: "qualified", firstPaymentAt: NOW })
        .where(eq(referral.refereeId, BO));
      await rewardReferral(db, BO, NOW);

      const summary = await summaryFor(db, ANA);
      expect(summary.invited).toBe(2);
      expect(summary.paying).toBe(1);
      expect(summary.rewardedDays).toBe(REWARD_DAYS);
    });

    it("shows first names only, never addresses", async () => {
      // A share page is not a contact export.
      const code = await codeFor(db, ANA);
      await attribute(db, {
        code,
        referee: { userId: BO, email: "bo@ref-store.local" },
        pepper: PEPPER,
        now: NOW,
      });

      const summary = await summaryFor(db, ANA);
      expect(summary.recent[0]!.name).toBe("Bo");
      expect(JSON.stringify(summary)).not.toContain("@ref-store.local");
    });

    it("hides a rejected referral from the encouraging page", async () => {
      const code = await codeFor(db, ANA);
      await attribute(db, {
        code,
        referee: { userId: ANA, email: "ana@ref-store.local" },
        pepper: PEPPER,
        now: NOW,
      });
      expect((await summaryFor(db, ANA)).invited).toBe(0);
    });
  });
});
