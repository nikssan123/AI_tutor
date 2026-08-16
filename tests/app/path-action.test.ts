import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What is left of the build action once the building moved out of it.
 *
 * `buildCurriculumFor` is shared with the Inngest handler and is tested in
 * `tests/lib/curriculum-build.test.ts`. What this file is about is the wiring
 * the action still owns: who is allowed to press the button, and where each
 * outcome leaves them.
 *
 * §14.9.3 — "sync only where a human is waiting" — is why this is still a
 * server action at all. It is no longer the only way a path gets built:
 * `finish` in `start/actions.ts` queues one for every new goal, and this is the
 * door for a goal that predates that, and for a depth change the learner wants
 * the modules re-cut around.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const buildMock = vi.fn();
const revalidateMock = vi.fn();
const setDepthMock = vi.fn(async () => true);

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidateMock(p) }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => ({}) }));
vi.mock("@/lib/goals/store", () => ({
  setGoalDepth: (...a: unknown[]) => setDepthMock(...(a as [])),
}));
vi.mock("@/lib/curriculum/build", () => ({
  buildCurriculumFor: (...a: unknown[]) => buildMock(...(a as [])),
}));

const { buildPathAction, setDepthAction } = await import(
  "@/app/(app)/path/actions"
);

const GOAL_ID = "goal-1";

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u1" } });
  buildMock.mockResolvedValue({ built: true, source: "generated" });
});

describe("buildPathAction", () => {
  it("requires a signed-in learner", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(buildPathAction(GOAL_ID)).rejects.toThrow("REDIRECT:/sign-in");
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("builds against the signed-in learner and refreshes the page", async () => {
    await buildPathAction(GOAL_ID);

    expect(buildMock).toHaveBeenCalledTimes(1);
    const [, input] = buildMock.mock.calls[0] as [
      unknown,
      { userId: string; goalId: string },
    ];
    // The learner comes from the session, never from the argument: the goal id
    // arrives from a form and is the only thing a caller controls.
    expect(input).toEqual({ userId: "u1", goalId: GOAL_ID });
    expect(revalidateMock).toHaveBeenCalledWith("/path");
  });

  it("refuses to build a path for someone else's goal", async () => {
    buildMock.mockResolvedValue({ built: false, reason: "not-active" });
    await expect(buildPathAction("not-mine")).rejects.toThrow("REDIRECT:/today");
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("bails out when the goal's pack has left the build", async () => {
    buildMock.mockResolvedValue({ built: false, reason: "no-pack" });
    await expect(buildPathAction(GOAL_ID)).rejects.toThrow("REDIRECT:/today");
  });

  /**
   * The one failure the path screen can say something about, so it is the one
   * that re-renders rather than redirecting: the learner is still on a course,
   * and "there is nothing left to teach you" belongs on it.
   */
  it("stays on the screen when there was no path left to build", async () => {
    buildMock.mockResolvedValue({ built: false, reason: "nothing-to-teach" });

    await buildPathAction(GOAL_ID);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/path");
  });
});

describe("setDepthAction", () => {
  it("requires a signed-in learner", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(setDepthAction(GOAL_ID, "sprint")).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    expect(setDepthMock).not.toHaveBeenCalled();
  });

  it("moves the goal and refreshes both screens that price it", async () => {
    await setDepthAction(GOAL_ID, "mastery");

    expect(setDepthMock).toHaveBeenCalledWith({}, "u1", GOAL_ID, "mastery");
    // /today reads the same projection. Leaving it cached would show two
    // different courses on two screens.
    expect(revalidateMock).toHaveBeenCalledWith("/path");
    expect(revalidateMock).toHaveBeenCalledWith("/today");
  });

  /**
   * The value arrives from a form, so it is parsed rather than trusted. Writing
   * an unparseable depth would be a spec the planner later fails to read — a
   * goal that silently stops working rather than one that never changed.
   */
  it("drops a depth that is not one of the three", async () => {
    await setDepthAction(GOAL_ID, "extreme");

    expect(setDepthMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("accepts every real depth", async () => {
    for (const depth of ["sprint", "standard", "mastery"]) {
      await setDepthAction(GOAL_ID, depth);
    }
    expect(setDepthMock).toHaveBeenCalledTimes(3);
  });
});
