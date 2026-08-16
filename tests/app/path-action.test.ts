import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What is left of the build action once the building moved to the queue.
 *
 * The build itself is `buildCurriculumFor`, tested in
 * `tests/lib/curriculum-build.test.ts` and run by the Inngest handler in
 * `tests/lib/inngest.test.ts`. What this file is about is the wiring the action
 * still owns: who is allowed to press the button, that a run is claimed before
 * anything is sent, and that a dispatch nobody accepted is written down rather
 * than left to look like a build in progress.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const activeGoalMock = vi.fn();
const claimMock = vi.fn(async () => "claimed");
const finishMock = vi.fn(async () => undefined);
const sendMock = vi.fn(async () => undefined);
const revalidateMock = vi.fn();
const setDepthMock = vi.fn(async () => true);

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidateMock(p) }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/goals/store", () => ({
  activeGoal: (...a: unknown[]) => activeGoalMock(...(a as [])),
  setGoalDepth: (...a: unknown[]) => setDepthMock(...(a as [])),
}));
vi.mock("@/lib/curriculum/build-state", () => ({
  claimPathBuild: (...a: unknown[]) => claimMock(...(a as [])),
  finishPathBuild: (...a: unknown[]) => finishMock(...(a as [])),
}));
vi.mock("@/lib/inngest/client", () => ({
  EVENTS: { buildPath: "goal/path.requested" },
  inngest: { send: (...a: unknown[]) => sendMock(...(a as [])) },
}));

const { buildPathAction, setDepthAction } = await import(
  "@/app/(app)/path/actions"
);

const GOAL_ID = "goal-1";

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u1" } });
  activeGoalMock.mockResolvedValue({ id: GOAL_ID, packSlug: "photography" });
  sendMock.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("buildPathAction", () => {
  it("requires a signed-in learner", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(buildPathAction(GOAL_ID)).rejects.toThrow("REDIRECT:/sign-in");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("claims the run before handing it to the queue", async () => {
    await buildPathAction(GOAL_ID);

    // The order is the point: the row is what the screen reads, so a send that
    // succeeds against a goal with no row would be a build nobody can watch.
    expect(claimMock).toHaveBeenCalledWith({}, GOAL_ID);
    expect(sendMock).toHaveBeenCalledWith({
      name: "goal/path.requested",
      // The learner comes from the session, never from the argument.
      data: { userId: "u1", goalId: GOAL_ID },
    });
    expect(revalidateMock).toHaveBeenCalledWith("/path");
  });

  it("returns without waiting for the build", async () => {
    // Nothing in the action awaits a model call any more; the whole point of
    // the move is that the request ends while the work carries on.
    await buildPathAction(GOAL_ID);
    expect(finishMock).not.toHaveBeenCalled();
  });

  /**
   * The check `buildCurriculumFor` used to do on our behalf, brought forward.
   * It still happens in the worker, but a worker can only write the answer into
   * a row — by which time somebody posting another learner's goal id has a
   * claimed build and a wait screen for a course they cannot see.
   */
  it("refuses to build a path for someone else's goal", async () => {
    await expect(buildPathAction("not-mine")).rejects.toThrow("REDIRECT:/today");
    expect(claimMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses when the learner has no course running at all", async () => {
    activeGoalMock.mockResolvedValue(undefined);
    await expect(buildPathAction(GOAL_ID)).rejects.toThrow("REDIRECT:/today");
    expect(claimMock).not.toHaveBeenCalled();
  });

  /**
   * A learner is standing in front of this one, which is what makes it
   * different from `/start`'s dispatch of the same event: a swallowed failure
   * there costs nobody a wait, and here it would leave the screen counting up
   * to a ten-minute timeout for a run that was never queued.
   */
  it("records a dispatch nobody accepted, instead of leaving it looking live", async () => {
    sendMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await buildPathAction(GOAL_ID);

    expect(finishMock).toHaveBeenCalledTimes(1);
    const [, goalId, outcome] = finishMock.mock.calls[0] as unknown as [
      unknown,
      string,
      { status: string; detail: string },
    ];
    expect(goalId).toBe(GOAL_ID);
    expect(outcome.status).toBe("failed");
    // §4.2 law 3 — say what actually happened, including that it cost nothing.
    expect(outcome.detail).toMatch(/could not hand the build over/i);
    // Still re-rendered: the screen has the stopped state to show them.
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
