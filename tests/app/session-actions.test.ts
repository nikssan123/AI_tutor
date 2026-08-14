import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionBlock } from "@/lib/engine";

/**
 * The session runner's transitions.
 *
 * Every one ends in a redirect, so the assertions are on what was written
 * before it — and, as often, on what was *not* written when the post was stale.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const requireUserMock = vi.fn();
const todayForMock = vi.fn();
const startSessionMock = vi.fn();
const sessionByIdMock = vi.fn();
const advanceMock = vi.fn();
const completeMock = vi.fn();
const recordResponseMock = vi.fn();
const answerCheckMock = vi.fn();
const activeGoalMock = vi.fn();
const masteryForMock = vi.fn();
const gradeCheckMock = vi.fn();
const appendBlocksMock = vi.fn();
const recentSignalsMock = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => ({}) }));
// The disk half of `resolvePack` runs for real against `findPack`; the database
// half has no stub db to look in, so a miss on disk is a miss outright.
vi.mock("@/lib/packs/read", () => ({ packFromDb: async () => undefined }));
vi.mock("@/lib/account/session", () => ({
  requireUser: () => requireUserMock(),
}));
vi.mock("@/lib/goals/today", () => ({
  todayFor: (...a: unknown[]) => todayForMock(...(a as [])),
}));
vi.mock("@/lib/goals/store", () => ({
  activeGoal: (...a: unknown[]) => activeGoalMock(...(a as [])),
  masteryFor: (...a: unknown[]) => masteryForMock(...(a as [])),
}));
vi.mock("@/lib/session/run", () => ({
  answerCheck: (...a: unknown[]) => answerCheckMock(...(a as [])),
}));
vi.mock("@/lib/session/grade", () => ({
  gradeCheck: (...a: unknown[]) => gradeCheckMock(...(a as [])),
}));
vi.mock("@/lib/session/store", () => ({
  startSession: (...a: unknown[]) => startSessionMock(...(a as [])),
  sessionById: (...a: unknown[]) => sessionByIdMock(...(a as [])),
  advance: (...a: unknown[]) => advanceMock(...(a as [])),
  completeSession: (...a: unknown[]) => completeMock(...(a as [])),
  recordResponse: (...a: unknown[]) => recordResponseMock(...(a as [])),
  appendBlocks: (...a: unknown[]) => appendBlocksMock(...(a as [])),
  recentSignals: (...a: unknown[]) => recentSignalsMock(...(a as [])),
}));

const {
  answerAction,
  continueAction,
  finishAction,
  noteAction,
  proveAction,
  startSessionAction,
} = await import("@/app/(app)/session/[id]/actions");

const PACK = "sql-data-analysis";
const SESSION_ID = "sess-1";

const checkBlock: SessionBlock = {
  type: "check",
  skillId: "select-projection",
  prompt: "In your own words?",
  expected: "e",
  isRetrieval: false,
  itemId: null,
  estMinutes: 5,
};

const stored = (over: Partial<{ blockIndex: number; blocks: SessionBlock[] }> = {}) => ({
  id: SESSION_ID,
  userId: "u1",
  goalId: "g1",
  planId: "p1",
  blocks: over.blocks ?? [checkBlock],
  blockIndex: over.blockIndex ?? 0,
  responses: [],
  startedAt: new Date(),
  completedAt: null,
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "u1" });
  activeGoalMock.mockResolvedValue({ id: "g1", packSlug: PACK });
  masteryForMock.mockResolvedValue([]);
  sessionByIdMock.mockResolvedValue(stored());
  startSessionMock.mockResolvedValue({ id: SESSION_ID });
  answerCheckMock.mockResolvedValue({});
  appendBlocksMock.mockResolvedValue(stored());
  recentSignalsMock.mockResolvedValue([]);
  todayForMock.mockResolvedValue({
    goal: { id: "g1" },
    session: { blocks: [checkBlock], plannedFor: "2026-08-13" },
  });
});

describe("startSessionAction", () => {
  it("plans, starts, and sends the learner to the session", async () => {
    await expect(startSessionAction()).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);
    expect(startSessionMock).toHaveBeenCalledOnce();
  });

  it("goes back to today when there is nothing to plan", async () => {
    todayForMock.mockResolvedValue(undefined);
    await expect(startSessionAction()).rejects.toThrow("REDIRECT:/today");
    expect(startSessionMock).not.toHaveBeenCalled();
  });
});

describe("answerAction", () => {
  it("grades the block the learner is actually on", async () => {
    await expect(
      answerAction(SESSION_ID, form({ block: "0", answer: "my answer" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);

    expect(answerCheckMock).toHaveBeenCalledOnce();
    expect(answerCheckMock.mock.calls[0]![0]).toMatchObject({
      answer: "my answer",
      blockIndex: 0,
      packSlug: PACK,
    });
  });

  it("passes the learner's existing mastery rather than a fresh one", async () => {
    const held = { skillId: "select-projection", mastery: 0.6, confidence: 0.5,
      evidenceCount: 3, lastSuccessAt: null, lastPracticedAt: null, decayHalfLifeDays: 7 };
    masteryForMock.mockResolvedValue([held]);

    await expect(
      answerAction(SESSION_ID, form({ block: "0", answer: "x" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);

    expect(answerCheckMock.mock.calls[0]![0]).toMatchObject({ mastery: held });
  });

  it("hands the runner a grader that reaches the fast tier", async () => {
    // The grader is injected so the loop is testable without a network; this
    // asserts the injection is wired to the real one rather than to nothing.
    await expect(
      answerAction(SESSION_ID, form({ block: "0", answer: "x" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);

    const { grade } = answerCheckMock.mock.calls[0]![0] as {
      grade: (r: unknown) => Promise<unknown>;
    };
    await grade({ question: "q", expected: "e", answer: "a" });
    expect(gradeCheckMock).toHaveBeenCalledOnce();
  });

  it("drops a post against a block the learner has moved past", async () => {
    // A stale tab, or the back button after answering. Recording it would
    // overwrite an answer with an older one.
    sessionByIdMock.mockResolvedValue(stored({ blockIndex: 1 }));
    await expect(
      answerAction(SESSION_ID, form({ block: "0", answer: "again" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);
    expect(answerCheckMock).not.toHaveBeenCalled();
  });

  it("treats a form with no answer field as an empty answer", async () => {
    await expect(
      answerAction(SESSION_ID, form({ block: "0" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);
    expect(answerCheckMock.mock.calls[0]![0]).toMatchObject({ answer: "" });
  });

  it("drops a post against a block that is not a check", async () => {
    sessionByIdMock.mockResolvedValue(
      stored({ blocks: [{ type: "reflect", prompt: "p", estMinutes: 5 }] }),
    );
    await expect(
      answerAction(SESSION_ID, form({ block: "0", answer: "x" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);
    expect(answerCheckMock).not.toHaveBeenCalled();
  });

  it("goes back to today when the session is not the learner's", async () => {
    sessionByIdMock.mockResolvedValue(undefined);
    await expect(
      answerAction(SESSION_ID, form({ block: "0", answer: "x" })),
    ).rejects.toThrow("REDIRECT:/today");
  });

  it("goes back to today when the goal or its pack has gone", async () => {
    activeGoalMock.mockResolvedValue(undefined);
    await expect(
      answerAction(SESSION_ID, form({ block: "0", answer: "x" })),
    ).rejects.toThrow("REDIRECT:/today");
    expect(answerCheckMock).not.toHaveBeenCalled();
  });

  it("stays put when the block names a skill the pack no longer has", async () => {
    sessionByIdMock.mockResolvedValue(
      stored({ blocks: [{ ...checkBlock, skillId: "ghost" }] }),
    );
    await expect(
      answerAction(SESSION_ID, form({ block: "0", answer: "x" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);
    expect(answerCheckMock).not.toHaveBeenCalled();
  });
});

describe("continueAction", () => {
  it("moves the cursor", async () => {
    await expect(
      continueAction(SESSION_ID, form({ to: "1" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);
    expect(advanceMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1);
  });

  it("goes back to today for a session that is not there", async () => {
    sessionByIdMock.mockResolvedValue(undefined);
    await expect(continueAction(SESSION_ID, form({ to: "1" }))).rejects.toThrow(
      "REDIRECT:/today",
    );
    expect(advanceMock).not.toHaveBeenCalled();
  });
});

describe("noteAction", () => {
  it("saves a reflection without marking it", async () => {
    sessionByIdMock.mockResolvedValue(
      stored({ blocks: [{ type: "reflect", prompt: "p", estMinutes: 5 }] }),
    );

    await expect(
      noteAction(SESSION_ID, form({ block: "0", answer: "it was hard" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);

    const response = recordResponseMock.mock.calls[0]![2] as {
      answer: string;
      correct: null;
      gradedBy: string;
      evidenceTier: null;
    };
    expect(response.answer).toBe("it was hard");
    // §7.2 — self-report is Tier 5, and Tier 5 never moves the record.
    expect(response.correct).toBeNull();
    expect(response.gradedBy).toBe("self");
    expect(response.evidenceTier).toBeNull();
  });

  it("saves an empty reflection rather than dropping the post", async () => {
    sessionByIdMock.mockResolvedValue(
      stored({ blocks: [{ type: "reflect", prompt: "p", estMinutes: 5 }] }),
    );

    await expect(
      noteAction(SESSION_ID, form({ block: "0" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);
    expect(
      (recordResponseMock.mock.calls[0]![2] as { answer: string }).answer,
    ).toBe("");
  });

  it("ignores a reflection posted against another block", async () => {
    sessionByIdMock.mockResolvedValue(stored({ blockIndex: 1 }));
    await expect(
      noteAction(SESSION_ID, form({ block: "0", answer: "x" })),
    ).rejects.toThrow(`REDIRECT:/session/${SESSION_ID}`);
    expect(recordResponseMock).not.toHaveBeenCalled();
  });

  it("goes back to today for a session that is not there", async () => {
    sessionByIdMock.mockResolvedValue(undefined);
    await expect(noteAction(SESSION_ID, form({ block: "0" }))).rejects.toThrow(
      "REDIRECT:/today",
    );
  });
});

describe("finishAction", () => {
  it("completes the session and returns to today", async () => {
    await expect(finishAction(SESSION_ID)).rejects.toThrow("REDIRECT:/today");
    expect(completeMock).toHaveBeenCalledOnce();
  });

  it("goes back to today for a session that is not there", async () => {
    sessionByIdMock.mockResolvedValue(undefined);
    await expect(finishAction(SESSION_ID)).rejects.toThrow("REDIRECT:/today");
    expect(completeMock).not.toHaveBeenCalled();
  });
});

/**
 * PLAN-ADAPTATION step 4 — accepting the offer buys questions and nothing else.
 *
 * The assertions that matter are the negative ones: no mastery is written, no
 * skill is skipped, and a post with no signal behind it gets nothing.
 */
describe("proveAction", () => {
  const CLAIMED = "select-projection";

  function claimed() {
    recentSignalsMock.mockResolvedValue([
      { skillSlug: CLAIMED, signal: "already_knows" },
    ]);
  }

  it("appends real questions on the claimed skill", async () => {
    claimed();

    await expect(proveAction(SESSION_ID)).rejects.toThrow(
      `REDIRECT:/session/${SESSION_ID}`,
    );

    expect(appendBlocksMock).toHaveBeenCalledTimes(1);
    const blocks = appendBlocksMock.mock.calls[0]![2] as SessionBlock[];
    expect(blocks.length).toBeGreaterThan(0);
    expect(
      blocks.every(
        (b) => b.type === "check" && b.skillId === CLAIMED && b.itemId !== null,
      ),
    ).toBe(true);
  });

  /**
   * The whole design in one assertion. A tutor's impression of a conversation
   * buys an assessment; it may not buy a result.
   */
  it("moves no mastery and grades nothing", async () => {
    claimed();

    await expect(proveAction(SESSION_ID)).rejects.toThrow("REDIRECT:");

    expect(answerCheckMock).not.toHaveBeenCalled();
    expect(gradeCheckMock).not.toHaveBeenCalled();
    expect(recordResponseMock).not.toHaveBeenCalled();
    expect(advanceMock).not.toHaveBeenCalled();
  });

  /**
   * A posted request is not a claim. Without a signal behind it, a learner
   * could otherwise conjure free questions on any skill they named — which is
   * harmless on its own and is exactly how the offer would stop meaning
   * anything.
   */
  it("gives nothing to a learner who was never heard to claim it", async () => {
    recentSignalsMock.mockResolvedValue([]);

    await expect(proveAction(SESSION_ID)).rejects.toThrow("REDIRECT:");
    expect(appendBlocksMock).not.toHaveBeenCalled();
  });

  it("gives nothing the second time", async () => {
    claimed();
    sessionByIdMock.mockResolvedValue(
      stored({ blocks: [checkBlock, { ...checkBlock, itemId: "already" }] }),
    );

    await expect(proveAction(SESSION_ID)).rejects.toThrow("REDIRECT:");
    expect(appendBlocksMock).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor away without touching the session", async () => {
    requireUserMock.mockRejectedValue(new Error("REDIRECT:/sign-in"));

    await expect(proveAction(SESSION_ID)).rejects.toThrow("REDIRECT:/sign-in");
    expect(appendBlocksMock).not.toHaveBeenCalled();
  });

  it("bails out when the session is not the learner's", async () => {
    sessionByIdMock.mockResolvedValue(undefined);

    await expect(proveAction(SESSION_ID)).rejects.toThrow("REDIRECT:/today");
    expect(appendBlocksMock).not.toHaveBeenCalled();
  });

  it("bails out when no course is running", async () => {
    claimed();
    activeGoalMock.mockResolvedValue(undefined);

    await expect(proveAction(SESSION_ID)).rejects.toThrow("REDIRECT:/today");
    expect(appendBlocksMock).not.toHaveBeenCalled();
  });

  it("bails out when the goal's pack has left the build", async () => {
    activeGoalMock.mockResolvedValue({ id: "g1", packSlug: "deleted-pack" });

    await expect(proveAction(SESSION_ID)).rejects.toThrow("REDIRECT:/today");
    expect(appendBlocksMock).not.toHaveBeenCalled();
  });
});
