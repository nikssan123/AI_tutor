import { and, count, desc, eq, gte, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { agentRun, learningGoal, spendLedger, user } from "@/db/schema";
import { periodOf, SPEND_CAP_CENTS } from "@/lib/ai/runlog";

/**
 * The read model behind `/admin`.
 *
 * Every function here is a query and nothing else — the console has no writes,
 * which is a deliberate scope choice rather than an unfinished one. A read-only
 * admin surface has no CSRF surface, needs no destructive-action confirmations
 * and needs no audit log to be trustworthy. The day it grows a button, all
 * three of those become required at once.
 *
 * Windows are UTC. The whole system already pins UTC (`tests/setup.ts`, the
 * `timezone` column's default), and a "today" that means something different on
 * the server than in the ledger would make these numbers unreconcilable.
 */

export function startOfUtcDay(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

export function startOfUtcMonth(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export function hoursBefore(at: Date, hours: number): Date {
  return new Date(at.getTime() - hours * 60 * 60 * 1000);
}

export interface SpendSnapshot {
  todayCents: number;
  monthCents: number;
  /** Learners whose month-to-date spend has reached their plan's §14.9.7 cap. */
  cappedLearners: number;
}

/**
 * Spend comes from `agent_run`, not from `spend_ledger`.
 *
 * The ledger deliberately excludes anonymous work — `recordAgentRun` skips it
 * when `userId` is null — because there is no learner to bill. But the free
 * check and precomputed content still cost real money, and an abuse spike shows
 * up there first, so the number an operator needs is the one that includes them.
 */
export async function spendSnapshot(
  db: Db,
  now: Date = new Date(),
): Promise<SpendSnapshot> {
  // An aggregate with no GROUP BY returns exactly one row, always — so there is
  // no "no row" case to fall back from, and `?? 0` here would be a branch no
  // test could ever reach. `coalesce` in the SQL is what handles the empty
  // table, turning a null sum into a real 0.
  const totals = async (since: Date): Promise<number> => {
    const [row] = await db
      .select({ cents: sql<number>`coalesce(sum(${agentRun.costCents}), 0)` })
      .from(agentRun)
      .where(gte(agentRun.createdAt, since));
    return Number(row!.cents);
  };

  // The cap depends on the learner's plan, so it is resolved per row in SQL
  // rather than by pulling every ledger row into memory to compare.
  //
  // The `::real` casts are required, not stylistic: postgres-js sends bound
  // parameters untyped, so without them the `case` arms come back as `text` and
  // Postgres rejects the comparison with "operator does not exist: real >= text".
  const cap = sql`case ${user.plan} when 'pro' then ${SPEND_CAP_CENTS.pro}::real else ${SPEND_CAP_CENTS.free}::real end`;

  const [capped] = await db
    .select({ n: count() })
    .from(spendLedger)
    .innerJoin(user, eq(user.id, spendLedger.userId))
    .where(
      and(
        eq(spendLedger.period, periodOf(now)),
        gte(spendLedger.costCents, cap),
      ),
    );

  return {
    todayCents: await totals(startOfUtcDay(now)),
    monthCents: await totals(startOfUtcMonth(now)),
    cappedLearners: Number(capped!.n),
  };
}

export interface RunStatusCount {
  status: string;
  runs: number;
  costCents: number;
}

export interface RunFailure {
  id: string;
  agentName: string;
  promptVersion: string;
  model: string;
  status: string;
  error: string | null;
  createdAt: Date;
}

export interface RunHealth {
  counts: RunStatusCount[];
  failures: RunFailure[];
}

/** How many failures the console lists before it stops being readable. */
export const FAILURE_LIMIT = 20;

/**
 * §14.8's run log, read back as an operator would want it: the shape of the
 * last day first, then the individual failures behind it.
 *
 * Both halves matter. The counts say whether something is wrong; the failure
 * rows say what, naming the agent and prompt version so the fix is a file, not
 * an investigation.
 */
export async function runHealth(
  db: Db,
  now: Date = new Date(),
  windowHours = 24,
): Promise<RunHealth> {
  const since = hoursBefore(now, windowHours);

  const counts = await db
    .select({
      status: agentRun.status,
      runs: count(),
      costCents: sql<number>`coalesce(sum(${agentRun.costCents}), 0)`,
    })
    .from(agentRun)
    .where(gte(agentRun.createdAt, since))
    .groupBy(agentRun.status)
    .orderBy(desc(count()));

  const failures = await db
    .select({
      id: agentRun.id,
      agentName: agentRun.agentName,
      promptVersion: agentRun.promptVersion,
      model: agentRun.model,
      status: agentRun.status,
      error: agentRun.error,
      createdAt: agentRun.createdAt,
    })
    .from(agentRun)
    .where(and(gte(agentRun.createdAt, since), ne(agentRun.status, "ok")))
    .orderBy(desc(agentRun.createdAt))
    .limit(FAILURE_LIMIT);

  return {
    counts: counts.map((row) => ({
      status: row.status,
      runs: Number(row.runs),
      costCents: Number(row.costCents),
    })),
    failures,
  };
}

export interface LearnerCounts {
  total: number;
  newThisWeek: number;
  activeGoals: number;
}

export async function learnerCounts(
  db: Db,
  now: Date = new Date(),
): Promise<LearnerCounts> {
  const [total] = await db.select({ n: count() }).from(user);

  const [recent] = await db
    .select({ n: count() })
    .from(user)
    .where(gte(user.createdAt, hoursBefore(now, 24 * 7)));

  const [goals] = await db
    .select({ n: count() })
    .from(learningGoal)
    .where(eq(learningGoal.status, "active"));

  // As above: three ungrouped counts, three guaranteed rows.
  return {
    total: Number(total!.n),
    newThisWeek: Number(recent!.n),
    activeGoals: Number(goals!.n),
  };
}

export interface ConsoleSnapshot {
  spend: SpendSnapshot;
  runs: RunHealth;
  learners: LearnerCounts;
  generatedAt: Date;
}

export async function consoleSnapshot(
  db: Db,
  now: Date = new Date(),
): Promise<ConsoleSnapshot> {
  const [spend, runs, learners] = await Promise.all([
    spendSnapshot(db, now),
    runHealth(db, now),
    learnerCounts(db, now),
  ]);

  return { spend, runs, learners, generatedAt: now };
}
