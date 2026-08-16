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
const getSessionMock = vi.fn();
const activeGoalMock = vi.fn();
const packFromDbMock = vi.fn(async () => undefined as unknown);
const masteryForMock = vi.fn(async (): Promise<MasteryState[]> => []);
const currentCurriculumMock = vi.fn(async (): Promise<StoredCurriculum | undefined> => undefined);

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
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
// The screen absorbed `/goals/{id}/path`'s two `notFound()` branches when it
// moved to `/path`: a rail destination that 404s at somebody with no course is
// worse than one that makes them the same offer every other destination does.
const standingForMock = vi.fn(async () => ({
  building: undefined,
  resume: undefined,
  again: [],
}));
vi.mock("@/lib/goals/standing", () => ({
  standingFor: (...a: unknown[]) => standingForMock(...(a as [])),
}));
vi.mock("@/app/(app)/path/actions", () => ({
  buildPathAction: vi.fn(),
  setDepthAction: vi.fn(),
}));

const { default: PathPage } = await import("@/app/(app)/path/page");

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
    await expect(PathPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  /**
   * There is no id to guess any more.
   *
   * The screen used to take one in the URL and `notFound()` when it did not
   * match — reading another learner's path by guessing a UUID is not a feature.
   * One active course at a time is a transactional invariant, so the id only
   * ever had one value; dropping it makes the guarantee structural rather than
   * checked, because `activeGoal` can only return this learner's own.
   */
  it("shows the course off the session, never off the URL", async () => {
    render(await PathPage());

    expect(activeGoalMock).toHaveBeenCalledWith({}, "u1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      pack.name,
    );
  });

  /**
   * A rail destination cannot 404 at the state half its visitors are in. Both
   * branches that used to `notFound()` now make the same offer every other
   * destination makes — see `NothingRunning`.
   */
  it("meets a learner with no course in the words the rest of the product uses", async () => {
    activeGoalMock.mockResolvedValue(undefined);

    render(await PathPage());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Your path",
    );
    expect(
      screen.getByRole("link", { name: "Tell us what you want" }),
    ).toBeDefined();
  });

  it("says the same when the goal's pack has left the build", async () => {
    activeGoalMock.mockResolvedValue({ ...goal, packSlug: "deleted-pack" });

    render(await PathPage());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Your path",
    );
  });

  it("offers a course they put aside rather than only the catalogue", async () => {
    activeGoalMock.mockResolvedValue(undefined);
    standingForMock.mockResolvedValue({
      building: undefined,
      resume: undefined,
      again: [
        {
          goalId: "g-old",
          name: "Photography",
          taxonomyParent: "arts",
          status: "paused",
        },
      ],
    } as never);

    render(await PathPage());

    expect(screen.getByText("Pick one back up")).toBeDefined();
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/path/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

/**
 * §24 E6's first half. The graph is `SkillMap` now — how it wraps a label and
 * where it puts a box are that component's tests — so what is asserted at this
 * level is that the page hands it the whole subject and that the picture and
 * the list are telling the same story.
 */
describe("the DAG", () => {
  const boxes = (container: HTMLElement) =>
    container.querySelectorAll('svg[role="img"] > g > rect');

  it("draws a node per skill and an edge per dependency", async () => {
    const { container } = render(await PathPage());

    expect(boxes(container)).toHaveLength(pack.skills.length);
    expect(container.querySelectorAll('svg[role="img"] > path')).toHaveLength(
      pack.dependencies.length,
    );
  });

  it("distinguishes soft prerequisites from hard ones", async () => {
    const { container } = render(await PathPage());
    const dashed = [
      ...container.querySelectorAll('svg[role="img"] > path'),
    ].filter((l) => l.getAttribute("stroke-dasharray"));

    expect(dashed).toHaveLength(
      pack.dependencies.filter((d) => d.type === "soft").length,
    );
  });

  it("states the deadline when there is one, and omits it when there isn't", async () => {
    render(await PathPage());
    expect(screen.getByText(/by 2026-11-01/)).toBeDefined();
    cleanup();

    activeGoalMock.mockResolvedValue({
      ...goal,
      spec: { ...goal.spec, deadline: null },
    });
    render(await PathPage());
    expect(screen.queryByText(/by 2026-11-01/)).toBeNull();
    expect(screen.getByText(/4h a week/)).toBeDefined();
  });

  /**
   * The graph used to have a vocabulary of its own — "On your path" against the
   * list's "Open now" — and only three states in it, so *locked*, the one thing
   * a picture of prerequisites is uniquely good at showing, was the one thing it
   * could not show. Same four words on both halves now.
   */
  it("keys itself with the same four states the list uses", async () => {
    render(await PathPage());

    for (const label of ["Open now", "Locked", "Already yours", "Optional"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // And they are the list's words, not a second set: every state this learner
    // is actually in appears on both halves of the page. ("Already yours" is
    // the exception here only because nothing is proved yet, so the list's
    // legend drops it — "0 already yours" is a sentence about nothing.)
    for (const label of ["Open now", "Locked", "Optional"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(1);
    }
    expect(screen.queryByText("On your path")).toBeNull();
  });

  /** Two kinds of line, and nothing on the old screen said what either was. */
  it("says what a dashed line means", async () => {
    render(await PathPage());

    expect(screen.getByText("Needed before it")).toBeDefined();
    expect(screen.getByText("Helps, but not required")).toBeDefined();
  });

  /**
   * The fault that started the redesign: labels were cut with `slice(0, 20)`,
   * so "The exposure triangle" was drawn as "The exposure triangl" and every
   * name on the screen looked misspelt.
   */
  it("never cuts a skill name mid-word", async () => {
    const { container } = render(await PathPage());
    const drawn = [...container.querySelectorAll('svg[role="img"] text')].map(
      (t) => t.textContent!,
    );

    // Every drawn fragment is a run of whole words from some skill's name.
    const words = new Set(pack.skills.flatMap((s) => s.name.split(" ")));
    for (const line of drawn) {
      for (const word of line.split(" ")) {
        expect(words.has(word), `${word} in "${line}"`).toBe(true);
      }
    }
    // And the shortest name in the pack is still whole somewhere on it.
    expect(drawn.join(" ")).toContain("The exposure triangle");
  });

  /** A wrapped label is readable; the full name has to survive for the tooltip. */
  it("keeps every full name on the picture", async () => {
    const { container } = render(await PathPage());
    const titles = [...container.querySelectorAll('svg[role="img"] title')].map(
      (t) => t.textContent!,
    );

    for (const s of pack.skills) {
      expect(titles.some((t) => t.startsWith(`${s.name} —`))).toBe(true);
    }
  });
});

/**
 * The outline is what a learner actually reads, so it carries §24 E6's
 * criterion now: what was skipped is listed with its reason, in the place it
 * was skipped from rather than in a separate list at the bottom of the page.
 */
describe("the outline", () => {
  it("lays out the whole subject before a path has been built", async () => {
    render(await PathPage());

    // The pack's own areas, which is what the graph orders them by.
    expect(screen.getByText("Exposure")).toBeDefined();
    expect(screen.getByText("Optics")).toBeDefined();
  });

  it("names what a locked skill is waiting for", async () => {
    // The state the DAG could never draw: an untouched skill and an
    // unreachable one were the same rectangle.
    render(await PathPage());

    expect(screen.getAllByText("Locked").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Unlocks once you've done/).length,
    ).toBeGreaterThan(0);
  });

  it("names each skipped skill with its reason", async () => {
    // §24 E6's acceptance criterion, and §8's "don't waste my time" promise
    // made visible.
    masteryForMock.mockResolvedValue([held(pack.skills[0]!.slug)]);
    render(await PathPage());

    expect(
      screen.getByText(/You already showed you can/),
    ).toBeDefined();
  });

  it("says nothing about skipping when nothing was skipped", async () => {
    render(await PathPage());
    expect(screen.queryByText(/You already showed you can/)).toBeNull();
  });

  it("counts the states above the list", async () => {
    render(await PathPage());

    // Photography: 6 skills need nothing first, 8 are behind one of those, and
    // the single specialist sits outside a standard course.
    expect(screen.getByText("6 open now")).toBeDefined();
    expect(screen.getByText("8 locked")).toBeDefined();
    expect(screen.getByText("1 optional")).toBeDefined();
  });
});

describe("the modules", () => {
  it("offers to build a path when there isn't one yet", async () => {
    render(await PathPage());
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
          title: "Getting the exposure right",
          targetSkillIds: [pack.skills[0]!.slug],
          estimatedHours: 3,
          outputArtifact: "exercise",
          acceptanceCriteria: [],
          rubricId: null,
        },
        {
          order: 1,
          title: "Shoot it",
          targetSkillIds: [pack.skills[1]!.slug],
          estimatedHours: 2,
          outputArtifact: "project",
          acceptanceCriteria: [],
          rubricId: "r",
        },
        {
          order: 2,
          title: "A module about a skill the pack dropped",
          targetSkillIds: ["a-skill-the-pack-dropped"],
          estimatedHours: 2,
          outputArtifact: "exercise",
          acceptanceCriteria: [],
          rubricId: null,
        },
      ],
    });

    render(await PathPage());

    expect(screen.getByText("Getting the exposure right")).toBeDefined();
    expect(screen.getByText("Shoot it")).toBeDefined();
    expect(screen.getByText("Graded")).toBeDefined();
    // A stored module outlives the pack it was written against. A module left
    // with nothing to teach goes, rather than sitting there as an empty
    // heading over work that no longer exists.
    expect(
      screen.queryByText("A module about a skill the pack dropped"),
    ).toBeNull();
    expect(screen.queryByText("a-skill-the-pack-dropped")).toBeNull();
    // One filled button per screen: the offer to build is replaced by the
    // offer to get on with it.
    expect(screen.queryByText("Build my path")).toBeNull();
    expect(screen.getByRole("link", { name: /Start today/ })).toBeDefined();

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
    render(await PathPage());
    expect(
      screen.queryByText("What we checked before showing you this"),
    ).toBeNull();
  });
});

describe("§24 E9's rule", () => {
  it("shows no percentage anywhere", async () => {
    masteryForMock.mockResolvedValue([held(pack.skills[0]!.slug)]);
    const { container } = render(await PathPage());
    // Measuring progress and measuring consumption are different things.
    expect(container.textContent).not.toMatch(/\d\s?%|percent/i);
  });
});

describe("what the pack is", () => {
  it("says nothing extra about a pack a person wrote and checked", async () => {
    render(await PathPage());
    expect(screen.queryByText(/Experimental/)).toBeNull();
  });

  it("tells a learner when their path was built on request", async () => {
    // §7.1 — the path is the screen people show other people, so it is the
    // last place a generated pack should be able to pass as a curated one.
    activeGoalMock.mockResolvedValue({ ...goal, packSlug: "rust-programming" });
    packFromDbMock.mockResolvedValue({ ...pack, slug: "rust-programming", maturity: "generated" });

    render(await PathPage());
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
    render(await PathPage());

    expect(screen.getByText("Sprint")).toBeTruthy();
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("Mastery")).toBeTruthy();
    expect(screen.getByText("Your course")).toBeTruthy();
  });

  it("prices each size in skills and hours", async () => {
    render(await PathPage());

    // Photography: 10 skills at sprint, 14 at standard, 15 at mastery.
    expect(screen.getByText(/10 skills · 17h/)).toBeTruthy();
    expect(screen.getByText(/14 skills · 25h/)).toBeTruthy();
    expect(screen.getByText(/15 skills · 27\.5h/)).toBeTruthy();
  });

  /**
   * The dial used to put its whole answer on the button — "Drop 4 skills" —
   * which is the size of a decision with none of its content. Four skills out
   * of a photography course could be the colour work or it could be the reason
   * the learner signed up.
   */
  it("names the skills a switch would drop, not just how many", async () => {
    render(await PathPage());

    const { container } = render(await PathPage());
    const sprint = [...container.querySelectorAll("details.group.w-full")].find(
      (d) => d.textContent?.startsWith("Leaves out 4 skills"),
    )!;

    // Sprint drops the four advanced skills, by name.
    expect(sprint).toBeDefined();
    for (const name of [
      "Working within dynamic range",
      "Focal length and perspective",
      "Separating subject from background",
      "Tonal correction",
    ]) {
      expect(sprint.textContent).toContain(name);
    }
    // Four is under the threshold, so it is simply there: a four-line list a
    // learner has to click for is a decision made harder to inspect.
    expect(sprint.hasAttribute("open")).toBe(true);
  });

  it("names the skill a deeper course would take on", async () => {
    const { container } = render(await PathPage());
    const mastery = [...container.querySelectorAll("details.group.w-full")].find(
      (d) => d.textContent?.startsWith("Adds 1 skill"),
    )!;

    // Mastery adds the one specialist.
    expect(mastery).toBeDefined();
    expect(mastery.textContent).toContain("Consistency across a set");
  });

  it("puts the action on the button and the answer above it", async () => {
    render(await PathPage());

    expect(
      screen.getByRole("button", { name: "Switch to Sprint" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Switch to Mastery" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Drop 4 skills/ })).toBeNull();
  });

  it("promises that a switch cannot cost a proved skill", async () => {
    render(await PathPage());

    expect(
      screen.getByText(/never takes away a skill you.{0,3}ve already proved/i),
    ).toBeTruthy();
  });

  it("describes each size by what the learner gets, not how it is computed", async () => {
    render(await PathPage());

    // §8's honesty rule cuts both ways: the copy must not leak the mechanism.
    expect(screen.queryByText(/prerequisite closure/i)).toBeNull();
    expect(screen.queryByText(/specialist level/i)).toBeNull();
  });

  it("moves the marker when the goal is on another depth", async () => {
    activeGoalMock.mockResolvedValue({
      ...goal,
      spec: { ...goal.spec, depth: "sprint" },
    });
    render(await PathPage());

    // Nothing to leave out of the shortest course; both others only add.
    expect(screen.queryByText(/Leaves out/)).toBeNull();
    expect(screen.getAllByText(/^Adds /).length).toBe(2);
    expect(
      screen.getAllByRole("button", { name: /^Switch to / }).length,
    ).toBe(2);
  });

  /**
   * A long list folds so that three cards in a row stay the same height. It is
   * `<details>`, so the names are in the HTML either way — the disclosure is a
   * layout decision, never a way of not answering.
   */
  it("folds a long list of changes rather than stretching the card", async () => {
    activeGoalMock.mockResolvedValue({
      ...goal,
      spec: { ...goal.spec, depth: "mastery" },
    });
    const { container } = render(await PathPage());

    // Sprint leaves out five skills from a mastery course, standard one.
    const sprint = [...container.querySelectorAll("details.group.w-full")].find(
      (d) => d.textContent?.startsWith("Leaves out 5 skills"),
    )!;

    expect(sprint.hasAttribute("open")).toBe(false);
    expect(sprint.textContent).toContain("Consistency across a set");
  });
});
