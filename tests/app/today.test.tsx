// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { findPack } from "@/lib/content";
import type { TodayView } from "@/lib/goals/today";
import type { PlannedSession, SessionBlock } from "@/lib/engine";

/**
 * §8 screen 6 — the retention surface.
 *
 * `todayFor` is stubbed here on purpose: what it computes is tested against a
 * real database in tests/lib/goal-store.test.ts, and what matters on this screen
 * is that the page says exactly what the planner decided — no reassuring
 * summary of its own, no button for a thing that does not exist yet.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const todayForMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/goals/today", () => ({
  todayFor: (...args: unknown[]) => todayForMock(...(args as [])),
}));

const { default: TodayPage } = await import("@/app/(app)/today/page");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const search = (params: { minutes?: string } = {}) => Promise.resolve(params);
const pack = findPack("photography")!;

function view(overrides: {
  session?: Partial<PlannedSession>;
  projection?: Partial<TodayView["projection"]>;
} = {}): TodayView {
  const blocks: SessionBlock[] = [
    {
      type: "check",
      skillId: pack.skills[0]!.slug,
      prompt: "p",
      expected: "e",
      isRetrieval: true,
      itemId: null,
      estMinutes: 4,
    },
    {
      type: "explain",
      skillId: pack.skills[1]!.slug,
      content: "c",
      estMinutes: 10,
    },
  ];

  return {
    goal: {
      id: "g1",
      packSlug: pack.slug,
      spec: {} as TodayView["goal"]["spec"],
      createdAt: new Date("2026-08-13T09:00:00.000Z"),
    },
    pack,
    projection: {
      requiredSkillIds: ["a", "b"],
      optionalSkillIds: [],
      excludedSkillIds: [],
      exclusionReasons: {},
      estimatedHours: 12.5,
      ...overrides.projection,
    },
    session: {
      goalId: "g1",
      plannedFor: "2026-08-13",
      sessionIndex: 1,
      blocks,
      totalMinutes: 14,
      targetSkillIds: [pack.skills[1]!.slug],
      backingOff: false,
      reason: "Metering is the gap holding up everything after it.",
      compression: null,
      ranked: [],
      ...overrides.session,
    },
    skillNames: new Map(pack.skills.map((s) => [s.slug, s.name])),
    openSessionId: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
});

afterEach(cleanup);

describe("before there is a goal", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(TodayPage({ searchParams: search() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("offers to set one instead of showing an empty dashboard", async () => {
    todayForMock.mockResolvedValue(undefined);
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText(/don't have a goal yet/i)).toBeDefined();
    expect(screen.getByText("Set a goal")).toBeDefined();
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/today/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("with a plan", () => {
  it("leads with the planner's own reason, not a rewrite of it", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    // §16.1 — template-filled from the score components. If the page ever
    // paraphrased it, the sentence could stop matching the ranking.
    expect(
      screen.getByText("Metering is the gap holding up everything after it."),
    ).toBeDefined();
  });

  it("shows one primary card: the session, its blocks and its length", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Today");
    expect(screen.getByText("14 min")).toBeDefined();
    expect(screen.getByText("Recall")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    // Blocks are named by skill, not by slug.
    expect(screen.getByText(`${pack.skills[1]!.name}`)).toBeDefined();
  });

  it("says when it is backing off rather than quietly grinding", async () => {
    // §16.1's damper. A learner who has failed twice gets a worked example and
    // is told that is what is happening.
    todayForMock.mockResolvedValue(view({ session: { backingOff: true } }));
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText(/backing off/i)).toBeDefined();
  });

  it("does not claim to be backing off when it isn't", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));
    expect(screen.queryByText(/backing off/i)).toBeNull();
  });

  it("passes on what a deadline cut, in the planner's words", async () => {
    todayForMock.mockResolvedValue(
      view({
        session: {
          compression: {
            applied: true,
            droppedSkillIds: ["x"],
            message: "Dropped 3 skills to make 1 December.",
          },
        },
      }),
    );
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("Dropped 3 skills to make 1 December.")).toBeDefined();
  });

  it("lists what was skipped and why (§8 screen 5)", async () => {
    todayForMock.mockResolvedValue(
      view({
        projection: {
          excludedSkillIds: ["exposure-triangle"],
          exclusionReasons: {
            "exposure-triangle": "Skipped — you already showed you can set exposure.",
          },
        },
      }),
    );
    render(await TodayPage({ searchParams: search() }));

    expect(
      screen.getByText("Skipped — you already showed you can set exposure."),
    ).toBeDefined();
  });

  it("shows the hours estimate without a percentage anywhere (§24 E9)", async () => {
    todayForMock.mockResolvedValue(
      view({ projection: { optionalSkillIds: ["deep-cut"] } }),
    );
    const { container } = render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText(/12\.5 hours/)).toBeDefined();
    expect(screen.getByText(/1 optional/)).toBeDefined();
    // "No percentage-complete anywhere in the UI" is a product rule, not a
    // style preference: it is the difference between measuring progress and
    // measuring consumption.
    expect(container.textContent).not.toMatch(/\d%|percent/i);
  });

  it("omits the optional count when there is nothing optional", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));
    expect(screen.queryByText(/optional/)).toBeNull();
  });

  it("offers to start the session", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Start session" })).toBeDefined();
  });

  it("offers to carry on when a session is already open", async () => {
    // The wording is the whole point: "Start session" over a session already
    // holding three answers would read as an offer to throw them away.
    todayForMock.mockResolvedValue({ ...view(), openSessionId: "s-1" });
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Carry on" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();
  });

  it("copes with a plan that has no blocks left to give", async () => {
    todayForMock.mockResolvedValue(
      view({ session: { blocks: [], totalMinutes: 0 } }),
    );
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText(/waiting on a prerequisite/i)).toBeDefined();
  });

  it("renders review and reflect blocks by their own text", async () => {
    todayForMock.mockResolvedValue(
      view({
        session: {
          blocks: [
            { type: "review", submissionId: "s1", focus: "Your last edit", estMinutes: 5 },
            { type: "reflect", prompt: "What surprised you?", estMinutes: 3 },
            {
              type: "apply",
              skillId: pack.skills[2]!.slug,
              brief: "b",
              rubricId: null,
              evidenceType: "media",
              estMinutes: 20,
            },
            {
              type: "check",
              skillId: pack.skills[3]!.slug,
              prompt: "p",
              expected: "e",
              isRetrieval: false,
              itemId: null,
              estMinutes: 2,
            },
          ],
        },
      }),
    );
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("Your last edit")).toBeDefined();
    expect(screen.getByText("What surprised you?")).toBeDefined();
    expect(screen.getByText(pack.skills[2]!.name)).toBeDefined();
    expect(screen.getByText(pack.skills[3]!.name)).toBeDefined();
  });

  it("falls back to the slug for a skill the pack no longer names", async () => {
    todayForMock.mockResolvedValue(
      view({
        session: {
          blocks: [
            { type: "explain", skillId: "ghost", content: "c", estMinutes: 5 },
            {
              type: "check",
              skillId: "ghost",
              prompt: "p",
              expected: "e",
              isRetrieval: true,
              itemId: null,
              estMinutes: 2,
            },
            {
              type: "check",
              skillId: "ghost",
              prompt: "p",
              expected: "e",
              isRetrieval: false,
              itemId: null,
              estMinutes: 2,
            },
            {
              type: "apply",
              skillId: "ghost",
              brief: "b",
              rubricId: null,
              evidenceType: "media",
              estMinutes: 9,
            },
          ],
        },
      }),
    );
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getAllByText(/ghost/).length).toBeGreaterThan(0);
  });
});

describe("I have less time", () => {
  it("passes the shorter budget straight to the planner", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search({ minutes: "15" }) }));

    expect(todayForMock).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      expect.any(Date),
      { availableMinutes: 15 },
    );
  });

  it.each([["nonsense"], ["0"], ["-5"], [""]])(
    "ignores %s and plans the normal session",
    async (minutes) => {
      todayForMock.mockResolvedValue(view());
      render(await TodayPage({ searchParams: search({ minutes }) }));

      expect(todayForMock).toHaveBeenCalledWith(
        expect.anything(),
        "u1",
        expect.any(Date),
        { availableMinutes: undefined },
      );
    },
  );

  it("offers the shorter option on the card", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));
    expect(screen.getByText("I have less time")).toBeDefined();
  });
});
