import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { agentRun, spendLedger } from "@/db/schema";
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

export interface RunRecord {
  /** Null for anonymous work — the free check, precomputed content. */
  userId: string | null;
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
): Promise<CallResult<T>> {
  await recordAgentRun(
    db,
    {
      userId,
      meta: result,
      status: statusFor(result),
      error: result.status === "ok" ? null : result.detail,
    },
    now,
  );
  return result;
}

/** §14.9.7 limit 1 — the caps, in cents, checked *before* every call. */
export const SPEND_CAP_CENTS = { free: 100, pro: 1_500 } as const;

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
  plan: keyof typeof SPEND_CAP_CENTS,
  now?: Date,
): Promise<boolean> {
  return (await spentThisPeriod(db, userId, now)) >= SPEND_CAP_CENTS[plan];
}
