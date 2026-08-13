// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SessionBlock } from "@/lib/engine";
import type { BlockResponse } from "@/lib/contracts/session";

/**
 * §8 screen 7, as a learner meets it.
 *
 * The engine decides what a session contains and the grader decides what an
 * answer was worth; what is tested here is that the screen says the same thing
 * they did. A page that showed "marked correct" over an answer nothing marked
 * would be §4.2 law 3 failing in the one place it is visible.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const sessionViewMock = vi.fn();
const lessonForBlockMock = vi.fn();
const hasApiKeyMock = vi.fn(() => true);

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/ai/client", () => ({
  getAnthropic: () => ({}),
  hasApiKey: () => hasApiKeyMock(),
}));
vi.mock("@/lib/account/session", () => ({
  requireUser: async () => ({ id: "u1", email: "l@example.test" }),
}));
vi.mock("@/lib/session/view", () => ({
  sessionView: (...a: unknown[]) => sessionViewMock(...(a as [])),
  lessonForBlock: (...a: unknown[]) => lessonForBlockMock(...(a as [])),
}));
vi.mock("@/lib/session/tutor", () => ({ transcriptFor: async () => [] }));
vi.mock("@/app/(app)/session/[id]/actions", () => ({
  answerAction: vi.fn(),
  continueAction: vi.fn(),
  finishAction: vi.fn(),
  noteAction: vi.fn(),
}));
vi.mock("@/app/(app)/session/[id]/tutor-panel", () => ({
  TutorPanel: () => <div>tutor panel</div>,
}));

const SessionPage = (await import("@/app/(app)/session/[id]/page")).default;

const skill = {
  id: "join-grain",
  slug: "join-grain",
  name: "Join grain",
  level: "core" as const,
  evalTier: 1 as const,
  estimatedHours: 2,
  bktPriors: { pInit: 0.15, pLearn: 0.15, pSlip: 0.1, pGuess: 0.2 },
  canDoStatement: "explain what decides a join's row count",
  area: "modelling",
};

const mastery = {
  skillId: skill.id,
  mastery: 0.4,
  confidence: 0.4,
  evidenceCount: 2,
  lastSuccessAt: null,
  lastPracticedAt: null,
  decayHalfLifeDays: 7,
};

const lesson = {
  objective: "Know what sets the row count.",
  sections: [{ heading: "Grain", body: "One row per what?" }],
  workedExample: "Join orders to items and count.",
  commonMistake: "Assuming the left table's row count survives.",
};

function view(over: {
  blocks?: SessionBlock[];
  blockIndex?: number;
  response?: BlockResponse;
  completedAt?: Date | null;
} = {}) {
  const blocks = over.blocks ?? [
    { type: "explain", skillId: skill.id, content: "c", estMinutes: 10 },
  ];
  const blockIndex = over.blockIndex ?? 0;

  return {
    session: {
      id: "sess-1",
      userId: "u1",
      goalId: "g1",
      planId: "p1",
      blocks,
      blockIndex,
      responses: over.response ? [over.response] : [],
      startedAt: new Date(),
      completedAt: over.completedAt ?? null,
    },
    goal: { id: "g1", packSlug: "sql-data-analysis" },
    pack: { name: "SQL for data analysis" },
    block: blocks[blockIndex],
    skill,
    mastery,
    skillNames: new Map([[skill.id, skill.name]]),
    response: over.response,
    learnerContext: "## Learner",
    finished: blockIndex >= blocks.length,
  };
}

const params = Promise.resolve({ id: "sess-1" });
const search = Promise.resolve({});

/** Renders the page and any async children it streamed behind Suspense. */
async function show(node: React.ReactElement) {
  render(node);
}

beforeEach(() => {
  vi.clearAllMocks();
  hasApiKeyMock.mockReturnValue(true);
  sessionViewMock.mockResolvedValue(view());
  lessonForBlockMock.mockResolvedValue({ content: lesson, cached: true });
});

afterEach(cleanup);

describe("the session screen", () => {
  it("sends a learner with no such session back to today", async () => {
    sessionViewMock.mockResolvedValue(undefined);
    await expect(SessionPage({ params, searchParams: search })).rejects.toThrow("REDIRECT:/today");
  });

  it("shows where the learner is in the session", async () => {
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(/Block 1 of 1/)).toBeDefined();
    expect(screen.getByText("Join grain")).toBeDefined();
  });

  it("renders an explain block's can-do statement", async () => {
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(skill.canDoStatement)).toBeDefined();
  });

  it("offers a box to answer a check", async () => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "check",
            skillId: skill.id,
            prompt: "What decides the row count?",
            expected: "the grain",
            isRetrieval: false,
            itemId: null,
            estMinutes: 5,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("What decides the row count?")).toBeDefined();
    expect(screen.getByLabelText("Your answer")).toBeDefined();
  });

  const answered = (correct: boolean | null, gradedBy: BlockResponse["gradedBy"]) =>
    view({
      blocks: [
        {
          type: "check",
          skillId: skill.id,
          prompt: "What decides the row count?",
          expected: "the grain",
          isRetrieval: false,
          itemId: null,
          estMinutes: 5,
        },
      ],
      response: {
        blockIndex: 0,
        answer: "the grain",
        correct,
        gradedBy,
        feedback: correct === null ? "" : "You named the grain.",
        evidenceTier: correct === null ? null : 2,
        at: "2026-08-13T09:00:00.000Z",
      },
    });

  it("says which of the three things happened to an answer", async () => {
    // Marked right, marked wrong, and not marked at all are three different
    // claims. Collapsing the third into either of the others is how a product
    // ends up claiming evidence it never had.
    sessionViewMock.mockResolvedValue(answered(true, "model"));
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("Marked correct")).toBeDefined();
    cleanup();

    sessionViewMock.mockResolvedValue(answered(false, "model"));
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("Not right yet")).toBeDefined();
    cleanup();

    sessionViewMock.mockResolvedValue(answered(null, "ungraded"));
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(/doesn.t count/)).toBeDefined();
  });

  it("says so when the answer was left blank", async () => {
    const blank = answered(false, "self");
    blank.session.responses[0]!.answer = "";
    blank.response!.answer = "";
    sessionViewMock.mockResolvedValue(blank);

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(/left this one blank/)).toBeDefined();
  });

  it("takes the work, now that there is something to take it", async () => {
    // This used to assert the opposite — §4.2 law 5, a declared limit that was
    // real. E8 made it untrue, so the assertion changed with the behaviour.
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "apply",
            skillId: skill.id,
            brief: "Write the query",
            rubricId: null,
            evidenceType: "sql",
            estMinutes: 15,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByPlaceholderText("Paste your work here…")).toBeDefined();
    expect(screen.getByRole("button", { name: "Hand it in" })).toBeDefined();
    // Nothing bounced, so nothing is being explained.
    expect(screen.queryByText(/nothing in the box/)).toBeNull();
  });

  it("says why a hand-in of nothing but whitespace bounced", async () => {
    /*
     * `required` does not catch it: a box of spaces satisfies the browser, then
     * trims to empty on the server. Found by handing in whitespace against the
     * running app — the redirect carried `?error=empty` and the page ignored
     * it, so the work appeared to vanish with no explanation.
     */
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "apply",
            skillId: skill.id,
            brief: "Write the query",
            rubricId: null,
            evidenceType: "sql",
            estMinutes: 15,
          },
        ],
      }),
    );

    await show(
      await SessionPage({
        params,
        searchParams: Promise.resolve({ error: "empty" }),
      }),
    );
    expect(screen.getByText(/nothing in the box to mark/)).toBeDefined();
  });

  it("keeps a reflection without marking it", async () => {
    sessionViewMock.mockResolvedValue(
      view({ blocks: [{ type: "reflect", prompt: "How did that go?", estMinutes: 5 }] }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByLabelText("Your reflection")).toBeDefined();
    expect(screen.getByText(/not counted as evidence/)).toBeDefined();
  });

  it("shows a saved reflection back", async () => {
    sessionViewMock.mockResolvedValue({
      ...view({ blocks: [{ type: "reflect", prompt: "How did that go?", estMinutes: 5 }] }),
      response: {
        blockIndex: 0,
        answer: "harder than it looked",
        correct: null,
        gradedBy: "self" as const,
        feedback: "",
        evidenceTier: null,
        at: "2026-08-13T09:00:00.000Z",
      },
    });

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("harder than it looked")).toBeDefined();
  });

  it("says a skipped reflection was skipped", async () => {
    sessionViewMock.mockResolvedValue({
      ...view({ blocks: [{ type: "reflect", prompt: "How did that go?", estMinutes: 5 }] }),
      response: {
        blockIndex: 0,
        answer: "",
        correct: null,
        gradedBy: "self" as const,
        feedback: "",
        evidenceTier: null,
        at: "2026-08-13T09:00:00.000Z",
      },
    });

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(/skipped this one/)).toBeDefined();
  });

  it("renders a review block's focus", async () => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          { type: "review", submissionId: "sub-1", focus: "your last query", estMinutes: 5 },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("your last query")).toBeDefined();
  });

  it("falls back to a generic title for a block with no skill", async () => {
    sessionViewMock.mockResolvedValue({
      ...view({ blocks: [{ type: "reflect", prompt: "How did that go?", estMinutes: 5 }] }),
      skill: undefined,
      mastery: undefined,
    });

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("Today's session")).toBeDefined();
  });

  it("shows the block content when the skill has gone from the pack", async () => {
    sessionViewMock.mockResolvedValue({
      ...view(),
      skill: undefined,
      mastery: undefined,
    });

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("c")).toBeDefined();
  });

  it("marks the rail up to the block the learner is on", async () => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          { type: "explain", skillId: skill.id, content: "c", estMinutes: 5 },
          { type: "reflect", prompt: "p", estMinutes: 5 },
          { type: "reflect", prompt: "q", estMinutes: 5 },
        ],
        blockIndex: 1,
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(/Block 2 of 3/)).toBeDefined();
  });

  it("offers to finish once the blocks run out", async () => {
    sessionViewMock.mockResolvedValue(view({ blockIndex: 1 }));
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByRole("button", { name: "Finish session" })).toBeDefined();
  });

  it("does not offer to finish a session that already is", async () => {
    sessionViewMock.mockResolvedValue(
      view({ blockIndex: 1, completedAt: new Date() }),
    );
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.queryByRole("button", { name: "Finish session" })).toBeNull();
    expect(screen.getByText(/already finished/)).toBeDefined();
  });

  it("says the tutor is unavailable rather than showing a dead panel", async () => {
    hasApiKeyMock.mockReturnValue(false);
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(/tutor is unavailable/)).toBeDefined();
  });
});
