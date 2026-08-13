// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EngineSkill, MasteryState } from "@/lib/engine";

/**
 * The lesson body, which streams in behind its own Suspense boundary.
 *
 * It lives in its own module so it can be awaited on its own — both for the
 * boundary and so this test can assert what a learner sees when the lesson does
 * not arrive, which is the branch that matters most.
 */

const lessonForBlockMock = vi.fn();
const hasApiKeyMock = vi.fn(() => true);

vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/ai/client", () => ({
  getAnthropic: () => ({}),
  hasApiKey: () => hasApiKeyMock(),
}));
vi.mock("@/lib/session/view", () => ({
  lessonForBlock: (...a: unknown[]) => lessonForBlockMock(...(a as [])),
}));

const { LessonBody } = await import("@/app/(app)/session/[id]/lesson-body");

const skill: EngineSkill = {
  id: "join-grain",
  slug: "join-grain",
  name: "Join grain",
  level: "core",
  evalTier: 1,
  estimatedHours: 2,
  bktPriors: { pInit: 0.15, pLearn: 0.15, pSlip: 0.1, pGuess: 0.2 },
  canDoStatement: "explain what decides a join's row count",
  area: "modelling",
};

const mastery: MasteryState = {
  skillId: skill.id,
  mastery: 0.4,
  confidence: 0.4,
  evidenceCount: 2,
  lastSuccessAt: null,
  lastPracticedAt: null,
  decayHalfLifeDays: 7,
};

const props = {
  userId: "u1",
  packSlug: "sql-data-analysis",
  skill,
  mastery,
  minutes: 12,
  now: new Date("2026-08-13T09:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  hasApiKeyMock.mockReturnValue(true);
  lessonForBlockMock.mockResolvedValue({
    content: {
      objective: "Know what sets the row count.",
      sections: [{ heading: "Grain", body: "One row per what?" }],
      workedExample: "Join orders to items and count.",
      commonMistake: "Assuming the left table's row count survives.",
    },
    cached: true,
  });
});

afterEach(cleanup);

describe("the lesson body", () => {
  it("renders the objective, sections, worked example and common mistake", async () => {
    render(await LessonBody(props));

    expect(screen.getByText("Know what sets the row count.")).toBeDefined();
    expect(screen.getByText("Grain")).toBeDefined();
    expect(screen.getByText("Join orders to items and count.")).toBeDefined();
    expect(
      screen.getByText("Assuming the left table's row count survives."),
    ).toBeDefined();
  });

  it("says nothing was written rather than inventing filler", async () => {
    // A lesson nobody wrote is worse than no lesson: the product would be
    // teaching from text it made up to fill the space.
    lessonForBlockMock.mockResolvedValue({ content: undefined, cached: false });
    render(await LessonBody(props));

    expect(screen.getByText(/couldn.t write this lesson/)).toBeDefined();
    expect(screen.queryByText("Worked example")).toBeNull();
  });

  it("does not try to generate one with no key configured", async () => {
    hasApiKeyMock.mockReturnValue(false);
    render(await LessonBody(props));

    expect(lessonForBlockMock).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t available right now/)).toBeDefined();
  });

  it("does not try to generate one for a block with no skill", async () => {
    render(await LessonBody({ ...props, skill: undefined }));
    expect(lessonForBlockMock).not.toHaveBeenCalled();
  });

  it("does not try to generate one with no mastery state to level it against", async () => {
    render(await LessonBody({ ...props, mastery: undefined }));
    expect(lessonForBlockMock).not.toHaveBeenCalled();
  });
});
