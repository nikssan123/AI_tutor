import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §14.9.3 — "sync only where a human is waiting."
 *
 * Generation is deliberately not on the goal form: creating a goal stays
 * instant, and the minute-long wait happens where the learner asked for it.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const activeGoalMock = vi.fn();
const generateMock = vi.fn();
const saveMock = vi.fn(async () => "curriculum-1");
const revalidateMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidateMock(p) }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
// These exercise the disk half of `resolvePack` with the real `findPack`. The
// database half has nothing to find and no stub db to find it with, so a miss
// on disk is a miss outright — which is what "not a real pack" means here.
vi.mock("@/lib/packs/read", () => ({ packFromDb: async () => undefined }));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => ({}) }));
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

const { buildPathAction } = await import("@/app/(app)/goals/[id]/path/actions");

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
    clarity: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u1" } });
  activeGoalMock.mockResolvedValue(goal);
  generateMock.mockResolvedValue({
    draft: { modules: [], totalHours: 0, rationale: "" },
    report: { passed: true, checks: [] },
    source: "generated",
    repairs: [],
    attempts: 1,
  });
});

describe("buildPathAction", () => {
  it("requires a signed-in learner", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(buildPathAction(GOAL_ID)).rejects.toThrow("REDIRECT:/sign-in");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("refuses to build a path for someone else's goal", async () => {
    await expect(buildPathAction("not-mine")).rejects.toThrow("REDIRECT:/today");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("bails out when the goal's pack has left the build", async () => {
    activeGoalMock.mockResolvedValue({ ...goal, packSlug: "deleted-pack" });
    await expect(buildPathAction(GOAL_ID)).rejects.toThrow("REDIRECT:/today");
  });

  it("generates, saves, and refreshes the page", async () => {
    await buildPathAction(GOAL_ID);

    expect(generateMock).toHaveBeenCalledTimes(1);
    const [deps, input] = generateMock.mock.calls[0] as [
      { userId: string; plan: string; projects: unknown[] },
      { rawGoal: string; rubricCriteria: Map<string, number> },
    ];

    expect(deps.userId).toBe("u1");
    // §14.9.7's cap is real from the first commit — a runaway does not wait
    // for a pricing page.
    expect(deps.plan).toBe("free");
    expect(deps.projects.length).toBeGreaterThan(0);
    expect(input.rawGoal).toBe("shoot in manual");
    expect(input.rubricCriteria.size).toBeGreaterThan(0);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledWith(`/goals/${GOAL_ID}/path`);
  });

  it("saves nothing when there was no path to build", async () => {
    generateMock.mockResolvedValue({
      draft: null,
      report: null,
      source: "none",
      repairs: [],
      attempts: 2,
    });

    await buildPathAction(GOAL_ID);
    expect(saveMock).not.toHaveBeenCalled();
    // The page still refreshes, so the learner sees the current state rather
    // than a button that appears to have done nothing.
    expect(revalidateMock).toHaveBeenCalled();
  });
});
