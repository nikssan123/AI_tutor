import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one place a goal is cut into modules, whoever asked.
 *
 * These assertions used to live in `tests/app/path-action.test.ts`, because the
 * work used to live in the server action — which is precisely why the queue
 * could not do it and why no goal ever got a path unless its owner found a
 * button nothing linked to. What is tested here is the shared function; the
 * action and the Inngest handler are thin enough to be tested as wiring.
 */

const activeGoalMock = vi.fn();
const generateMock = vi.fn();
const saveMock = vi.fn(async (..._a: unknown[]) => "curriculum-1");
const entitlementsMock = vi.fn();

// These exercise the disk half of `resolvePack` with the real `findPack`. The
// database half has nothing to find and no stub db to find it with, so a miss
// on disk is a miss outright — which is what "not a real pack" means here.
vi.mock("@/lib/packs/read", () => ({ packFromDb: async () => undefined }));
vi.mock("@/lib/billing/store", () => ({
  entitlementsForUser: (...a: unknown[]) => entitlementsMock(...(a as [])),
}));
vi.mock("@/lib/goals/store", () => ({
  activeGoal: (...a: unknown[]) => activeGoalMock(...(a as [])),
  masteryFor: async () => [],
}));
vi.mock("@/lib/curriculum/generate", () => ({
  generateValidatedCurriculum: (...a: unknown[]) => generateMock(...(a as [])),
}));
vi.mock("@/lib/curriculum/store", () => ({
  saveCurriculum: (...a: unknown[]) => saveMock(...(a as [])),
}));

const { buildCurriculumFor } = await import("@/lib/curriculum/build");

const GOAL_ID = "goal-1";
const goal = {
  id: GOAL_ID,
  packSlug: "photography",
  createdAt: new Date(),
  spec: {
    rawGoal: "shoot in manual",
    domain: "photography",
    targetOutcome: "Photography",
    outcomeType: "personal",
    statedLevel: "beginner",
    weeklyHours: 4,
    deadline: null,
    motivation: "",
    constraints: [],
    existingAssets: [],
    depth: "standard",
    clarity: 1,
  },
};

const deps = { db: {} as never, client: {} as never };
const input = { userId: "u1", goalId: GOAL_ID };

beforeEach(() => {
  vi.clearAllMocks();
  activeGoalMock.mockResolvedValue(goal);
  entitlementsMock.mockResolvedValue({
    planId: "free",
    entitlements: { aiCurriculum: true },
    spendCapCents: 100,
    source: "plan",
  });
  generateMock.mockResolvedValue({
    draft: { modules: [], totalHours: 0, rationale: "" },
    report: { passed: true, checks: [] },
    source: "generated",
    repairs: [],
    attempts: 1,
  });
});

describe("buildCurriculumFor", () => {
  it("generates and saves against the learner's own goal", async () => {
    const outcome = await buildCurriculumFor(deps, input);

    expect(outcome).toEqual({ built: true, source: "generated" });
    expect(generateMock).toHaveBeenCalledTimes(1);

    const [generateDeps, architect] = generateMock.mock.calls[0] as [
      { userId: string; plan: string; aiCurriculum: boolean; projects: unknown[] },
      { rawGoal: string; rubricCriteria: Map<string, number> },
    ];

    expect(generateDeps.userId).toBe("u1");
    // §14.9.7's cap is real from the first commit — a runaway does not wait
    // for a pricing page.
    expect(generateDeps.plan).toBe("free");
    expect(generateDeps.projects.length).toBeGreaterThan(0);
    expect(architect.rawGoal).toBe("shoot in manual");
    expect(architect.rubricCriteria.size).toBeGreaterThan(0);

    expect(saveMock).toHaveBeenCalledTimes(1);
    const [, saved] = saveMock.mock.calls[0] as [
      unknown,
      { goalId: string; packSlug: string; source: string },
    ];
    expect(saved).toMatchObject({
      goalId: GOAL_ID,
      packSlug: "photography",
      source: "generated",
    });
  });

  /**
   * The flag that decides whether a model is asked at all. A free plan gets
   * `canonicalCurriculum`, which is arithmetic over the skill graph and costs
   * nothing — passing the entitlement through is what makes that true, and
   * dropping it would put §20.2's dearest one-off on the free tier.
   */
  it("passes the plan's curriculum entitlement through", async () => {
    entitlementsMock.mockResolvedValue({
      planId: "free",
      entitlements: { aiCurriculum: false },
      spendCapCents: 100,
      source: "plan",
    });

    await buildCurriculumFor(deps, input);

    const [generateDeps] = generateMock.mock.calls[0] as [{ aiCurriculum: boolean }];
    expect(generateDeps.aiCurriculum).toBe(false);
  });

  /**
   * The check that matters more from the queue than it ever did from the
   * button: an event can arrive after the learner has put that course aside,
   * and a background job is exactly where money gets spent on a course nobody
   * is taking.
   */
  it("builds nothing for a goal that is not the active one", async () => {
    const outcome = await buildCurriculumFor(deps, { ...input, goalId: "not-mine" });

    expect(outcome).toEqual({ built: false, reason: "not-active" });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("builds nothing when there is no active goal at all", async () => {
    activeGoalMock.mockResolvedValue(undefined);

    const outcome = await buildCurriculumFor(deps, input);

    expect(outcome).toEqual({ built: false, reason: "not-active" });
    expect(generateMock).not.toHaveBeenCalled();
  });

  /** A goal outliving the pack it was created against is a deployment event. */
  it("builds nothing when the goal's pack has left the build", async () => {
    activeGoalMock.mockResolvedValue({ ...goal, packSlug: "deleted-pack" });

    const outcome = await buildCurriculumFor(deps, input);

    expect(outcome).toEqual({ built: false, reason: "no-pack" });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("saves nothing when there was no path to build", async () => {
    generateMock.mockResolvedValue({
      draft: null,
      report: null,
      source: "none",
      repairs: [],
      attempts: 2,
    });

    const outcome = await buildCurriculumFor(deps, input);

    expect(outcome).toEqual({ built: false, reason: "nothing-to-teach" });
    expect(saveMock).not.toHaveBeenCalled();
  });
});
