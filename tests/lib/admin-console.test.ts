import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, gte, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { agentRun, learningGoal, spendLedger, user } from "@/db/schema";
import {
  consoleSnapshot,
  FAILURE_LIMIT,
  hoursBefore,
  learnerCounts,
  runHealth,
  spendSnapshot,
  startOfUtcDay,
  startOfUtcMonth,
} from "@/lib/admin/console";
import { grantAdmin, listAdmins, NoSuchUserError, revokeAdmin } from "@/lib/admin/grant";

/**
 * The console's read model, and the role-granting CLI behind it.
 *
 * The window helpers are pure and tested directly. Everything else runs against
 * the real Postgres, because what is being asserted is the SQL — a hand-rolled
 * fake would only prove that the fake agrees with itself, and the `case`
 * expression that resolves a learner's cap is exactly the kind of thing that
 * looks right and returns the wrong rows.
 */

describe("window helpers", () => {
  const at = new Date("2026-08-13T14:37:12.500Z");

  it("truncates to the start of the UTC day", () => {
    expect(startOfUtcDay(at).toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  it("truncates to the start of the UTC month", () => {
    expect(startOfUtcMonth(at).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("subtracts whole hours", () => {
    expect(hoursBefore(at, 24).toISOString()).toBe("2026-08-12T14:37:12.500Z");
  });

  it("stays on UTC across a local-timezone boundary", () => {
    // A "today" that means one thing on the server and another in the ledger
    // would make the two numbers unreconcilable.
    const lateUtc = new Date("2026-08-13T23:30:00.000Z");
    expect(startOfUtcDay(lateUtc).toISOString()).toBe(
      "2026-08-13T00:00:00.000Z",
    );
  });
});

/**
 * Integration tests against the local Postgres. Skipped when DATABASE_URL is
 * absent, so the suite still passes with Docker down.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  /**
   * The console's queries are global aggregates — that is their whole job, so
   * they cannot be scoped to a fixture user. Other test files insert rows into
   * `user` and `agent_run` concurrently, all of them landing on `defaultNow()`.
   *
   * So the fixture claims a *window* instead: a "now" far enough in the future
   * that no default-timestamped row from another file can fall inside it. That
   * makes the windowed assertions exact rather than approximate, without any
   * cross-file coordination.
   */
  const NOW = new Date("2027-06-15T12:00:00.000Z");
  const PERIOD = "2027-06";
  const IDS = ["admin-test-free", "admin-test-pro", "admin-test-quiet"];

  /** Everything from 2027 on belongs to this fixture — including anonymous
   * runs, which have no user id to delete them by. */
  const WINDOW_START = new Date("2027-01-01T00:00:00.000Z");

  async function reset() {
    await db.delete(agentRun).where(gte(agentRun.createdAt, WINDOW_START));
    await db.delete(spendLedger).where(inArray(spendLedger.userId, IDS));
    await db.delete(learningGoal).where(inArray(learningGoal.userId, IDS));
    await db.delete(user).where(inArray(user.id, IDS));
  }

  beforeEach(async () => {
    await reset();
    await db.insert(user).values([
      {
        id: IDS[0]!,
        name: "Free",
        email: "free@admin-test.local",
        plan: "free",
        createdAt: hoursBefore(NOW, 24),
      },
      {
        id: IDS[1]!,
        name: "Pro",
        email: "pro@admin-test.local",
        plan: "pro",
        createdAt: hoursBefore(NOW, 24 * 30),
      },
      {
        id: IDS[2]!,
        name: "Quiet",
        email: "quiet@admin-test.local",
        plan: "free",
        createdAt: hoursBefore(NOW, 24 * 30),
      },
    ]);
  });

  describe("spendSnapshot", () => {
    it("separates today from the month to date", async () => {
      await db.insert(agentRun).values([
        run(IDS[0]!, { costCents: 10, createdAt: NOW }),
        run(IDS[0]!, { costCents: 5, createdAt: hoursBefore(NOW, 2) }),
        // Earlier this month, but not today.
        run(IDS[0]!, { costCents: 40, createdAt: new Date("2027-06-02T09:00:00Z") }),
        // Last month — in neither window.
        run(IDS[0]!, { costCents: 999, createdAt: new Date("2027-05-30T09:00:00Z") }),
      ]);

      const snapshot = await spendSnapshot(db, NOW);
      expect(snapshot.todayCents).toBeCloseTo(15, 5);
      expect(snapshot.monthCents).toBeCloseTo(55, 5);
    });

    it("counts anonymous runs, which the per-learner ledger excludes", async () => {
      // The free check costs real money and is where an abuse spike shows up
      // first, so a spend number that omitted it would mislead exactly when it
      // mattered.
      await db.insert(agentRun).values([run(null, { costCents: 7, createdAt: NOW })]);

      const snapshot = await spendSnapshot(db, NOW);
      expect(snapshot.todayCents).toBeCloseTo(7, 5);
    });

    it("reports zero rather than null when nothing has run", async () => {
      const snapshot = await spendSnapshot(db, NOW);
      expect(snapshot.todayCents).toBe(0);
      expect(snapshot.monthCents).toBe(0);
    });

    it("resolves each learner's cap against their own plan", async () => {
      // 120¢ is over the free cap (100) and well under the pro cap (1500).
      // A single hardcoded threshold would get one of these two wrong.
      await db.insert(spendLedger).values([
        { userId: IDS[0]!, period: PERIOD, costCents: 120 },
        { userId: IDS[1]!, period: PERIOD, costCents: 120 },
      ]);

      const snapshot = await spendSnapshot(db, NOW);
      expect(snapshot.cappedLearners).toBe(1);
    });

    it("counts a learner exactly at their cap as capped", async () => {
      await db
        .insert(spendLedger)
        .values([{ userId: IDS[0]!, period: PERIOD, costCents: 100 }]);

      expect((await spendSnapshot(db, NOW)).cappedLearners).toBe(1);
    });

    it("ignores ledger rows from another month", async () => {
      await db
        .insert(spendLedger)
        .values([{ userId: IDS[0]!, period: "2027-05", costCents: 5000 }]);

      expect((await spendSnapshot(db, NOW)).cappedLearners).toBe(0);
    });
  });

  describe("runHealth", () => {
    it("groups the last 24 hours by status, with each status's spend", async () => {
      await db.insert(agentRun).values([
        run(IDS[0]!, { status: "ok", costCents: 3, createdAt: NOW }),
        run(IDS[0]!, { status: "ok", costCents: 4, createdAt: hoursBefore(NOW, 1) }),
        run(IDS[0]!, { status: "refusal", costCents: 2, createdAt: NOW }),
        // Outside the window.
        run(IDS[0]!, { status: "failed", costCents: 99, createdAt: hoursBefore(NOW, 48) }),
      ]);

      const health = await runHealth(db, NOW);
      const byStatus = Object.fromEntries(
        health.counts.map((row) => [row.status, row]),
      );

      expect(byStatus.ok?.runs).toBe(2);
      expect(byStatus.ok?.costCents).toBeCloseTo(7, 5);
      expect(byStatus.refusal?.runs).toBe(1);
      expect(byStatus.failed).toBeUndefined();
    });

    it("lists the failures behind the counts, newest first", async () => {
      await db.insert(agentRun).values([
        run(IDS[0]!, { status: "ok", createdAt: NOW }),
        run(IDS[0]!, {
          status: "failed",
          error: "older",
          createdAt: hoursBefore(NOW, 3),
        }),
        run(IDS[0]!, {
          status: "schema_invalid",
          error: "newer",
          createdAt: hoursBefore(NOW, 1),
        }),
      ]);

      const health = await runHealth(db, NOW);
      expect(health.failures.map((f) => f.error)).toEqual(["newer", "older"]);
      // A successful run is not a failure, however much it cost.
      expect(health.failures.every((f) => f.status !== "ok")).toBe(true);
    });

    it("names the agent and prompt version, so the fix is a file", async () => {
      await db.insert(agentRun).values([
        run(IDS[0]!, {
          status: "failed",
          agentName: "curriculum-architect",
          promptVersion: "3",
          model: "claude-opus-5",
          error: "boom",
          createdAt: NOW,
        }),
      ]);

      expect((await runHealth(db, NOW)).failures[0]).toMatchObject({
        agentName: "curriculum-architect",
        promptVersion: "3",
        model: "claude-opus-5",
        error: "boom",
      });
    });

    it(`caps the list at ${FAILURE_LIMIT} rows`, async () => {
      await db.insert(agentRun).values(
        Array.from({ length: FAILURE_LIMIT + 5 }, (_, i) =>
          run(IDS[0]!, {
            status: "failed",
            error: `e${i}`,
            createdAt: hoursBefore(NOW, 1),
          }),
        ),
      );

      expect((await runHealth(db, NOW)).failures).toHaveLength(FAILURE_LIMIT);
    });

    it("honours a custom window", async () => {
      await db
        .insert(agentRun)
        .values([run(IDS[0]!, { status: "ok", createdAt: hoursBefore(NOW, 5) })]);

      expect(await runHealth(db, NOW, 1)).toMatchObject({ counts: [] });
      expect((await runHealth(db, NOW, 6)).counts).toHaveLength(1);
    });

    it("returns empty halves when nothing has run", async () => {
      const health = await runHealth(db, NOW);
      expect(health.counts).toEqual([]);
      expect(health.failures).toEqual([]);
    });
  });

  describe("learnerCounts", () => {
    it("counts sign-ups in the last week separately from the total", async () => {
      const counts = await learnerCounts(db, NOW);
      // Three fixtures exist; one was created 24h ago, two a month ago. Other
      // rows may exist in the shared database, so assert the delta.
      expect(counts.total).toBeGreaterThanOrEqual(3);
      expect(counts.newThisWeek).toBeGreaterThanOrEqual(1);
      expect(counts.newThisWeek).toBeLessThanOrEqual(counts.total);
    });

    it("counts only active goals", async () => {
      const before = (await learnerCounts(db, NOW)).activeGoals;
      await db.insert(learningGoal).values([
        { userId: IDS[0]!, rawGoalText: "a", status: "active" },
        { userId: IDS[0]!, rawGoalText: "b", status: "abandoned" },
      ]);

      expect((await learnerCounts(db, NOW)).activeGoals).toBe(before + 1);
    });
  });

  describe("defaulting to now", () => {
    /**
     * The pages call these with no `now` — `consoleSnapshot(getDb())` — so the
     * default parameter is the production path and has to be exercised. The
     * assertions are structural rather than numeric because the window is the
     * real wall clock and the database is shared.
     */
    it("each query runs against the real clock when given no date", async () => {
      const spend = await spendSnapshot(db);
      expect(Number.isFinite(spend.todayCents)).toBe(true);
      expect(spend.todayCents).toBeGreaterThanOrEqual(0);
      expect(spend.monthCents).toBeGreaterThanOrEqual(0);
      // Deliberately *not* asserting monthCents >= todayCents. The two totals
      // are separate queries over a database other test files are inserting
      // into and deleting from as this runs, so the pair is not a consistent
      // snapshot and the invariant is only true of one. The windowed tests
      // above own that arithmetic; this one exists to cover the default `now`.

      const health = await runHealth(db);
      expect(Array.isArray(health.counts)).toBe(true);
      expect(health.failures.length).toBeLessThanOrEqual(FAILURE_LIMIT);

      const learners = await learnerCounts(db);
      expect(learners.total).toBeGreaterThanOrEqual(3);

      const snapshot = await consoleSnapshot(db);
      expect(snapshot.generatedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("consoleSnapshot", () => {
    it("assembles all three sections and stamps the time", async () => {
      await db.insert(agentRun).values([
        run(IDS[0]!, { status: "ok", costCents: 1, createdAt: NOW }),
      ]);

      const snapshot = await consoleSnapshot(db, NOW);
      expect(snapshot.generatedAt).toBe(NOW);
      expect(snapshot.spend.todayCents).toBeCloseTo(1, 5);
      expect(snapshot.runs.counts).toHaveLength(1);
      expect(snapshot.learners.total).toBeGreaterThanOrEqual(3);
    });
  });

  describe("granting the admin role", () => {
    it("promotes an existing account and reports the transition", async () => {
      const change = await grantAdmin(db, "free@admin-test.local");
      expect(change).toEqual({
        email: "free@admin-test.local",
        from: "user",
        to: "admin",
        changed: true,
      });

      const [row] = await db
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, IDS[0]!));
      expect(row?.role).toBe("admin");
    });

    it("is idempotent, and says so rather than lying about a change", async () => {
      await grantAdmin(db, "free@admin-test.local");
      const second = await grantAdmin(db, "free@admin-test.local");
      expect(second.changed).toBe(false);
      expect(second.to).toBe("admin");
    });

    it("normalises the email so a stray capital is not a silent no-op", async () => {
      const change = await grantAdmin(db, "  FREE@Admin-Test.local  ");
      expect(change.email).toBe("free@admin-test.local");
      expect(change.changed).toBe(true);
    });

    it("refuses to create an account as a side effect of granting", async () => {
      // Auto-creating here would turn a typo into a new admin account.
      await expect(grantAdmin(db, "nobody@admin-test.local")).rejects.toThrow(
        NoSuchUserError,
      );
    });

    it("revokes back to the unprivileged default", async () => {
      await grantAdmin(db, "free@admin-test.local");
      const change = await revokeAdmin(db, "free@admin-test.local");
      expect(change).toMatchObject({ from: "admin", to: "user", changed: true });
    });

    it("lists current admins", async () => {
      await grantAdmin(db, "pro@admin-test.local");
      expect(await listAdmins(db)).toContain("pro@admin-test.local");
    });

    it("omits revoked admins from the list", async () => {
      await grantAdmin(db, "pro@admin-test.local");
      await revokeAdmin(db, "pro@admin-test.local");
      expect(await listAdmins(db)).not.toContain("pro@admin-test.local");
    });
  });
});

/** An `agent_run` row with sane defaults, so each test states only its point. */
function run(
  userId: string | null,
  overrides: Partial<typeof agentRun.$inferInsert> = {},
): typeof agentRun.$inferInsert {
  return {
    userId,
    agentName: "test-agent",
    promptVersion: "1",
    model: "claude-sonnet-5",
    status: "ok",
    costCents: 0,
    latencyMs: 10,
    ...overrides,
  };
}
