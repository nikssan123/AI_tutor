// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { findPack } from "@/lib/content";
import type { StoredCurriculum } from "@/lib/curriculum/store";
import type { MasteryState } from "@/lib/engine";

/**
 * §8 screen 5 — "the 'wow', and the honest expectation-set".
 *
 * §24 E6's acceptance criterion for this page is that it "renders the DAG and
 * shows what was skipped and why". Both halves are asserted here, because the
 * second is the one that would be quietly dropped in a redesign.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const getSessionMock = vi.fn();
const activeGoalMock = vi.fn();
const packFromDbMock = vi.fn(async () => undefined as unknown);
const masteryForMock = vi.fn(async (): Promise<MasteryState[]> => []);
const currentCurriculumMock = vi.fn(async (): Promise<StoredCurriculum | undefined> => undefined);

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
// These exercise the disk half of `resolvePack` with the real `findPack`. The
// database half has nothing to find and no stub db to find it with, so a miss
// on disk is a miss outright — which is what "not a real pack" means here.
vi.mock("@/lib/packs/read", () => ({
  packFromDb: (...a: unknown[]) => packFromDbMock(...(a as [])),
}));
vi.mock("@/lib/goals/store", () => ({
  activeGoal: (...a: unknown[]) => activeGoalMock(...(a as [])),
  masteryFor: (...a: unknown[]) => masteryForMock(...(a as [])),
}));
vi.mock("@/lib/curriculum/store", () => ({
  currentCurriculum: (...a: unknown[]) => currentCurriculumMock(...(a as [])),
}));
vi.mock("@/app/(app)/goals/[id]/path/actions", () => ({
  buildPathAction: vi.fn(),
  setDepthAction: vi.fn(),
}));

const { default: PathPage } = await import("@/app/(app)/goals/[id]/path/page");

const pack = findPack("photography")!;
const GOAL_ID = "goal-1";

const goal = {
  id: GOAL_ID,
  packSlug: "photography",
  createdAt: new Date("2026-08-13T09:00:00.000Z"),
  spec: {
    rawGoal: "shoot in manual",
    domain: "photography",
    targetOutcome: "Photography",
    outcomeType: "personal",
    statedLevel: "beginner",
    weeklyHours: 4,
    deadline: "2026-11-01",
    motivation: "",
    constraints: [],
    existingAssets: [],
    depth: "standard",
    clarity: 1,
  },
};

const params = (id = GOAL_ID) => Promise.resolve({ id });

const held = (skillId: string): MasteryState => ({
  skillId,
  mastery: 0.95,
  confidence: 0.9,
  evidenceCount: 4,
  lastSuccessAt: new Date().toISOString(),
  lastPracticedAt: new Date().toISOString(),
  decayHalfLifeDays: 7,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u1", email: "a@b.co" } });
  activeGoalMock.mockResolvedValue(goal);
  packFromDbMock.mockResolvedValue(undefined);
  masteryForMock.mockResolvedValue([]);
  currentCurriculumMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("access", () => {
  it("sends an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(PathPage({ params: params() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("will not show a path for someone else's goal", async () => {
    // Reading another learner's path by guessing a UUID is not a feature.
    await expect(PathPage({ params: params("someone-elses") })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("404s when the learner has no goal at all", async () => {
    activeGoalMock.mockResolvedValue(undefined);
    await expect(PathPage({ params: params() })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("404s when the goal's pack has left the build", async () => {
    activeGoalMock.mockResolvedValue({ ...goal, packSlug: "deleted-pack" });
    await expect(PathPage({ params: params() })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/goals/[id]/path/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("the DAG", () => {
  it("draws a node per skill and an edge per dependency", async () => {
    const { container } = render(await PathPage({ params: params() }));

    expect(container.querySelectorAll("svg rect")).toHaveLength(
      pack.skills.length,
    );
    expect(container.querySelectorAll("svg line")).toHaveLength(
      pack.dependencies.length,
    );
  });

  it("distinguishes soft prerequisites from hard ones", async () => {
    const { container } = render(await PathPage({ params: params() }));
    const dashed = [...container.querySelectorAll("svg line")].filter((l) =>
      l.getAttribute("stroke-dasharray"),
    );
    expect(dashed).toHaveLength(
      pack.dependencies.filter((d) => d.type === "soft").length,
    );
  });

  it("states the deadline when there is one, and omits it when there isn't", async () => {
    render(await PathPage({ params: params() }));
    expect(screen.getByText(/by 2026-11-01/)).toBeDefined();
    cleanup();

    activeGoalMock.mockResolvedValue({
      ...goal,
      spec: { ...goal.spec, deadline: null },
    });
    render(await PathPage({ params: params() }));
    expect(screen.queryByText(/by 2026-11-01/)).toBeNull();
    expect(screen.getByText(/4h a week/)).toBeDefined();
  });

  it("carries a legend for every state it can draw", async () => {
    render(await PathPage({ params: params() }));
    for (const label of ["On your path", "Already yours", "Optional"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });
});

describe("what was skipped, and why", () => {
  it("names each skipped skill with its reason", async () => {
    // §24 E6's acceptance criterion, and §8's "don't waste my time" promise
    // made visible.
    masteryForMock.mockResolvedValue([held(pack.skills[0]!.slug)]);
    render(await PathPage({ params: params() }));

    expect(screen.getByText("What we skipped")).toBeDefined();
    expect(
      screen.getByText(/Skipped — you already showed you can/),
    ).toBeDefined();
  });

  it("says nothing about skipping when nothing was skipped", async () => {
    render(await PathPage({ params: params() }));
    expect(screen.queryByText("What we skipped")).toBeNull();
  });
});

describe("the modules", () => {
  it("offers to build a path when there isn't one yet", async () => {
    render(await PathPage({ params: params() }));
    expect(screen.getByText("Build my path")).toBeDefined();
  });

  it("lists the stored modules in order, marking the graded one", async () => {
    currentCurriculumMock.mockResolvedValue({
      id: "c1",
      goalId: GOAL_ID,
      version: 1,
      status: "active",
      generatedAt: new Date(),
      report: {
        passed: true,
        checks: [
          {
            name: "prereq_completeness",
            passed: true,
            severity: "blocking",
            detail: "Prerequisites are in order.",
            repair: null,
          },
          {
            name: "length_sanity",
            passed: false,
            severity: "warning",
            detail: "30h against 45h available.",
            repair: null,
          },
        ],
      },
      modules: [
        {
          order: 0,
          title: "Exposure",
          targetSkillIds: [pack.skills[0]!.slug],
          estimatedHours: 3,
          outputArtifact: "exercise",
          acceptanceCriteria: [],
          rubricId: null,
        },
        {
          order: 1,
          title: "Shoot it",
          targetSkillIds: ["a-skill-the-pack-dropped"],
          estimatedHours: 2,
          outputArtifact: "project",
          acceptanceCriteria: [],
          rubricId: "r",
        },
      ],
    });

    render(await PathPage({ params: params() }));

    expect(screen.getByText("Exposure")).toBeDefined();
    expect(screen.getByText("Shoot it")).toBeDefined();
    expect(screen.getByText("Graded")).toBeDefined();
    // A stored module can outlive the skill it named; the slug is shown rather
    // than a blank where a name should be.
    expect(screen.getByText("a-skill-the-pack-dropped")).toBeDefined();
    expect(screen.queryByText("Build my path")).toBeNull();

    // §14.6 — the learner can see what was checked before they were shown this.
    expect(screen.getByText("Prerequisites are in order.")).toBeDefined();
    expect(screen.getByText("30h against 45h available.")).toBeDefined();
    expect(screen.getByText("Flagged")).toBeDefined();
  });

  it("shows no check list when the stored report is unreadable", async () => {
    currentCurriculumMock.mockResolvedValue({
      id: "c1",
      goalId: GOAL_ID,
      version: 1,
      status: "active",
      generatedAt: new Date(),
      report: null,
      modules: [],
    });
    render(await PathPage({ params: params() }));
    expect(
      screen.queryByText("What we checked before showing you this"),
    ).toBeNull();
  });
});

describe("§24 E9's rule", () => {
  it("shows no percentage anywhere", async () => {
    masteryForMock.mockResolvedValue([held(pack.skills[0]!.slug)]);
    const { container } = render(await PathPage({ params: params() }));
    // Measuring progress and measuring consumption are different things.
    expect(container.textContent).not.toMatch(/\d\s?%|percent/i);
  });
});

describe("what the pack is", () => {
  it("says nothing extra about a pack a person wrote and checked", async () => {
    render(await PathPage({ params: params() }));
    expect(screen.queryByText(/Experimental/)).toBeNull();
  });

  it("tells a learner when their path was built on request", async () => {
    // §7.1 — the path is the screen people show other people, so it is the
    // last place a generated pack should be able to pass as a curated one.
    activeGoalMock.mockResolvedValue({ ...goal, packSlug: "rust-programming" });
    packFromDbMock.mockResolvedValue({ ...pack, slug: "rust-programming", maturity: "generated" });

    render(await PathPage({ params: params() }));
    expect(screen.getByText(/Experimental/)).toBeDefined();
  });
});

/**
 * The depth dial (PLAN-ADAPTATION). The screen's job is to make the choice
 * legible and honest: three sizes, priced for this learner, and a statement
 * that switching cannot cost them a claim.
 */
describe("the depth dial", () => {
  it("offers all three sizes and marks the one in force", async () => {
    render(await PathPage({ params: Promise.resolve({ id: GOAL_ID }) }));

    expect(screen.getByText("Sprint")).toBeTruthy();
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("Mastery")).toBeTruthy();
    expect(screen.getByText("Your course")).toBeTruthy();
  });

  it("prices each size in skills and hours", async () => {
    render(await PathPage({ params: Promise.resolve({ id: GOAL_ID }) }));

    // Photography: 10 skills at sprint, 14 at standard, 15 at mastery.
    expect(screen.getByText(/10 skills · 17h/)).toBeTruthy();
    expect(screen.getByText(/14 skills · 25h/)).toBeTruthy();
    expect(screen.getByText(/15 skills · 27\.5h/)).toBeTruthy();
  });

  it("says what switching costs, by number", async () => {
    render(await PathPage({ params: Promise.resolve({ id: GOAL_ID }) }));

    // Sprint drops the four advanced skills; mastery adds the one specialist.
    expect(screen.getByRole("button", { name: /Drop 4 skills/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add 1 skill$/ })).toBeTruthy();
  });

  it("promises that a switch cannot cost a proved skill", async () => {
    render(await PathPage({ params: Promise.resolve({ id: GOAL_ID }) }));

    expect(
      screen.getByText(/never takes away a skill you.{0,3}ve already proved/i),
    ).toBeTruthy();
  });

  it("describes each size by what the learner gets, not how it is computed", async () => {
    render(await PathPage({ params: Promise.resolve({ id: GOAL_ID }) }));

    // §8's honesty rule cuts both ways: the copy must not leak the mechanism.
    expect(screen.queryByText(/prerequisite closure/i)).toBeNull();
    expect(screen.queryByText(/specialist level/i)).toBeNull();
  });

  it("moves the marker when the goal is on another depth", async () => {
    activeGoalMock.mockResolvedValue({
      ...goal,
      spec: { ...goal.spec, depth: "sprint" },
    });
    render(await PathPage({ params: Promise.resolve({ id: GOAL_ID }) }));

    // Nothing to drop from the shortest course; both others only add.
    expect(screen.queryByRole("button", { name: /Drop/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Add/ }).length).toBe(2);
  });
});
