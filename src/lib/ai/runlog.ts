import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { agentRun, spendLedger } from "@/db/schema";
import { SPEND_CAP_CENTS, type PlanId } from "@/lib/billing/catalog";
import { capture } from "@/lib/observability";
import type { CallMeta, CallResult } from "./call";

/**
 * §14.8 — "every `AgentRun` row records the exact version, model and cost."
 *
 * Every model call lands here, whatever its outcome. A refusal and a schema
 * retry both cost real money, so a log that only recorded successes would
 * under-report exactly when something is going wrong — which is when the number
 * matters most. §14.9.7's spend cap reads the ledger this writes, and a cap
 * that reads a number too low is not a cap.
 */

/** Matches the `status` column's documented values in §15. */
export type AgentRunStatus = "ok" | "schema_invalid" | "refusal" | "failed";

export function statusFor(result: CallResult<unknown>): AgentRunStatus {
  if (result.status === "ok") return "ok";
  return result.status === "refused" ? "refusal" : "schema_invalid";
}

/** §14.9.7 — the cap is monthly, so the ledger is keyed by calendar month. */
export function periodOf(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/**
 * Why a run has no user attached, which is two different things that looked
 * identical until this existed.
 *
 * `visitor` is a member of the public on a free surface — the anonymous Skill
 * Check — and is what §19.2's daily cap is for. `operator` is us: a calibration
 * run, a pack-generation script, a probe. Both write `user_id = null`, and
 * before this the cap counted them together, so **generating a pack in
 * production would spend the public free-tool budget and degrade `/check` for
 * real visitors.** Found when a calibration run put 103 cents into a day's
 * anonymous bucket and broke a test that was reading the same rows.
 *
 * Note the failure direction: unset means `visitor`, so forgetting to declare
 * operator work over-counts and degrades the free tier conservatively. The
 * opposite default would leave it unbounded.
 */
export type RunOrigin = "visitor" | "operator";

export interface RunRecord {
  /** Null for anonymous work — the free check, precomputed content. */
  userId: string | null;
  /**
   * Only meaningful when `userId` is null; a run billed to a learner is neither.
   * Defaults to `visitor`, which is the cautious reading.
   */
  origin?: RunOrigin;
  meta: CallMeta;
  status: AgentRunStatus;
  error?: string | null;
  /**
   * Optional and off by default. The prompt carries learner text, so it is
   * stored only where a caller has decided that trace is worth keeping.
   */
  input?: unknown;
  output?: unknown;
}

/**
 * Writes the run, bills it to the learner's month, and emits the analytics
 * event — in one transaction, so a run can never be counted twice or lost
 * between the two tables.
 *
 * Anonymous runs still get an `AgentRun` row: the per-agent cost breakdown
 * §14.9.7 asks to be reviewed weekly has to include the free tier, which is
 * where an abuse spike would show up first.
 */
export async function recordAgentRun(
  db: Db,
  record: RunRecord,
  now: Date = new Date(),
): Promise<void> {
  const { meta } = record;

  await db.transaction(async (tx) => {
    await tx.insert(agentRun).values({
      userId: record.userId,
      agentName: meta.promptName,
      promptVersion: String(meta.promptVersion),
      model: meta.model,
      status: record.status,
      // Written for every run, not only unattributed ones, so the column reads
      // the same way whoever queries it.
      origin: record.origin ?? "visitor",
      costCents: meta.costCents,
      latencyMs: meta.latencyMs,
      error: record.error ?? null,
      input: record.input ?? null,
      output: record.output ?? null,
      createdAt: now,
    });

    // An unpriced model bills nothing rather than zero — see pricing.ts. There
    // is no row to add in that case, and pretending otherwise would quietly
    // report the call as free.
    if (record.userId === null || meta.costCents === null) return;

    await tx
      .insert(spendLedger)
      .values({
        userId: record.userId,
        period: periodOf(now),
        costCents: meta.costCents,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [spendLedger.userId, spendLedger.period],
        set: {
          // Accumulated in SQL rather than read-modify-write, so two calls
          // finishing at once cannot each overwrite the other's total.
          costCents: sql`${spendLedger.costCents} + ${meta.costCents}`,
          updatedAt: now,
        },
      });
  });

  capture("agent_run", {
    agent: meta.promptName,
    prompt_version: meta.promptVersion,
    model: meta.model,
    status: record.status,
    attempts: meta.attempts,
    cost_cents: meta.costCents,
    // §14.9.4 asks for the caching saving to be verified rather than assumed.
    // Shipping both numbers is what makes a silent cache miss visible.
    uncached_cost_cents: meta.uncachedCostCents,
    cache_read_tokens: meta.usage.cacheReadInputTokens,
    input_tokens: meta.usage.inputTokens,
    output_tokens: meta.usage.outputTokens,
    // Shipped beside the token counts because it is priced on a different
    // scale: at $10 per 1,000 searches, eight of them cost more than the tokens
    // of the call that made them, and a cost that moved with no token movement
    // to explain it would look like a mispricing rather than research.
    web_search_requests: meta.usage.webSearchRequests,
    latency_ms: meta.latencyMs,
  });
}

/**
 * Convenience for the common shape: log whatever `callStructured` returned.
 *
 * Returns the result unchanged so a caller can wrap a call without restructuring
 * around it — the logging is not supposed to be the interesting line.
 */
export async function logCall<T>(
  db: Db,
  userId: string | null,
  result: CallResult<T>,
  now?: Date,
  origin?: RunOrigin,
): Promise<CallResult<T>> {
  await recordAgentRun(
    db,
    {
      userId,
      origin,
      meta: result,
      status: statusFor(result),
      error: result.status === "ok" ? null : result.detail,
    },
    now,
  );
  return result;
}

/**
 * §14.9.7 limit 1 — the caps, in cents, checked *before* every call.
 *
 * Re-exported rather than defined: since E13 the numbers live in
 * `src/lib/billing/catalog.ts` beside the plans they belong to, so that a tier
 * cannot be added with a quota and no ceiling. This export stays because four
 * call sites already import it from here and the indirection costs nothing.
 */
export { SPEND_CAP_CENTS } from "@/lib/billing/catalog";

/**
 * §19.2's "hard global daily spend cap on the free tier", for the one surface
 * that spends money with nobody to bill it to: the anonymous Skill Check.
 *
 * Per *day* and global rather than per user and monthly, because there is no
 * user — and per IP, which is what §19.2 reaches for first, needs shared state
 * this build does not have and would still not bound the total. A ceiling on
 * the whole free tier does bound it, which is the property §14.9.7 actually
 * asks for: "never silently overspend".
 *
 * 500¢ is about 100,000 marked answers at Haiku prices — far above any honest
 * day's traffic at this stage and far below a bill worth waking up to.
 *
 * **It reads the `agent_run` rows that were already being written**, rather
 * than a counter of its own. `RunRecord.userId` has been nullable since it was
 * written, for exactly this ("null for anonymous work — the free check"), and a
 * second place recording the same spend is a second place to be wrong.
 *
 * **What it got wrong until `origin` existed:** "null user" is not the same as
 * "a visitor". Pack generation, calibration and every probe script also run
 * unattributed, so an operator generating a pack spent the *public* budget and
 * degraded `/check` for real visitors — a cap designed to protect the free tier
 * being consumed by work that has nothing to do with it. `RunOrigin` is the
 * missing dimension; this counts visitor spend only.
 */
export const ANONYMOUS_DAILY_CAP_CENTS = 500;

/** UTC day, matching the key the planner already writes its dates under. */
export function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export async function anonymousSpentToday(
  db: Db,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({ cents: sql<number>`coalesce(sum(${agentRun.costCents}), 0)` })
    .from(agentRun)
    .where(
      // `is distinct from 'operator'` rather than `<> 'operator'`, because NULL
      // is what every row written before the column existed carries and SQL's
      // three-valued logic would drop them from a plain inequality. They are
      // visitor spend until proven otherwise.
      sql`${agentRun.userId} is null
          and ${agentRun.origin} is distinct from 'operator'
          and ${agentRun.createdAt} >= ${`${dayOf(now)}T00:00:00.000Z`}`,
    );

  // `sum` with `coalesce` and no `group by` always returns exactly one row, so
  // there is no empty case to defend against.
  return Number(rows[0]!.cents);
}

/**
 * Checked *before* the call, like every other cap in §14.9.7 — and the caller's
 * job when it returns true is to degrade rather than to refuse. On the check
 * that degradation is the behaviour this product shipped with for six passes:
 * the learner marks their own answer, and it does not count. Nothing breaks,
 * and nothing quietly claims to have been marked when it was not.
 */
export async function anonymousBudgetSpent(
  db: Db,
  now: Date = new Date(),
): Promise<boolean> {
  return (await anonymousSpentToday(db, now)) >= ANONYMOUS_DAILY_CAP_CENTS;
}

export async function spentThisPeriod(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({ costCents: spendLedger.costCents })
    .from(spendLedger)
    .where(
      sql`${spendLedger.userId} = ${userId} and ${spendLedger.period} = ${periodOf(now)}`,
    )
    .limit(1);

  return rows[0]?.costCents ?? 0;
}

/**
 * §14.9.7 limit 1 — "degrade Opus → Sonnet, then queue, then notify. Checked
 * *before* every call."
 *
 * Only the first step is implemented here; queueing and notification arrive
 * with the Inngest work in E7. Returning the degrade decision rather than
 * throwing keeps the caller in control of what a capped learner still gets,
 * which is the difference between degrading service and denying it.
 */
export async function shouldDegrade(
  db: Db,
  userId: string,
  plan: PlanId,
  now?: Date,
): Promise<boolean> {
  return (await spentThisPeriod(db, userId, now)) >= SPEND_CAP_CENTS[plan];
}
