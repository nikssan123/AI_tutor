import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import { agentRun, spendLedger, user } from "@/db/schema";
import {
  ANONYMOUS_DAILY_CAP_CENTS,
  anonymousBudgetSpent,
  anonymousSpentToday,
  dayOf,
  logCall,
  periodOf,
  recordAgentRun,
  shouldDegrade,
  SPEND_CAP_CENTS,
  spentThisPeriod,
  statusFor,
  type RunRecord,
} from "@/lib/ai/runlog";
import { MemorySink, setSinks } from "@/lib/observability";
import type { CallMeta, CallResult, CallUsage } from "@/lib/ai/call";

/**
 * §14.8 — every model call lands in `AgentRun`, and every billable one lands in
 * the ledger §14.9.7's cap reads.
 */

const NOW = new Date("2026-08-13T09:00:00.000Z");

const usage = (over: Partial<CallUsage> = {}): CallUsage => ({
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  ...over,
});

function meta(over: Partial<CallMeta> = {}): CallMeta {
  return {
    model: "claude-sonnet-5",
    promptName: "curriculum_architect",
    promptVersion: 1,
    attempts: 1,
    usage: usage(),
    costCents: 1.05,
    uncachedCostCents: 1.05,
    latencyMs: 4200,
    ...over,
  };
}

describe("status mapping", () => {
  it("distinguishes a refusal from a schema failure", () => {
    const base = meta();
    expect(statusFor({ status: "ok", value: 1, ...base })).toBe("ok");
    expect(statusFor({ status: "refused", detail: "no", ...base })).toBe(
      "refusal",
    );
    expect(statusFor({ status: "invalid", detail: "bad", ...base })).toBe(
      "schema_invalid",
    );
  });
});

describe("periodOf", () => {
  it("keys the ledger by calendar month", () => {
    expect(periodOf(NOW)).toBe("2026-08");
    expect(periodOf(new Date("2026-12-31T23:59:59.000Z"))).toBe("2026-12");
  });
});

describe("the analytics event", () => {
  const sink = new MemorySink();

  beforeEach(() => {
    sink.clear();
    setSinks([sink]);
  });

  afterEach(() => setSinks(undefined));

  it("ships both the real and the uncached cost (§14.9.4)", async () => {
    // Without the counterfactual, a silent cache miss looks like a slightly
    // more expensive month rather than a bug.
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({
          insert: () => ({
            values: async () => undefined,
          }),
        });
      },
    } as never;

    await recordAgentRun(
      db,
      {
        userId: null,
        meta: meta({ costCents: 1.05, uncachedCostCents: 9.5 }),
        status: "ok",
      },
      NOW,
    );

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]!.event).toBe("agent_run");
    expect(sink.events[0]!.properties).toMatchObject({
      agent: "curriculum_architect",
      prompt_version: 1,
      model: "claude-sonnet-5",
      status: "ok",
      cost_cents: 1.05,
      uncached_cost_cents: 9.5,
      latency_ms: 4200,
    });
  });
});

/* ── Against the real database ─────────────────────────────────────────── */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("the AgentRun log", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const users: string[] = [];

  async function newUser(): Promise<string> {
    const id = `test-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  const runsFor = (userId: string) =>
    db.select().from(agentRun).where(eq(agentRun.userId, userId));

  const ledgerFor = (userId: string) =>
    db.select().from(spendLedger).where(eq(spendLedger.userId, userId));

  beforeEach(() => setSinks([new MemorySink()]));

  afterAll(async () => {
    setSinks(undefined);
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  it("records the model, prompt version, cost and latency (§14.8)", async () => {
    const userId = await newUser();
    await recordAgentRun(db, { userId, meta: meta(), status: "ok" }, NOW);

    const [row] = await runsFor(userId);
    expect(row).toMatchObject({
      agentName: "curriculum_architect",
      promptVersion: "1",
      model: "claude-sonnet-5",
      status: "ok",
      costCents: 1.05,
      latencyMs: 4200,
    });
  });

  it("logs a refusal and its cost, not just the successes", async () => {
    // A refusal is billed. A log that recorded only successes would
    // under-report exactly when something is going wrong.
    const userId = await newUser();
    await recordAgentRun(
      db,
      {
        userId,
        meta: meta({ costCents: 0.4 }),
        status: "refusal",
        error: "declined",
      },
      NOW,
    );

    const [row] = await runsFor(userId);
    expect(row).toMatchObject({ status: "refusal", error: "declined" });
    expect((await ledgerFor(userId))[0]!.costCents).toBeCloseTo(0.4, 5);
  });

  it("accumulates the month's spend across calls", async () => {
    const userId = await newUser();
    for (const cost of [1.5, 2.25]) {
      await recordAgentRun(
        db,
        { userId, meta: meta({ costCents: cost }), status: "ok" },
        NOW,
      );
    }

    const ledger = await ledgerFor(userId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.costCents).toBeCloseTo(3.75, 5);
    expect(await spentThisPeriod(db, userId, NOW)).toBeCloseTo(3.75, 5);
  });

  it("bills each month to its own row", async () => {
    const userId = await newUser();
    await recordAgentRun(db, { userId, meta: meta({ costCents: 5 }), status: "ok" }, NOW);
    await recordAgentRun(
      db,
      { userId, meta: meta({ costCents: 7 }), status: "ok" },
      new Date("2026-09-02T00:00:00.000Z"),
    );

    expect(await ledgerFor(userId)).toHaveLength(2);
    expect(await spentThisPeriod(db, userId, NOW)).toBeCloseTo(5, 5);
  });

  it("logs an anonymous run without billing anyone for it", async () => {
    // The free tier still needs a per-agent cost breakdown — it is where an
    // abuse spike shows up first — but there is no learner to bill.
    //
    // Cleaned up explicitly: an anonymous row has no user to cascade from, so
    // leaving it behind would pollute every other suite that aggregates spend.
    const agentName = `anon-probe-${crypto.randomUUID()}`;
    await recordAgentRun(
      db,
      { userId: null, meta: meta({ promptName: agentName }), status: "ok" },
      NOW,
    );

    const rows = await db
      .select()
      .from(agentRun)
      .where(eq(agentRun.agentName, agentName));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBeNull();
    expect(rows[0]!.costCents).toBeCloseTo(1.05, 5);

    await db.delete(agentRun).where(eq(agentRun.agentName, agentName));
  });

  it("does not bill an unpriced model as free", async () => {
    const userId = await newUser();
    await recordAgentRun(
      db,
      {
        userId,
        meta: meta({ model: "some-future-model", costCents: null }),
        status: "ok",
      },
      NOW,
    );

    expect((await runsFor(userId))[0]!.costCents).toBeNull();
    // No ledger row at all, rather than one claiming zero.
    expect(await ledgerFor(userId)).toEqual([]);
    expect(await spentThisPeriod(db, userId, NOW)).toBe(0);
  });

  it("stores an input/output trace only when the caller asks for one", async () => {
    const userId = await newUser();
    const record: RunRecord = {
      userId,
      meta: meta(),
      status: "ok",
      input: { step: "architect" },
      output: { modules: 12 },
    };
    await recordAgentRun(db, record, NOW);

    const [row] = await runsFor(userId);
    expect(row!.input).toEqual({ step: "architect" });
    expect(row!.output).toEqual({ modules: 12 });
  });

  it("logs whatever callStructured returned, unchanged", async () => {
    const userId = await newUser();
    const result: CallResult<number> = {
      status: "invalid",
      detail: "modules: too small",
      ...meta({ costCents: 0.9 }),
    };

    expect(await logCall(db, userId, result, NOW)).toBe(result);
    const [row] = await runsFor(userId);
    expect(row).toMatchObject({
      status: "schema_invalid",
      error: "modules: too small",
    });
  });

  it("records no error text on a successful call", async () => {
    const userId = await newUser();
    const result: CallResult<number> = { status: "ok", value: 7, ...meta() };

    expect(await logCall(db, userId, result, NOW)).toBe(result);
    const [row] = await runsFor(userId);
    expect(row).toMatchObject({ status: "ok", error: null });
  });

  describe("§14.9.7 limit 1 — the spend cap", () => {
    it("leaves a learner under the cap alone", async () => {
      const userId = await newUser();
      await recordAgentRun(
        db,
        { userId, meta: meta({ costCents: 10 }), status: "ok" },
        NOW,
      );

      expect(await shouldDegrade(db, userId, "pro", NOW)).toBe(false);
      // The free cap is fifteen times lower, so the same spend crosses it.
      expect(await shouldDegrade(db, userId, "free", NOW)).toBe(false);
    });

    it("degrades a learner who has reached their cap", async () => {
      const userId = await newUser();
      await recordAgentRun(
        db,
        { userId, meta: meta({ costCents: SPEND_CAP_CENTS.free }), status: "ok" },
        NOW,
      );

      expect(await shouldDegrade(db, userId, "free", NOW)).toBe(true);
      expect(await shouldDegrade(db, userId, "pro", NOW)).toBe(false);
    });

    it("treats a learner with no spend at all as under the cap", async () => {
      expect(await shouldDegrade(db, await newUser(), "free", NOW)).toBe(false);
    });
  });

  /**
   * §19.2's "hard global daily spend cap on the free tier", for the anonymous
   * Skill Check — the one surface that spends with nobody to bill it to.
   *
   * Asserted as *deltas* against whatever is already in the table. The rows it
   * counts have no user to scope them to, so a fixed total would be a fact
   * about the order the suite happened to run in.
   */
  describe("the anonymous daily cap", () => {
    const ANON_AGENT = "anon_cap_probe";

    const anonRun = async (costCents: number, at: Date) =>
      recordAgentRun(
        db,
        {
          userId: null,
          meta: meta({ costCents, promptName: ANON_AGENT }),
          status: "ok",
        },
        at,
      );

    afterAll(async () => {
      await db.delete(agentRun).where(eq(agentRun.agentName, ANON_AGENT));
    });

    it("counts what the free tier spent today, and only today", async () => {
      const before = await anonymousSpentToday(db, NOW);
      await anonRun(3, NOW);
      expect(await anonymousSpentToday(db, NOW)).toBeCloseTo(before + 3, 5);

      // Yesterday's spend is yesterday's problem.
      await anonRun(7, new Date("2026-08-12T09:00:00.000Z"));
      expect(await anonymousSpentToday(db, NOW)).toBeCloseTo(before + 3, 5);
    });

    it("counts nothing that belongs to a learner", async () => {
      const before = await anonymousSpentToday(db, NOW);
      await recordAgentRun(
        db,
        {
          userId: await newUser(),
          meta: meta({ costCents: 50, promptName: ANON_AGENT }),
          status: "ok",
        },
        NOW,
      );

      // A signed-in learner has their own cap; this one is about the free tier.
      expect(await anonymousSpentToday(db, NOW)).toBeCloseTo(before, 5);
    });

    it("stops the free tier once the day's ceiling is reached", async () => {
      expect(await anonymousBudgetSpent(db, NOW)).toBe(false);
      await anonRun(ANONYMOUS_DAILY_CAP_CENTS, NOW);
      expect(await anonymousBudgetSpent(db, NOW)).toBe(true);

      // And the next day starts clear — the ceiling is a day, not a total.
      const tomorrow = new Date("2026-08-14T09:00:00.000Z");
      expect(dayOf(tomorrow)).not.toBe(dayOf(NOW));
      expect(await anonymousBudgetSpent(db, tomorrow)).toBe(false);
    });
  });
});
