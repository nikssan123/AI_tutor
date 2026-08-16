import { beforeEach, describe, expect, it, vi } from "vitest";
import { findPack } from "@/lib/content";
import type { StoredGoal } from "@/lib/goals/store";

/**
 * The next few dated things, for `/today`.
 *
 * The property worth holding is that this is **not a second source of truth**:
 * every row comes out of `buildEntries`, so a question coming back round is
 * worded on `/today` exactly as it is worded on `/progress`. The assertions
 * below are mostly about which rows reach the band and in what order — a render
 * test would check the sentence they produced instead.
 */

const masteryForMock = vi.fn(async () => [] as unknown[]);
const dueRetrievalMock = vi.fn(async () => [] as unknown[]);
const evidenceMock = vi.fn(async () => new Map<string, unknown>());
const curriculumMock = vi.fn(async () => undefined as unknown);

vi.mock("@/lib/goals/store", () => ({
  masteryFor: (...a: unknown[]) => masteryForMock(...(a as [])),
}));
vi.mock("@/lib/session/store", () => ({
  dueRetrieval: (...a: unknown[]) => dueRetrievalMock(...(a as [])),
}));
vi.mock("@/lib/mastery/store", () => ({
  artefactEvidence: (...a: unknown[]) => evidenceMock(...(a as [])),
}));
vi.mock("@/lib/curriculum/store", () => ({
  currentCurriculum: (...a: unknown[]) => curriculumMock(...(a as [])),
}));

const { upcomingFor, UPCOMING_LIMIT } = await import("@/lib/calendar/upcoming");

const pack = findPack("photography")!;
const NOW = new Date("2026-08-14T09:00:00.000Z");

const goal = (over: Partial<StoredGoal["spec"]> = {}): StoredGoal =>
  ({
    id: "g1",
    packSlug: pack.slug,
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    spec: {
      rawGoal: "shoot in manual",
      domain: "photography",
      targetOutcome: "a portfolio of ten",
      outcomeType: "personal",
      statedLevel: "beginner",
      weeklyHours: 3,
      deadline: null,
      motivation: "",
      constraints: [],
      existingAssets: [],
      depth: "standard",
      clarity: 1,
      ...over,
    },
  }) as StoredGoal;

const run = (over: Partial<Parameters<typeof upcomingFor>[1]> = {}) =>
  upcomingFor({} as never, {
    userId: "u1",
    goal: goal(),
    pack,
    now: NOW,
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  masteryForMock.mockResolvedValue([]);
  dueRetrievalMock.mockResolvedValue([]);
  evidenceMock.mockResolvedValue(new Map());
  curriculumMock.mockResolvedValue(undefined);
});

describe("upcomingFor", () => {
  it("has nothing to say on a course that has not started", async () => {
    // No queue, no claims, no curriculum — and no row invented to fill the
    // band. The page drops the whole section rather than furnish it.
    expect(await run()).toEqual([]);
  });

  it("names a question coming back round in the queue's own words", async () => {
    dueRetrievalMock.mockResolvedValue([
      { skillId: pack.skills[0]!.slug, dueAt: "2026-08-18T09:00:00.000Z" },
    ]);

    const [entry] = await run();

    expect(entry).toMatchObject({
      day: "2026-08-18",
      kind: "retrieval",
      certainty: "due",
      title: "1 question comes back to you",
      detail: pack.skills[0]!.name,
    });
  });

  /** Merged per day, exactly as `/progress` merges them: four identical rows
   *  on one date is a wall, and "four questions come back" is the fact. */
  it("merges a day's questions into one row", async () => {
    dueRetrievalMock.mockResolvedValue([
      { skillId: pack.skills[0]!.slug, dueAt: "2026-08-18T09:00:00.000Z" },
      { skillId: pack.skills[1]!.slug, dueAt: "2026-08-18T11:00:00.000Z" },
    ]);

    const entries = await run();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe("2 questions come back to you");
  });

  /**
   * A skill the pack no longer names is dropped rather than shown as a slug —
   * the same call `masteryFor` makes. A removed skill must not reappear as a
   * mystery row in somebody's morning.
   */
  it("drops a queued skill the pack has stopped naming", async () => {
    dueRetrievalMock.mockResolvedValue([
      { skillId: "a-skill-that-left", dueAt: "2026-08-18T09:00:00.000Z" },
    ]);

    expect(await run()).toEqual([]);
  });

  it("carries the learner's own deadline, and what they set it for", async () => {
    const [entry] = await run({ goal: goal({ deadline: "2026-09-30" }) });

    expect(entry).toMatchObject({
      day: "2026-09-30",
      kind: "deadline",
      certainty: "due",
      title: "The date you set yourself",
      detail: "a portfolio of ten",
    });
  });

  /**
   * The row `/progress`'s own "what's coming" list deliberately leaves out.
   *
   * That screen dates checkpoints in their own band, so `IN_AHEAD` excludes
   * them. Here they are the whole point: a piece of work to hand in is the
   * thing most worth seeing before you start today's session.
   */
  it("includes the hand-ins that /progress keeps in a band of their own", async () => {
    curriculumMock.mockResolvedValue({
      modules: [
        {
          order: 1,
          title: "Ten frames of one thing",
          targetSkillIds: [pack.skills[0]!.slug, pack.skills[1]!.slug],
          estimatedHours: 6,
          outputArtifact: "project",
          acceptanceCriteria: [],
          rubricId: null,
        },
      ],
    });

    const entries = await run();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "checkpoint",
      certainty: "projected",
      title: "Ten frames of one thing",
      detail: "Something to hand in and have marked against the rubric.",
    });
  });

  it("sorts by date, so what is closest to landing comes first", async () => {
    dueRetrievalMock.mockResolvedValue([
      { skillId: pack.skills[0]!.slug, dueAt: "2026-08-25T09:00:00.000Z" },
    ]);

    const entries = await run({ goal: goal({ deadline: "2026-08-16" }) });

    expect(entries.map((e) => e.day)).toEqual(["2026-08-16", "2026-08-25"]);
  });

  it("caps the band rather than letting it become a feed", async () => {
    dueRetrievalMock.mockResolvedValue(
      ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"].map((day) => ({
        skillId: pack.skills[0]!.slug,
        dueAt: `${day}T09:00:00.000Z`,
      })),
    );

    expect(await run()).toHaveLength(UPCOMING_LIMIT);
    expect(UPCOMING_LIMIT).toBe(3);
  });

  it("takes a caller's own cap", async () => {
    dueRetrievalMock.mockResolvedValue(
      ["2026-08-16", "2026-08-17"].map((day) => ({
        skillId: pack.skills[0]!.slug,
        dueAt: `${day}T09:00:00.000Z`,
      })),
    );

    expect(await run({ limit: 1 })).toHaveLength(1);
  });

  /**
   * Nothing recorded ever reaches this band. `/today` is the screen you
   * finished the session on, so "you sat down twice" is not news there — and
   * every row here is therefore something that has not happened yet.
   */
  it("reports nothing that has already happened", async () => {
    dueRetrievalMock.mockResolvedValue([
      { skillId: pack.skills[0]!.slug, dueAt: "2026-08-18T09:00:00.000Z" },
    ]);

    for (const entry of await run()) {
      expect(entry.certainty).not.toBe("recorded");
      expect(entry.kind).not.toBe("session");
    }
  });

  /**
   * A claim with a date on which it stops counting.
   *
   * Driven off the ledger rather than off mastery directly (§24 E9 — a claim
   * needs a marked hand-in behind it), and priced through `effectiveMastery`
   * rather than a second decay curve, so this band cannot drift from the model
   * the planner scores on.
   */
  it("prices what the learner already holds, rather than assuming nothing", async () => {
    const skill = pack.skills[0]!;
    masteryForMock.mockResolvedValue([
      {
        skillId: skill.slug,
        mastery: 0.95,
        confidence: 0.9,
        evidenceCount: 3,
        lastSuccessAt: "2026-08-13T09:00:00.000Z",
        lastPracticedAt: "2026-08-13T09:00:00.000Z",
        decayHalfLifeDays: 7,
      },
    ]);
    evidenceMock.mockResolvedValue(
      new Map([
        [
          skill.slug,
          {
            skillSlug: skill.slug,
            submissionId: "s1",
            verdict: "pass",
            markedAt: "2026-08-13T09:00:00.000Z",
          },
        ],
      ]),
    );

    const entries = await run();

    // The mastery reached the arithmetic: a skill held above the bar is one
    // the learner can lose, and losing it is a dated event.
    const lapse = entries.find((e) => e.kind === "lapse");
    expect(lapse).toBeDefined();
    expect(lapse!.certainty).toBe("projected");
    expect(lapse!.title).toBe(`${skill.name} stops counting`);
    expect(lapse!.detail).toBe(
      "You showed this once. A few minutes on it keeps the claim.",
    );
    // Ours is the mechanism, theirs is the consequence: no half-life, no decay,
    // no curve named anywhere in what they read.
    expect(lapse!.detail).not.toMatch(/half.?life|decay/i);
  });

  it("reads against the learner's own goal and pack", async () => {
    await run();

    expect(masteryForMock).toHaveBeenCalledWith({}, "u1", pack.slug);
    expect(dueRetrievalMock).toHaveBeenCalledWith({}, "u1", pack.slug);
    expect(curriculumMock).toHaveBeenCalledWith({}, "g1");
  });
});
