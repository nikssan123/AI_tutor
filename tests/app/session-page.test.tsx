// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
const recentSignalsMock = vi.fn();
const hasApiKeyMock = vi.fn(() => true);

const nudgeMock = vi.fn(async (..._a: unknown[]) => undefined as unknown);

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
vi.mock("@/lib/session/tutor", () => ({
  transcriptFor: async () => [],
  turnsTaken: async () => 3,
}));
vi.mock("@/lib/billing/gate", () => ({
  nudgeAt: (...a: unknown[]) => nudgeMock(...(a as [])),
}));
vi.mock("@/app/(app)/session/[id]/actions", () => ({
  answerAction: vi.fn(),
  continueAction: vi.fn(),
  finishAction: vi.fn(),
  noteAction: vi.fn(),
  proveAction: vi.fn(),
}));
vi.mock("@/lib/session/store", () => ({
  recentSignals: (...a: unknown[]) => recentSignalsMock(...(a as [])),
}));
vi.mock("@/app/(app)/session/[id]/tutor-dock", () => ({
  // Renders the one prop this page decides: whether the dock is allowed to
  // warn. Everything else the dock does has its own suite.
  TutorDock: ({ quiet }: { quiet: boolean }) => (
    <div>tutor panel{quiet ? " (quiet)" : ""}</div>
  ),
}));
/*
 * `DOCK_OUTER`, `DOCK_INNER`, `DOCK_PANEL` and `SESSION_COLUMN` are deliberately
 * *not* stubbed here, and this mock is the reason to say so out loud.
 *
 * They used to be exported from `tutor-dock` — a `"use client"` module — and
 * stubbed above as plain strings. On a server render they are not strings but
 * client-reference proxies, and `cx()` stringifies a proxy into the class
 * attribute, so the live page shipped `class="… function() { throw new
 * Error("Attempted to call SESSION_COLUMN() from the server…") }"` and the
 * width cap never applied. The stub was the exact shape that hid it. They live
 * in `./dock-frame` now, a plain module, and this suite renders the real ones.
 */

import { findPack } from "@/lib/content";

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
  /** An earlier block being looked back at — `sessionView`'s `?block=`. */
  viewing?: number;
  response?: BlockResponse;
  completedAt?: Date | null;
} = {}) {
  const blocks = over.blocks ?? [
    { type: "explain", skillId: skill.id, content: "c", estMinutes: 10 },
  ];
  const blockIndex = over.blockIndex ?? 0;
  const viewing = over.viewing ?? blockIndex;

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
    goal: {
      id: "g1",
      packSlug: "sql-data-analysis",
      spec: { priorDomain: "none" },
    },
    // The real pack: the prove-it offer reads its item bank, and a stub with no
    // items would let a page that crashed on a real one pass here.
    pack: { ...findPack("sql-data-analysis")!, name: "SQL for data analysis" },
    block: blocks[viewing],
    viewing,
    lookingBack: viewing < blockIndex,
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

/**
 * Renders the page, and waits for what streams into it.
 *
 * `render` alone leaves the `Suspense` children hanging: they suspend *inside*
 * RTL's own `act` scope, and because that scope is never awaited React has
 * nowhere to flush the retry to — the boundary sits on its fallback for ever.
 * Which of them happened to resolve anyway then depended on how many awaits the
 * page did before rendering, so a test asserting on the tutor passed on the
 * quota path (which awaits a nudge) and failed on the ordinary one.
 *
 * Awaiting the act scope drains it, and both commit deterministically.
 */
async function show(node: React.ReactElement) {
  await act(async () => {
    render(node);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasApiKeyMock.mockReturnValue(true);
  sessionViewMock.mockResolvedValue(view());
  recentSignalsMock.mockResolvedValue([]);
  lessonForBlockMock.mockResolvedValue({ content: lesson, cached: true });
});

afterEach(cleanup);

describe("the session screen", () => {
  it("sends a learner with no such session back to today", async () => {
    sessionViewMock.mockResolvedValue(undefined);
    await expect(SessionPage({ params, searchParams: search })).rejects.toThrow("REDIRECT:/today");
  });

  /**
   * "Block 1 of 3" is gone: it sat directly above a rail that named the same
   * blocks, and only one of the two drawings can tell you the block after this
   * one is eleven minutes of writing code. The rail is the fact now, and the
   * block in hand is the one carrying `aria-current="step"`.
   */
  it("shows where the learner is in the session", async () => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          { type: "explain", skillId: skill.id, content: "c", estMinutes: 10 },
          {
            type: "check",
            skillId: skill.id,
            prompt: "p",
            expected: "e",
            isRetrieval: false,
            itemId: null,
            estMinutes: 5,
          },
        ],
        blockIndex: 1,
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));

    const steps = screen.getAllByRole("listitem");
    const current = steps.filter((s) => s.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Recall");
    expect(screen.getByText("Join grain")).toBeDefined();
  });

  /**
   * The can-do statement is the lesson's job, not the block's.
   *
   * The block used to open with it in a `Lead` and the lesson opened with its
   * own objective directly underneath, which is one claim written twice in the
   * same size and the same grey — the reader's first two paragraphs said the
   * same thing.
   */
  it("does not repeat the can-do statement above an explain block's lesson", async () => {
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.queryByText(skill.canDoStatement)).toBeNull();
    // And the lesson does say it, in its own words. Assertable again now that
    // `show` drains the act queue — it had to be dropped when a suspended
    // child could sit on its fallback for the whole test.
    expect(screen.getByText(lesson.objective)).toBeDefined();
  });

  /**
   * Unless there is no lesson to say it. Without a skill there is no lesson
   * either, so the block's own brief is the only thing left on the screen that
   * says what this block is about.
   */
  it("falls back to the block's own brief when no skill resolved", async () => {
    sessionViewMock.mockResolvedValue({ ...view(), skill: undefined });

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("c")).toBeDefined();
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

    // Marking is a model call and the form posts over `fetch`, so the box sits
    // there with the answer still in it and nothing spinning. The live region
    // is what a plain `Button` does not have — see `SubmitButton`.
    const form = screen
      .getByRole("button", { name: "Submit answer" })
      .closest("form")!;
    expect(within(form).getByRole("status")).toBeDefined();
  });

  /**
   * The box a command gets typed into.
   *
   * A learner answered a CLI question with `dotnet new` in a proof-reading
   * textarea. Nothing here is prose: the grader marks what the answer says and
   * its own prompt calls spelling irrelevant, so autocorrect and friends have
   * nothing to be right about and plenty to break.
   */
  it("turns the browser's prose habits off in an answer box", async () => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "check",
            skillId: skill.id,
            prompt: "State the command",
            expected: "the command",
            isRetrieval: false,
            itemId: "cli-1",
            answerFormat: "code",
            estMinutes: 5,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    const box = screen.getByLabelText("Your answer");

    expect(box.getAttribute("spellcheck")).toBe("false");
    expect(box.getAttribute("autocapitalize")).toBe("off");
    expect(box.getAttribute("autocorrect")).toBe("off");
    // And a code answer gets a box that lines up.
    expect(box.className).toContain("font-mono");
    expect(box.getAttribute("placeholder")).toContain("or run it");
  });

  it("keeps the reading font for an answer that is prose", async () => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "check",
            skillId: skill.id,
            prompt: "Why does it behave that way?",
            expected: "the reason",
            isRetrieval: false,
            itemId: "why-1",
            answerFormat: "prose",
            estMinutes: 5,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    const box = screen.getByLabelText("Your answer");

    expect(box.className).not.toContain("font-mono");
    expect(box.getAttribute("spellcheck")).toBe("false");
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

  /**
   * §4.2 law 2's other half, and the defect that made it a lie.
   *
   * The block used to read "Produce work that demonstrates: <can-do
   * statement>", written by the composer with `rubricId: null`, while
   * `projectForBlock` picked the actual project at submission time. A learner
   * handed in against an eleven-minute line and was marked on a 420-minute
   * project's acceptance criteria — CSV parsing, a README, timing notes — that
   * they had never been shown. Every criterion came back `absent`: 0%.
   */
  it("shows the brief, the bar and the size of the work before the box", async () => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "apply",
            skillId: skill.id,
            brief: "Process a batch of orders from a CSV and report on them.",
            rubricId: "order-processing-rubric",
            evidence: { image: "none" as const, images: 1 },
            project: {
              title: "Order Processing Console App",
              acceptanceCriteria: [
                "Invalid rows are rejected with a logged reason, not a crash",
                "A README explains one instance of deferred execution",
              ],
              projectMinutes: 420,
            },
            estMinutes: 11,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.getByText("Order Processing Console App")).toBeDefined();
    expect(screen.getByText(/Process a batch of orders/)).toBeDefined();
    // What "finished" means, in the words it will be marked against.
    expect(screen.getByText(/Invalid rows are rejected/)).toBeDefined();
    expect(screen.getByText(/README explains one instance/)).toBeDefined();
    // And how big it really is — the block's own 11 minutes is the slot for
    // reading the brief and handing in, not the work.
    expect(screen.getByText(/about 7 hours of work/)).toBeDefined();
  });

  /**
   * The size in words a learner reads rather than a number they convert. A
   * 45-minute piece of work must not be rounded into hours, and a long one
   * must not be quoted as three hundred and something minutes.
   */
  it.each([
    [45, /about 45 minutes/],
    [150, /about 3 hours/],
  ])("says %i minutes of work in the right units", async (projectMinutes, expected) => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "apply",
            skillId: skill.id,
            brief: "Build the thing described here.",
            rubricId: "a-rubric",
            evidence: { image: "none" as const, images: 1 },
            project: {
              title: "The piece of work",
              acceptanceCriteria: ["It does the thing"],
              projectMinutes,
            },
            estMinutes: 11,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(expected)).toBeDefined();
  });

  it("still renders a block from a session planned before projects were carried", async () => {
    // Sessions already in the database have no `project` on their apply block.
    // They degrade to the brief alone rather than to a broken screen.
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "apply",
            skillId: skill.id,
            brief: "Write the query",
            rubricId: null,
            evidence: { image: "none" as const, images: 1 },
            estMinutes: 15,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("Write the query")).toBeDefined();
    expect(screen.queryByText(/of work —/)).toBeNull();
    expect(screen.getByPlaceholderText("Paste your work here…")).toBeDefined();
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
            evidence: { image: "none" as const, images: 1 },
            estMinutes: 15,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByPlaceholderText("Paste your work here…")).toBeDefined();
    const handIn = screen.getByRole("button", { name: "Hand it in" });
    expect(handIn).toBeDefined();
    // The longest wait in a session, so the one that most needs saying it is
    // under way: a learner who thinks the press missed hands the same work in
    // twice, against a monthly allowance.
    expect(within(handIn.closest("form")!).getByRole("status")).toBeDefined();
    // Nothing bounced, so nothing is being explained.
    expect(screen.queryByText(/nothing in the box/)).toBeNull();
  });

  /**
   * §24 E8.5 — the file input, and only where the brief asks for one.
   *
   * The decision is the *project's*, not the pack's workspace: a sewing brief
   * wants a photograph of a finished seam and the one beside it in the same
   * pack wants nothing but the reasoning behind a fabric layout. So the test
   * that matters most is the negative one — a written-only brief must not grow
   * a control for evidence it never asked for.
   */
  describe("the photographs a brief asks for", () => {
    const applyBlock = (
      evidence?: { image: "required" | "optional" | "none"; images: number },
    ) =>
      view({
        blocks: [
          {
            type: "apply",
            skillId: skill.id,
            brief: "Cook it and show me",
            rubricId: "a-rubric",
            ...(evidence ? { evidence } : {}),
            estMinutes: 15,
          },
        ],
      });

    const fileInput = () =>
      document.querySelector<HTMLInputElement>('input[type="file"]');

    it("offers no file input on a written-only brief", async () => {
      sessionViewMock.mockResolvedValue(applyBlock({ image: "none", images: 1 }));
      await show(await SessionPage({ params, searchParams: search }));

      expect(fileInput()).toBeNull();
      expect(screen.getByPlaceholderText("Paste your work here…")).toBeDefined();
    });

    it("offers none on a session planned before the field existed", async () => {
      /*
       * The trap this exists for: `evidence?.image === "none"` is false when
       * `evidence` is `undefined`, so the naive test would show a file input on
       * every session in the database and then refuse the hand-in at the far
       * end for a photograph the brief never wanted.
       */
      sessionViewMock.mockResolvedValue(applyBlock());
      await show(await SessionPage({ params, searchParams: search }));

      expect(fileInput()).toBeNull();
    });

    it("asks for one, and insists, where the brief requires it", async () => {
      sessionViewMock.mockResolvedValue(
        applyBlock({ image: "required", images: 1 }),
      );
      await show(await SessionPage({ params, searchParams: search }));

      const input = fileInput()!;
      expect(input.name).toBe("photos");
      expect(input.required).toBe(true);
      // One photograph, so no multiple: a control that invites four files for a
      // brief that takes one is a refusal waiting to happen.
      expect(input.multiple).toBe(false);
      expect(screen.getByText("Add a photograph")).toBeDefined();
    });

    it("takes a set where the brief is a set, and says how many", async () => {
      sessionViewMock.mockResolvedValue(
        applyBlock({ image: "required", images: 6 }),
      );
      await show(await SessionPage({ params, searchParams: search }));

      expect(fileInput()!.multiple).toBe(true);
      expect(screen.getByText("Add up to 6 photographs")).toBeDefined();
    });

    it("invites rather than insists where the photograph is optional", async () => {
      sessionViewMock.mockResolvedValue(
        applyBlock({ image: "optional", images: 1 }),
      );
      await show(await SessionPage({ params, searchParams: search }));

      expect(fileInput()!.required).toBe(false);
      expect(screen.getByText(/if it helps show what you did/)).toBeDefined();
    });

    it("says what the model API can read, before the upload rather than after", async () => {
      // A failed upload costs a phone user a real wait on a real connection.
      sessionViewMock.mockResolvedValue(
        applyBlock({ image: "required", images: 1 }),
      );
      await show(await SessionPage({ params, searchParams: search }));

      expect(screen.getByText(/JPEG, PNG or WebP, up to 4.5MB each/)).toBeDefined();
    });

    it.each([
      ["missing", /needs one as well as your write-up/],
      ["too-many", /asks for up to 4 photographs/],
      ["too-big", /over 4.5MB/],
      ["total-too-big", /more than we can take in one go/],
      ["wrong-type", /JPEG, PNG, WebP and GIF/],
    ])("explains a %s refusal, with what to do about it", async (error, said) => {
      sessionViewMock.mockResolvedValue(
        applyBlock({ image: "required", images: 4 }),
      );
      await show(
        await SessionPage({
          params,
          searchParams: Promise.resolve({ error }),
        }),
      );

      expect(screen.getByText(said)).toBeDefined();
    });

    it("says nothing about photographs for an error that is not one", async () => {
      // `?error=` is a query string and anything can be typed into one.
      sessionViewMock.mockResolvedValue(
        applyBlock({ image: "required", images: 4 }),
      );
      await show(
        await SessionPage({
          params,
          searchParams: Promise.resolve({ error: "not-a-refusal" }),
        }),
      );

      expect(screen.queryByText(/write-up/)).toBeNull();
    });
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
            evidence: { image: "none" as const, images: 1 },
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

    // Three marks, and the one in hand is the second. The states differ in
    // shape as well as colour (§8.5.5), so what is asserted is the structure:
    // exactly one step is current, and it is not the first.
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.getAttribute("aria-current"))).toEqual([
      null,
      "step",
      null,
    ]);
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

/**
 * Going back — §8 screen 7's one-block-at-a-time, made survivable.
 *
 * The rail already named the blocks behind you ("Read", "Recall") while being
 * the one thing on the screen you could not press, so a learner who wanted the
 * lesson again had nowhere to go but out of the session. It is links now, and
 * what they lead to is a *record*: the session's cursor does not move, and
 * nothing on a past block can be answered, handed in or marked a second time.
 */
describe("looking back at a block already done", () => {
  const blocks: SessionBlock[] = [
    { type: "explain", skillId: skill.id, content: "c", estMinutes: 10 },
    {
      type: "check",
      skillId: skill.id,
      prompt: "What decides the row count?",
      expected: "the grain",
      isRetrieval: false,
      itemId: null,
      estMinutes: 5,
    },
    {
      type: "apply",
      skillId: skill.id,
      brief: "Write the query",
      rubricId: null,
      evidence: { image: "none" as const, images: 1 },
      estMinutes: 15,
    },
  ];

  const marked: BlockResponse = {
    blockIndex: 1,
    answer: "the grain",
    correct: true,
    gradedBy: "model",
    feedback: "You named the grain.",
    evidenceTier: 2,
    at: "2026-08-13T09:00:00.000Z",
  };

  const railHrefs = () =>
    screen
      .getAllByRole("link", { name: /^Go back to/ })
      .map((link) => link.getAttribute("href"));

  /**
   * The rail was found and a button was asked for anyway, so both exist: the
   * rail jumps to any block already done, this steps back one at a time and is
   * a named control sitting beside the one that goes forward.
   */
  const backHref = () =>
    screen
      .getByRole("link", { name: "Back to the previous block" })
      .getAttribute("href");

  it("puts a Back button beside the button that goes on", async () => {
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 1 }));
    await show(await SessionPage({ params, searchParams: search }));

    // The block a learner most wants to leave and come back to: answering from
    // memory, with the lesson it is about one press behind.
    expect(screen.getByLabelText("Your answer")).toBeDefined();
    expect(backHref()).toBe("/session/sess-1?block=0");
  });

  it("has nothing to go back to on the first block", async () => {
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 0 }));
    await show(await SessionPage({ params, searchParams: search }));

    expect(
      screen.queryByRole("link", { name: "Back to the previous block" }),
    ).toBeNull();
  });

  it("keeps the last block re-readable from the finish screen", async () => {
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 3 }));
    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.getByRole("button", { name: "Finish session" })).toBeDefined();
    expect(backHref()).toBe("/session/sess-1?block=2");
  });

  it("goes both ways from a block already done", async () => {
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 2, viewing: 1 }));
    await show(await SessionPage({ params, searchParams: search }));

    // Further back, and out to where the session actually is.
    expect(backHref()).toBe("/session/sess-1?block=0");
    expect(
      screen
        .getByRole("link", { name: "Back to where you were" })
        .getAttribute("href"),
    ).toBe("/session/sess-1");
  });

  it("links back to the blocks behind the cursor, and to nothing ahead of it", async () => {
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 2 }));
    await show(await SessionPage({ params, searchParams: search }));

    // Two behind, so two links. The block in hand and the ones ahead stay
    // plain text: a rail you could jump forward in would be a way to skip the
    // work and land on the questions.
    expect(railHrefs()).toEqual([
      "/session/sess-1?block=0",
      "/session/sess-1?block=1",
    ]);
  });

  it("lets a finished session be read back through", async () => {
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 3 }));
    await show(await SessionPage({ params, searchParams: search }));

    expect(railHrefs()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Finish session" })).toBeDefined();
  });

  it("shows the lesson again, without the button that would move the cursor", async () => {
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 2, viewing: 0 }));
    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.getByText(lesson.objective)).toBeDefined();
    expect(screen.getByText(/Looking back/)).toBeDefined();
    // Continue would advance a cursor that is already two blocks further on.
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Back to where you were" })
        .getAttribute("href"),
    ).toBe("/session/sess-1");
  });

  it("shows the marking again rather than a second box to answer it", async () => {
    sessionViewMock.mockResolvedValue(
      view({ blocks, blockIndex: 2, viewing: 1, response: marked }),
    );
    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.getByText("What decides the row count?")).toBeDefined();
    expect(screen.getByText("Marked correct")).toBeDefined();
    expect(screen.getByText("You named the grain.")).toBeDefined();
    // The server would refuse the post anyway — a box that cannot submit is a
    // promise the screen has no business making.
    expect(screen.queryByLabelText("Your answer")).toBeNull();
  });

  it("says a question was passed rather than offering to answer it late", async () => {
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 2, viewing: 1 }));
    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.getByText(/moved on without answering/)).toBeDefined();
    expect(screen.queryByLabelText("Your answer")).toBeNull();
  });

  it("keeps the hand-in box off a Do block the session has moved past", async () => {
    // The one that would cost real money twice: a second hand-in spends a
    // second evaluation from the month's allowance on work already marked.
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 3, viewing: 2 }));
    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.getByText("Write the query")).toBeDefined();
    expect(screen.queryByPlaceholderText("Paste your work here…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hand it in" })).toBeNull();
    // Finished, but what is on screen is a block — so the header names it.
    expect(screen.queryByText("That's the session")).toBeNull();
    expect(screen.getByText("Join grain")).toBeDefined();
  });

  it("shows a reflection that was written, and says so when there wasn't one", async () => {
    const written = [
      { type: "reflect" as const, prompt: "How did that go?", estMinutes: 5 },
      { type: "reflect" as const, prompt: "And now?", estMinutes: 5 },
    ];

    sessionViewMock.mockResolvedValue(
      view({
        blocks: written,
        blockIndex: 1,
        viewing: 0,
        response: {
          blockIndex: 0,
          answer: "harder than it looked",
          correct: null,
          gradedBy: "self",
          feedback: "",
          evidenceTier: null,
          at: "2026-08-13T09:00:00.000Z",
        },
      }),
    );
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("harder than it looked")).toBeDefined();
    expect(screen.queryByLabelText("Your reflection")).toBeNull();
    cleanup();

    sessionViewMock.mockResolvedValue(
      view({ blocks: written, blockIndex: 1, viewing: 0 }),
    );
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText(/skipped this one/)).toBeDefined();
  });

  it("shows what a review block was about", async () => {
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          { type: "review", submissionId: "sub-1", focus: "your last query", estMinutes: 5 },
          { type: "reflect", prompt: "p", estMinutes: 5 },
        ],
        blockIndex: 1,
        viewing: 0,
      }),
    );
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.getByText("your last query")).toBeDefined();
  });

  it("holds the prove-it offer back, and the query behind it", async () => {
    // The offer is about the skill in hand. Made from a page showing something
    // already finished, it would be an offer about the wrong moment.
    recentSignalsMock.mockResolvedValue([
      { skillSlug: "join-grain", signal: "already_knows" },
    ]);
    sessionViewMock.mockResolvedValue(view({ blocks, blockIndex: 2, viewing: 1 }));

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.queryByText(/You said you already know this/)).toBeNull();
    expect(recentSignalsMock).not.toHaveBeenCalled();
  });
});

/**
 * PLAN-ADAPTATION step 4 — the offer, and the honesty of its copy.
 *
 * The card promises questions, says they count either way, and never promises
 * that the skill will be skipped. That last distinction is the whole feature:
 * accepting buys an assessment, not a result.
 */
describe("the prove-it offer", () => {
  const check: SessionBlock = {
    type: "check",
    skillId: "join-grain",
    prompt: "In your own words?",
    expected: "e",
    isRetrieval: false,
    itemId: null,
    estMinutes: 5,
  };

  function claiming() {
    recentSignalsMock.mockResolvedValue([
      { skillSlug: "join-grain", signal: "already_knows" },
    ]);
    sessionViewMock.mockResolvedValue(view({ blocks: [check] }));
  }

  it("stays out of the way when nothing was claimed", async () => {
    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.queryByText(/You said you already know this/)).toBeNull();
  });

  it("offers to test a claim the tutor heard", async () => {
    claiming();
    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.getByText(/You said you already know this/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Give me the questions/ }),
    ).toBeDefined();
  });

  it("says the answers count either way", async () => {
    claiming();
    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.getByText(/count either way/)).toBeDefined();
  });

  /**
   * The copy must not promise a skip. Mastery moves on the answers or it does
   * not move at all, and a card that said "skip this" would be writing a cheque
   * the grader has to honour.
   */
  it("promises questions, never a skip", async () => {
    claiming();
    await show(await SessionPage({ params, searchParams: search }));

    expect(screen.queryByText(/skip ahead/i)).toBeNull();
    expect(screen.queryByText(/mark it as known/i)).toBeNull();
  });

  it("disappears once the questions have been taken", async () => {
    recentSignalsMock.mockResolvedValue([
      { skillSlug: "join-grain", signal: "already_knows" },
    ]);
    sessionViewMock.mockResolvedValue(
      view({ blocks: [check, { ...check, itemId: "taken" }] }),
    );

    await show(await SessionPage({ params, searchParams: search }));
    expect(screen.queryByText(/You said you already know this/)).toBeNull();
  });
});

describe("when the month's marking is spent", () => {
  const spent = Promise.resolve({ error: "quota" });

  it("offers the upgrade in place of an error", async () => {
    // Unlike an empty hand-in there is nothing for the learner to correct: the
    // only things that change the outcome are a bigger plan or the 1st.
    nudgeMock.mockResolvedValue({
      reason: "evaluations_spent",
      headline: "You've used this month's graded project",
      body: "It comes back on the 1st.",
      cta: "See what Pro includes",
      href: "/pricing",
    });

    // The nudge sits with the hand-in form, so the block has to be one.
    sessionViewMock.mockResolvedValue(
      view({
        blocks: [
          {
            type: "apply",
            skillId: skill.id,
            brief: "Write the query",
            rubricId: null,
            evidence: { image: "none" as const, images: 1 },
            estMinutes: 15,
          },
        ],
      }),
    );

    await show(await SessionPage({ params, searchParams: spent }));

    expect(
      screen.getByRole("heading", {
        name: "You've used this month's graded project",
      }),
    ).toBeTruthy();
  });

  it("does not ask on an ordinary visit", async () => {
    // Two queries a nudge costs, on every other visit to this screen, for
    // somebody who is simply getting on with the work.
    await show(await SessionPage({ params, searchParams: search }));
    expect(nudgeMock).not.toHaveBeenCalled();
  });

  it("silences the tutor's own warning while the ask is on screen", async () => {
    // §14.9.7 limit 4's warning and the upgrade prompt are both true and both
    // reasonable, and arriving together they read as one message: you are out,
    // pay us. One ask at a time — and it is the warning that yields, because it
    // costs nothing to see next session.
    nudgeMock.mockResolvedValue({
      reason: "evaluations_spent",
      headline: "You've used this month's graded project",
      body: "It comes back on the 1st.",
      cta: "See what Pro includes",
      href: "/pricing",
    });

    await show(await SessionPage({ params, searchParams: spent }));

    expect(await screen.findByText("tutor panel (quiet)")).toBeTruthy();
  });

  it("lets it speak on a screen that is not asking for anything", async () => {
    await show(await SessionPage({ params, searchParams: search }));
    expect(await screen.findByText("tutor panel")).toBeTruthy();
  });
});
