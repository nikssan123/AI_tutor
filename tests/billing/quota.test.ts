import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { spendLedger, user } from "@/db/schema";
import {
  consumeEvaluation,
  evaluationsRemaining,
  evaluationsUsed,
} from "@/lib/billing/quota";
import { periodOf } from "@/lib/ai/runlog";

/**
 * The evaluation meter, against a real database.
 *
 * The test this file exists for is the concurrent one. A read-then-write meter
 * passes every sequential test ever written and still hands out two evaluations
 * against a limit of one the first time two submissions land together — which,
 * for a learner clicking a slow button twice, is not a rare event.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 4);
  afterAll(() => close());

  const LEARNER = "billing-quota-learner";
  const NOW = new Date("2026-08-15T12:00:00.000Z");
  const NEXT_MONTH = new Date("2026-09-01T00:00:00.000Z");

  beforeEach(async () => {
    await db.delete(user).where(inArray(user.id, [LEARNER]));
    await db
      .insert(user)
      .values({ id: LEARNER, name: "Ana", email: "ana@billing-quota.local" });
  });

  describe("evaluationsUsed", () => {
    it("is zero before anything is claimed", async () => {
      expect(await evaluationsUsed(db, LEARNER, NOW)).toBe(0);
    });
  });

  describe("consumeEvaluation", () => {
    it("claims the first one and reports the count", async () => {
      expect(await consumeEvaluation(db, LEARNER, 3, NOW)).toEqual({
        ok: true,
        used: 1,
        limit: 3,
      });
    });

    it("counts up to the limit and then refuses", async () => {
      for (let i = 1; i <= 3; i++) {
        expect(await consumeEvaluation(db, LEARNER, 3, NOW)).toEqual({
          ok: true,
          used: i,
          limit: 3,
        });
      }

      const blocked = await consumeEvaluation(db, LEARNER, 3, NOW);
      expect(blocked).toEqual({ ok: false, used: 3, limit: 3 });
    });

    it("refuses a limit of zero without writing a row", async () => {
      // The `where` guards only the `do update` branch. Without the early
      // return the insert branch writes the first row and hands out an
      // evaluation the plan does not include.
      expect(await consumeEvaluation(db, LEARNER, 0, NOW)).toEqual({
        ok: false,
        used: 0,
        limit: 0,
      });

      const rows = await db
        .select({ used: spendLedger.evaluationsUsed })
        .from(spendLedger)
        .where(eq(spendLedger.userId, LEARNER));
      expect(rows).toHaveLength(0);
    });

    it("lets exactly one of two concurrent claims through at a limit of one", async () => {
      // The whole reason the increment carries its own predicate.
      const [a, b] = await Promise.all([
        consumeEvaluation(db, LEARNER, 1, NOW),
        consumeEvaluation(db, LEARNER, 1, NOW),
      ]);

      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(await evaluationsUsed(db, LEARNER, NOW)).toBe(1);
    });

    it("lets exactly three of six concurrent claims through at a limit of three", async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, () => consumeEvaluation(db, LEARNER, 3, NOW)),
      );

      expect(outcomes.filter((o) => o.ok)).toHaveLength(3);
      expect(await evaluationsUsed(db, LEARNER, NOW)).toBe(3);
    });

    it("starts again in a new month", async () => {
      // The ledger is keyed by calendar month, so a period rollover is a new
      // row rather than a reset.
      await consumeEvaluation(db, LEARNER, 1, NOW);
      expect((await consumeEvaluation(db, LEARNER, 1, NOW)).ok).toBe(false);

      expect((await consumeEvaluation(db, LEARNER, 1, NEXT_MONTH)).ok).toBe(
        true,
      );
      expect(await evaluationsUsed(db, LEARNER, NEXT_MONTH)).toBe(1);
      // August is untouched.
      expect(await evaluationsUsed(db, LEARNER, NOW)).toBe(1);
    });

    it("shares the row the spend cap already writes", async () => {
      // One row per learner per month, by definition — which is what makes the
      // meter an upsert rather than a read, a decision and a write.
      await consumeEvaluation(db, LEARNER, 5, NOW);
      const rows = await db
        .select({ period: spendLedger.period })
        .from(spendLedger)
        .where(eq(spendLedger.userId, LEARNER));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.period).toBe(periodOf(NOW));
    });

    it("defaults `now` to the present", async () => {
      const outcome = await consumeEvaluation(db, LEARNER, 2);
      expect(outcome.ok).toBe(true);
      expect(await evaluationsUsed(db, LEARNER)).toBe(1);
    });
  });

  describe("evaluationsRemaining", () => {
    it("counts down", async () => {
      expect(await evaluationsRemaining(db, LEARNER, 3, NOW)).toBe(3);
      await consumeEvaluation(db, LEARNER, 3, NOW);
      expect(await evaluationsRemaining(db, LEARNER, 3, NOW)).toBe(2);
    });

    it("never goes negative after a downgrade", async () => {
      // Pro's ten, spent, then a move to Learner's three. "-7 left" is not a
      // sentence worth rendering.
      for (let i = 0; i < 5; i++) await consumeEvaluation(db, LEARNER, 10, NOW);
      expect(await evaluationsRemaining(db, LEARNER, 3, NOW)).toBe(0);
    });
  });
});
