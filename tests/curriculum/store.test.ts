import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import { curriculum, curriculumModule, user } from "@/db/schema";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { rubricId as packRubricId } from "@/lib/packs/ids";
import { createGoal } from "@/lib/goals/store";
import { currentCurriculum, saveCurriculum } from "@/lib/curriculum/store";
import type { CurriculumDraft } from "@/lib/contracts/curriculum";
import type { GoalSpec } from "@/lib/contracts/goal";
import type { ValidatorReport } from "@/lib/contracts/curriculum";

/**
 * §14.4 — "the curriculum is a cached projection of the plan, never the source
 * of truth." So versions accumulate and nothing is overwritten: a learner three
 * weeks in is entitled to see that the path changed, and when.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const PACK = "sql-data-analysis";
const NOW = new Date("2026-08-13T09:00:00.000Z");

const draft: CurriculumDraft = {
  modules: [
    {
      order: 0,
      title: "First",
      targetSkillIds: ["a"],
      estimatedHours: 3,
      outputArtifact: "exercise",
      acceptanceCriteria: ["do a"],
      rubricId: null,
    },
    {
      order: 1,
      title: "Second",
      targetSkillIds: ["b", "c"],
      estimatedHours: 4,
      outputArtifact: "none",
      acceptanceCriteria: [],
      rubricId: null,
    },
    {
      order: 2,
      title: "Prove it",
      targetSkillIds: ["c"],
      estimatedHours: 2,
      outputArtifact: "project",
      acceptanceCriteria: ["submit it"],
      rubricId: "some-rubric",
    },
  ],
  totalHours: 9,
  rationale: "because",
};

const report: ValidatorReport = {
  passed: true,
  checks: [
    {
      name: "prereq_completeness",
      passed: true,
      severity: "blocking",
      detail: "fine",
      repair: null,
    },
  ],
};

const spec: GoalSpec = {
  rawGoal: "learn sql",
  domain: PACK,
  targetOutcome: "SQL",
  outcomeType: "career",
  statedLevel: "beginner",
  weeklyHours: 4,
  deadline: null,
  motivation: "",
  constraints: [],
  existingAssets: [],
  clarity: 1,
};

live("the curriculum store", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const users: string[] = [];

  async function newGoal(): Promise<string> {
    const id = `test-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "T", email: `${id}@example.test` });
    return createGoal(db, {
      userId: id,
      packSlug: PACK,
      spec,
      mastery: [],
      now: NOW,
    });
  }

  beforeAll(async () => {
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  it("stores the modules in order, with the report", async () => {
    const goalId = await newGoal();
    const id = await saveCurriculum(db, {
      goalId,
      packSlug: PACK,
      draft,
      report,
      source: "generated",
      now: NOW,
    });

    const stored = await currentCurriculum(db, goalId);
    expect(stored?.id).toBe(id);
    expect(stored?.version).toBe(1);
    expect(stored?.status).toBe("active");
    expect(stored?.report?.checks).toHaveLength(1);
    expect(stored?.modules.map((m) => m.title)).toEqual([
      "First",
      "Second",
      "Prove it",
    ]);
    expect(stored?.modules[1]!.targetSkillIds).toEqual(["b", "c"]);
  });

  it("resolves a pack rubric slug to its deterministic id", async () => {
    const goalId = await newGoal();
    const id = await saveCurriculum(db, {
      goalId,
      packSlug: PACK,
      draft,
      report,
      source: "generated",
      now: NOW,
    });

    const rows = await db
      .select()
      .from(curriculumModule)
      .where(eq(curriculumModule.curriculumId, id));

    const project = rows.find((r) => r.outputArtifactType === "project")!;
    // Same slug/uuid seam as the mastery store, resolved in exactly one place.
    expect(project.rubricId).toBe(packRubricId(PACK, "some-rubric"));
    expect(rows.filter((r) => r.rubricId === null)).toHaveLength(2);
  });

  it("supersedes the previous version rather than deleting it", async () => {
    const goalId = await newGoal();
    await saveCurriculum(db, {
      goalId, packSlug: PACK, draft, report, source: "generated", now: NOW,
    });
    await saveCurriculum(db, {
      goalId,
      packSlug: PACK,
      draft: { ...draft, rationale: "second pass" },
      report,
      source: "repaired",
      now: NOW,
    });

    const all = await db
      .select()
      .from(curriculum)
      .where(eq(curriculum.goalId, goalId));

    expect(all).toHaveLength(2);
    expect(all.filter((c) => c.status === "superseded")).toHaveLength(1);

    const stored = await currentCurriculum(db, goalId);
    expect(stored?.version).toBe(2);
    expect(stored?.status).toBe("active");
  });

  it("marks a canonical fallback as validated, not active", async () => {
    const goalId = await newGoal();
    await saveCurriculum(db, {
      goalId, packSlug: PACK, draft, report, source: "canonical", now: NOW,
    });
    expect((await currentCurriculum(db, goalId))?.status).toBe("validated");
  });

  it("has nothing to show before anything is generated", async () => {
    expect(await currentCurriculum(db, await newGoal())).toBeUndefined();
  });

  it("stores a curriculum saved with no report at all", async () => {
    const goalId = await newGoal();
    await saveCurriculum(db, {
      goalId, packSlug: PACK, draft, report: null, source: "generated", now: NOW,
    });
    expect((await currentCurriculum(db, goalId))?.report).toBeNull();
  });

  it("survives a report written by an older shape of the contract", async () => {
    // The page's job is to explain the curriculum; crashing on a stale report
    // would take the explanation down with it.
    const goalId = await newGoal();
    const id = await saveCurriculum(db, {
      goalId, packSlug: PACK, draft, report: null, source: "generated", now: NOW,
    });
    await db
      .update(curriculum)
      .set({ validatorReport: { legacy: true } })
      .where(eq(curriculum.id, id));

    const stored = await currentCurriculum(db, goalId);
    expect(stored?.report).toBeNull();
    expect(stored?.modules).toHaveLength(3);
  });

  it("reads a module stored with no acceptance criteria", async () => {
    const goalId = await newGoal();
    const id = await saveCurriculum(db, {
      goalId, packSlug: PACK, draft, report, source: "generated", now: NOW,
    });
    await db
      .update(curriculumModule)
      .set({ acceptanceCriteria: null })
      .where(eq(curriculumModule.curriculumId, id));

    const stored = await currentCurriculum(db, goalId);
    expect(stored?.modules).toHaveLength(3);
    expect(stored?.modules[0]!.acceptanceCriteria).toEqual([]);
  });

  it("drops a stored module the contract no longer accepts", async () => {
    const goalId = await newGoal();
    const id = await saveCurriculum(db, {
      goalId, packSlug: PACK, draft, report, source: "generated", now: NOW,
    });
    await db
      .update(curriculumModule)
      .set({ outputArtifactType: "hologram" })
      .where(eq(curriculumModule.curriculumId, id));

    // Every module now fails the contract, so none are shown — better than
    // rendering a module whose type nothing downstream knows how to handle.
    expect((await currentCurriculum(db, goalId))?.modules).toEqual([]);
  });
});
