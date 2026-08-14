import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import { learningSession, user } from "@/db/schema";
import { findPack } from "@/lib/content";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { createGoal } from "@/lib/goals/store";
import { scheduleRetrieval } from "@/lib/session/store";
import { saveCurriculum } from "@/lib/curriculum/store";
import { createSubmission, recordEvaluation } from "@/lib/submissions/store";
import { workedDays } from "@/lib/calendar/store";
import { calendarFor } from "@/lib/calendar/view";
import type { GoalSpec } from "@/lib/contracts/goal";
import type { CurriculumDraft } from "@/lib/contracts/curriculum";
import type { MasteryState } from "@/lib/engine";
import type { GradedResult } from "@/lib/evaluation";

/**
 * `/calendar`, against the database.
 *
 * The property under test is that every date on the screen comes from a row
 * some other part of the product already wrote — a finished session, a queued
 * retrieval item, a marked hand-in, a saved curriculum. A calendar that could
 * invent a date would be the easiest place in this product to start
 * overclaiming, and §4.2 law 3 is the rule it would break.
 *
 * Skipped without DATABASE_URL — see AGENTS.md.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const PACK = "photography";
/** Midday, so a UTC day boundary is nowhere near the instants under test. */
const NOW = new Date("2026-08-14T12:00:00.000Z");
const TODAY = "2026-08-14";

const spec = (overrides: Partial<GoalSpec> = {}): GoalSpec => ({
  rawGoal: "take photographs worth printing",
  domain: PACK,
  targetOutcome: "a portfolio of ten",
  outcomeType: "personal",
  statedLevel: "beginner",
  weeklyHours: 3,
  deadline: null,
  motivation: "a show in spring",
  constraints: [],
  existingAssets: [],
  priorDomain: "none",
  depth: "standard",
  clarity: 1,
  ...overrides,
});

/** Strong enough that one good hand-in leaves a standing claim. */
const held = (slug: string): MasteryState => ({
  skillId: slug,
  mastery: 0.9,
  confidence: 0.8,
  evidenceCount: 2,
  lastSuccessAt: NOW.toISOString(),
  lastPracticedAt: NOW.toISOString(),
  decayHalfLifeDays: 180,
});

const graded = (): GradedResult => ({
  overall: 0.8,
  confidence: 0.8,
  evalTier: 2,
  verification: { upheld: [], invalidated: [], missing: [], passed: true },
  criteria: [
    {
      criterionId: "light",
      name: "Light",
      band: "strong",
      evidence: "the window is behind the subject",
      reasoning: "you used it deliberately",
      weight: 1,
    },
  ],
  strengths: [],
  gaps: [],
  nextActions: [],
  bandSpread: 0,
  humanReview: false,
  observation: { correct: true, confidence: 0.8, evidenceTier: 2 },
});

live("the calendar, against the database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = findPack(PACK)!;
  const [first, second, third, fourth] = pack.skills;
  const project = pack.projects[0]!;
  const users: string[] = [];

  async function newUser(): Promise<string> {
    const id = `calendar-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  async function goalFor(
    userId: string,
    mastery: MasteryState[] = [],
    overrides: Partial<GoalSpec> = {},
  ): Promise<string> {
    return createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(overrides),
      mastery,
      now: NOW,
    });
  }

  async function session(
    userId: string,
    goalId: string,
    completedAt: string,
    durationMinutes: number | null,
  ): Promise<void> {
    await db.insert(learningSession).values({
      userId,
      goalId,
      startedAt: new Date(completedAt),
      completedAt: new Date(completedAt),
      blocks: [],
      durationMinutes,
    });
  }

  /** A hand-in, marked, exactly as the Inngest function does it. */
  async function handIn(userId: string, skillSlug: string): Promise<string> {
    const id = await createSubmission(db, {
      userId,
      packSlug: PACK,
      projectSlug: project.slug,
      artefact: "a photograph of a window",
      truncated: false,
      skillSlug,
      now: NOW,
    });

    await recordEvaluation(db, {
      submissionId: id,
      userId,
      packSlug: PACK,
      rubricSlug: project.rubric,
      rubricVersion: 1,
      skill: pack.skills.find((s) => s.slug === skillSlug)!,
      mastery: held(skillSlug),
      result: graded(),
      model: "claude-opus-5",
      promptVersion: "eval@1",
      now: NOW,
    });

    return id;
  }

  const draft = (): CurriculumDraft => ({
    modules: [
      {
        order: 0,
        title: "Learning to read light",
        targetSkillIds: [second!.slug],
        estimatedHours: 4,
        outputArtifact: "none",
        acceptanceCriteria: [],
        rubricId: null,
      },
      {
        order: 1,
        title: "Ten frames of one thing",
        targetSkillIds: [third!.slug],
        estimatedHours: 5,
        outputArtifact: "project",
        acceptanceCriteria: ["ten frames"],
        rubricId: null,
      },
      {
        order: 2,
        title: "A sequence that holds",
        targetSkillIds: [fourth!.slug],
        estimatedHours: 6,
        outputArtifact: "document",
        acceptanceCriteria: ["a contact sheet"],
        rubricId: null,
      },
    ],
    totalHours: 15,
    rationale: "shortest path to a print",
  });

  beforeAll(async () => {
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  describe("workedDays", () => {
    const range = (userId: string, goalId: string) => ({
      userId,
      goalId,
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-08-31T23:59:59.999Z"),
    });

    it("folds a day's sessions into one square", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await session(userId, goalId, "2026-08-10T09:00:00.000Z", 25);
      await session(userId, goalId, "2026-08-10T20:00:00.000Z", 35);
      await session(userId, goalId, "2026-08-13T23:30:00.000Z", 15);

      expect(await workedDays(db, range(userId, goalId))).toEqual([
        { day: "2026-08-10", minutes: 60, sessions: 2 },
        { day: "2026-08-13", minutes: 15, sessions: 1 },
      ]);
    });

    it("buckets by UTC rather than by whatever the server is set to", async () => {
      // A bare `::date` cast reads the connection's timezone, which would move
      // this session onto a different square depending on the deployment.
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await session(userId, goalId, "2026-08-11T23:59:00.000Z", 20);
      await session(userId, goalId, "2026-08-12T00:01:00.000Z", 20);

      expect(
        (await workedDays(db, range(userId, goalId))).map((d) => d.day),
      ).toEqual(["2026-08-11", "2026-08-12"]);
    });

    it("counts a session with no duration as no time at all", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await session(userId, goalId, "2026-08-10T09:00:00.000Z", null);

      expect(await workedDays(db, range(userId, goalId))).toEqual([
        { day: "2026-08-10", minutes: 0, sessions: 1 },
      ]);
    });

    it("leaves out days either side of the range", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await session(userId, goalId, "2026-07-31T12:00:00.000Z", 30);
      await session(userId, goalId, "2026-09-01T12:00:00.000Z", 30);

      expect(await workedDays(db, range(userId, goalId))).toEqual([]);
    });

    it("never shows one learner another's sessions", async () => {
      const mine = await newUser();
      const theirs = await newUser();
      const myGoal = await goalFor(mine);
      const theirGoal = await goalFor(theirs);
      await session(theirs, theirGoal, "2026-08-10T09:00:00.000Z", 40);

      expect(await workedDays(db, range(mine, myGoal))).toEqual([]);
    });
  });

  describe("what the screen is handed", () => {
    it("has nothing to show before there is a goal", async () => {
      const userId = await newUser();
      expect(await calendarFor(db, userId, NOW)).toBeUndefined();
    });

    it("degrades to nothing when the goal's pack has left the build", async () => {
      const userId = await newUser();
      await goalFor(userId, [], { domain: "a-pack-that-was-deleted" });
      expect(await calendarFor(db, userId, NOW)).toBeUndefined();
    });

    it("opens on the month you are in, and moves either side of it", async () => {
      const userId = await newUser();
      await goalFor(userId);

      const view = (await calendarFor(db, userId, NOW))!;
      expect(view.month).toBe("2026-08");
      expect(view.label).toBe("August 2026");
      expect(view.previousMonth).toBe("2026-07");
      expect(view.nextMonth).toBe("2026-09");
      expect(view.today).toBe(TODAY);
      expect(view.weeks.flat().some((c) => c.isToday)).toBe(true);
    });

    it("shows the month that was asked for", async () => {
      const userId = await newUser();
      await goalFor(userId);

      const view = (await calendarFor(db, userId, NOW, { month: "2026-11" }))!;
      expect(view.month).toBe("2026-11");
      // Today is not in November, so no square is marked as it.
      expect(view.weeks.flat().some((c) => c.isToday)).toBe(false);
    });

    it("falls back to this month when the query string is not one", async () => {
      const userId = await newUser();
      await goalFor(userId);

      const view = (await calendarFor(db, userId, NOW, { month: "lol" }))!;
      expect(view.month).toBe("2026-08");
    });

    it("marks the days that were worked, and counts the week kept", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await session(userId, goalId, "2026-08-10T09:00:00.000Z", 120);
      await session(userId, goalId, "2026-08-12T09:00:00.000Z", 60);

      const view = (await calendarFor(db, userId, NOW))!;
      const worked = view.weeks
        .flat()
        .filter((c) => c.certainties.includes("recorded"));

      expect(worked.map((c) => c.day)).toEqual(["2026-08-10", "2026-08-12"]);
      expect(worked[0]!.description).toContain("120 minutes");
      expect(view.commitment).toEqual({
        weeklyHours: 3,
        weeksKept: 1,
        thisWeekHours: 3,
        keptThisWeek: true,
      });
      // Work already done is not something that is coming.
      expect(view.ahead).toEqual([]);
    });

    it("puts a queued question on the day it comes back", async () => {
      const userId = await newUser();
      await goalFor(userId);
      await scheduleRetrieval(db, {
        userId,
        packSlug: PACK,
        skillSlug: first!.slug,
        itemSlug: "triangle-equivalent",
        succeeded: true,
        halfLifeDays: 4,
        now: NOW,
      });

      const view = (await calendarFor(db, userId, NOW))!;
      const [due] = view.ahead;
      expect(due!.day).toBe("2026-08-18");
      expect(due!.certainty).toBe("due");
      expect(due!.detail).toBe(first!.name);
    });

    it("dates the day a claim stops counting, and only for claims", async () => {
      const userId = await newUser();
      // Both sit above the bar; only one of them has been handed in, and
      // §24 E9's rule is that a claim needs the hand-in behind it.
      await goalFor(userId, [held(first!.slug), held(second!.slug)]);
      await handIn(userId, first!.slug);

      const view = (await calendarFor(db, userId, NOW))!;
      const lapses = view.ahead.filter((e) => e.kind === "lapse");

      expect(lapses).toHaveLength(1);
      expect(lapses[0]!.title).toBe(`${first!.name} stops counting`);
      expect(lapses[0]!.certainty).toBe("projected");
      expect(lapses[0]!.day > TODAY).toBe(true);
    });

    it("offers no checkpoints until a path has been built", async () => {
      const userId = await newUser();
      await goalFor(userId);

      const view = (await calendarFor(db, userId, NOW))!;
      expect(view.hasPath).toBe(false);
      expect(view.checkpoints).toEqual([]);
    });

    it("dates the hand-ins on the path, at both paces", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await session(userId, goalId, "2026-08-10T09:00:00.000Z", 60);
      await saveCurriculum(db, {
        goalId,
        packSlug: PACK,
        draft: draft(),
        report: null,
        source: "generated",
        now: NOW,
      });

      const view = (await calendarFor(db, userId, NOW))!;
      expect(view.hasPath).toBe(true);
      expect(view.checkpoints.map((c) => c.title)).toEqual([
        "Ten frames of one thing",
        "A sequence that holds",
      ]);

      const [graded] = view.checkpoints;
      expect(graded!.graded).toBe(true);
      expect(graded!.hoursAway).toBeGreaterThan(0);
      expect(graded!.day > TODAY).toBe(true);
      // One hour logged against three committed, so the honest date is later.
      expect(graded!.dayAtActualPace! > graded!.day).toBe(true);
      // Each one turns up in the month it lands in, drawn as a projection.
      const month = (await calendarFor(db, userId, NOW, {
        month: graded!.day.slice(0, 7),
      }))!;
      expect(
        month.weeks.flat().find((c) => c.day === graded!.day)!.certainties,
      ).toContain("projected");
    });

    it("gives no second date to a week with nothing logged in it", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await saveCurriculum(db, {
        goalId,
        packSlug: PACK,
        draft: draft(),
        report: null,
        source: "generated",
        now: NOW,
      });

      const view = (await calendarFor(db, userId, NOW))!;
      expect(view.checkpoints[0]!.dayAtActualPace).toBeNull();
    });

    it("carries the learner's own deadline, against what they set it for", async () => {
      const userId = await newUser();
      await goalFor(userId, [], { deadline: "2026-09-30" });

      const view = (await calendarFor(db, userId, NOW))!;
      expect(view.deadline).toBe("2026-09-30");

      const [entry] = view.ahead.filter((e) => e.kind === "deadline");
      expect(entry!.day).toBe("2026-09-30");
      expect(entry!.detail).toBe("a portfolio of ten");
    });
  });
});
