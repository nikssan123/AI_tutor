import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pause a course, stop it, or pick one back up.
 *
 * Every transition ends in a redirect, so the assertions are on what was written
 * before it — and above all on what is *not* written when the form carried
 * something the product does not recognise. Two of the three actions are hard
 * for a learner to walk back, so a defaulted one would be a real hazard rather
 * than a tidiness point.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const setGoalStatusMock = vi.fn();
const revalidateMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidateMock(...(a as [])),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/lib/goals/store", () => ({
  setGoalStatus: (...a: unknown[]) => setGoalStatusMock(...(a as [])),
}));

const { courseAction } = await import("@/lib/goals/course-actions");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  setGoalStatusMock.mockResolvedValue(true);
});

describe("who may move a course", () => {
  it("sends a signed-out visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(
      courseAction(form({ goalId: "g1", action: "pause" })),
    ).rejects.toThrow("REDIRECT:/sign-in");
    expect(setGoalStatusMock).not.toHaveBeenCalled();
  });

  /** The learner's own id, never the form's — the form is untrusted input. */
  it("moves the course as the signed-in learner", async () => {
    await expect(
      courseAction(form({ goalId: "g1", action: "pause" })),
    ).rejects.toThrow("REDIRECT:/progress");
    expect(setGoalStatusMock).toHaveBeenCalledWith({}, "u1", "g1", "paused");
  });
});

describe("what each action does", () => {
  it("puts a course aside", async () => {
    await expect(
      courseAction(form({ goalId: "g1", action: "pause" })),
    ).rejects.toThrow("REDIRECT:/progress");
    expect(setGoalStatusMock.mock.calls[0]?.[3]).toBe("paused");
  });

  it("stops a course", async () => {
    await expect(
      courseAction(form({ goalId: "g1", action: "abandon" })),
    ).rejects.toThrow("REDIRECT:/progress");
    expect(setGoalStatusMock.mock.calls[0]?.[3]).toBe("abandoned");
  });

  /** Picking one up means there is something to do, so it lands on Today. */
  it("picks a course back up and goes where the work is", async () => {
    await expect(
      courseAction(form({ goalId: "g1", action: "resume" })),
    ).rejects.toThrow("REDIRECT:/today");
    expect(setGoalStatusMock.mock.calls[0]?.[3]).toBe("active");
  });

  it("re-renders every authenticated screen, which all read the goal", async () => {
    await expect(
      courseAction(form({ goalId: "g1", action: "pause" })),
    ).rejects.toThrow("REDIRECT:/progress");
    expect(revalidateMock).toHaveBeenCalledWith("/", "layout");
  });
});

describe("what it refuses", () => {
  /**
   * A default here would pick a status on the learner's behalf. There is no
   * safe one to pick: "pause" hides the course they were working on, and
   * "abandon" is worse.
   */
  it("writes nothing for an action it does not recognise", async () => {
    await expect(
      courseAction(form({ goalId: "g1", action: "finish" })),
    ).rejects.toThrow("REDIRECT:/progress");
    expect(setGoalStatusMock).not.toHaveBeenCalled();
  });

  it("writes nothing when the form carries no goal", async () => {
    await expect(courseAction(form({ action: "pause" }))).rejects.toThrow(
      "REDIRECT:/progress",
    );
    expect(setGoalStatusMock).not.toHaveBeenCalled();
  });

  /**
   * §4.2 law 1 at course scale: `achieved` is written by the evidence and by
   * nothing else, so there is no action here that can reach it.
   */
  it("has no action that can mark a course finished", async () => {
    for (const action of ["achieve", "achieved", "finish", "complete"]) {
      setGoalStatusMock.mockClear();
      await expect(courseAction(form({ goalId: "g1", action }))).rejects.toThrow(
        "REDIRECT:/progress",
      );
      expect(setGoalStatusMock).not.toHaveBeenCalled();
    }
  });
});
