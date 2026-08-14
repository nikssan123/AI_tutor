import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { spendLedger } from "@/db/schema";
import { periodOf } from "@/lib/ai/runlog";

/**
 * The evaluation meter — §14.9.7 limit 2, "the product's meter (§20.1)".
 *
 * `spend_ledger.evaluations_used` has existed since `ops.ts` was written with
 * nothing incrementing it. This is what increments it.
 *
 * The column lives on the same row as the month's spend and shares its unique
 * `(user_id, period)` index, which is what makes the increment safe: one row per
 * learner per month, by definition, so the meter is an upsert rather than a
 * read, a decision and a write.
 */

export type QuotaWriter = Pick<Db, "insert" | "select">;

export interface QuotaOutcome {
  /** Whether the caller may go ahead. */
  ok: boolean;
  /** Evaluations used this period, after this call. */
  used: number;
  limit: number;
}

/** How many evaluations this account has spent in the current month. */
export async function evaluationsUsed(
  db: QuotaWriter,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ used: spendLedger.evaluationsUsed })
    .from(spendLedger)
    .where(
      and(
        eq(spendLedger.userId, userId),
        eq(spendLedger.period, periodOf(now)),
      ),
    )
    .limit(1);

  return row?.used ?? 0;
}

/**
 * Claim one evaluation against the month's quota.
 *
 * **Conditional and atomic.** The increment carries its own `where`, so two
 * submissions arriving together cannot both pass a limit of one — Postgres
 * applies the predicate to the row it is already holding a lock on. A read,
 * a comparison and a write would let them interleave, which is the same failure
 * the `spend_ledger` unique index docblock warns about for cost, in the one
 * direction §14.9.7 cannot tolerate being wrong in.
 *
 * A limit of zero is refused **before** the statement runs. The `where` guards
 * only the `do update` branch; the insert branch would happily write the first
 * row and hand out an evaluation the plan does not include.
 */
export async function consumeEvaluation(
  db: QuotaWriter,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<QuotaOutcome> {
  if (limit <= 0) {
    return { ok: false, used: await evaluationsUsed(db, userId, now), limit };
  }

  const rows = await db
    .insert(spendLedger)
    .values({
      userId,
      period: periodOf(now),
      evaluationsUsed: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [spendLedger.userId, spendLedger.period],
      set: {
        evaluationsUsed: sql`${spendLedger.evaluationsUsed} + 1`,
        updatedAt: now,
      },
      setWhere: sql`${spendLedger.evaluationsUsed} < ${limit}`,
    })
    .returning({ used: spendLedger.evaluationsUsed });

  const row = rows[0];
  if (!row) {
    // The predicate rejected the update, so nothing was written and the stored
    // count is the true one.
    return { ok: false, used: await evaluationsUsed(db, userId, now), limit };
  }

  return { ok: true, used: row.used, limit };
}

/**
 * What is left, for the screens that say so.
 *
 * Never negative. A plan downgrade can leave somebody having already used more
 * than their new plan allows, and "-3 evaluations left" is not a sentence worth
 * rendering — they have none, which is what the meter will enforce anyway.
 */
export async function evaluationsRemaining(
  db: QuotaWriter,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<number> {
  return Math.max(0, limit - (await evaluationsUsed(db, userId, now)));
}
