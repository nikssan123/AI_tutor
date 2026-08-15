// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { findPack } from "@/lib/content";
import { cookieName, encode } from "@/lib/check/session";
import { EMPTY_INTAKE, type Intake } from "@/lib/goals/intake-store";
import type { GoalStatus } from "@/lib/goals/lifecycle";
import type { CourseSummary } from "@/components/course-list";
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
const loadIntakeMock = vi.fn();
const coursesForMock = vi.fn();
const buildInFlightForMock = vi.fn();

/** Check cookies, by name, for the "your check comes with you" promise. */
const jar = new Map<string, string>();

const nudgeMock = vi.fn(async (..._a: unknown[]) => undefined as unknown);

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/billing/gate", () => ({
  nudgeAt: (...a: unknown[]) => nudgeMock(...(a as [])),
}));
vi.mock("@/lib/goals/today", () => ({
  todayFor: (...args: unknown[]) => todayForMock(...(args as [])),
}));
// Partial: only the read is stubbed. `EMPTY_INTAKE` is the real constant, so a
// change to what "no conversation" means reaches these tests.
vi.mock("@/lib/goals/intake-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals/intake-store")>()),
  loadIntake: (...args: unknown[]) => loadIntakeMock(...(args as [])),
}));
// Partial again: `pickUpAgain` is the real filter, so which statuses count as
// "pick it up" is decided in one place and this file cannot disagree with it.
vi.mock("@/lib/goals/courses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals/courses")>()),
  coursesFor: (...args: unknown[]) => coursesForMock(...(args as [])),
}));
// The three reads above are what `standingFor` composes, so the real
// composition runs here — only the queries are stubbed. Which of the three
// offers wins is decided in `standing.ts`, and this file cannot disagree.
vi.mock("@/lib/packs/build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/build")>()),
  buildInFlightFor: (...args: unknown[]) => buildInFlightForMock(...(args as [])),
}));

const { default: TodayPage } = await import("@/app/(app)/today/page");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const search = (params: { minutes?: string; error?: string } = {}) =>
  Promise.resolve(params);
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
  jar.clear();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  loadIntakeMock.mockResolvedValue(EMPTY_INTAKE);
  coursesForMock.mockResolvedValue([]);
  buildInFlightForMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("before there is a goal", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(TodayPage({ searchParams: search() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/today/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

/**
 * The screen that used to be one card and one button, repeated verbatim on
 * three other destinations. What it owes the learner is something to do — so
 * these assert on the offers being present, not on the wording around them.
 */
describe("with no course running", () => {
  beforeEach(() => {
    todayForMock.mockResolvedValue(undefined);
  });

  it("offers to start one, in the learner's own words", async () => {
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("Pick something to get good at")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Tell us what you want" }).getAttribute("href"),
    ).toBe("/start");
  });

  it("shows a sample of subjects and a way to see the rest", async () => {
    render(await TodayPage({ searchParams: search() }));

    // Every subject on the sample offers both doors: start it, or check first.
    expect(screen.getAllByRole("link", { name: "Take the check" }).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "See everything" }).getAttribute("href"),
    ).toBe("/subjects");
  });

  it("never grows into a browse screen — the sample stays a sample", async () => {
    render(await TodayPage({ searchParams: search() }));

    const shown = screen.getAllByRole("link", { name: /^Take the check$|^Check again$/ });
    expect(shown.length).toBeLessThanOrEqual(4);
  });

  it("carries an anonymous check into the course it offers", async () => {
    // One answered item in the first subject's cookie is enough to promise it.
    jar.set(cookieName(pack.slug), encode({ s: 1, a: [{ i: "item-1", c: 1 }] }));
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("Your check comes with you")).toBeDefined();
  });

  it("does not claim the learner has no goal, which it cannot know", async () => {
    render(await TodayPage({ searchParams: search() }));
    expect(screen.queryByText(/don't have a goal yet/i)).toBeNull();
  });
});

/**
 * A course put aside is a better offer than the catalogue: already chosen,
 * already backed by mastery, and the retrieval queue kept running while it was
 * away. It gets its own band rather than competing for the primary card, so the
 * learner does not have to choose between resuming and starting.
 */
describe("with a course put aside", () => {
  beforeEach(() => {
    todayForMock.mockResolvedValue(undefined);
  });

  const course = (status: GoalStatus): CourseSummary => ({
    goalId: "g-old",
    name: "Photography",
    taxonomyParent: "creative",
    status,
  });

  it("offers to pick a paused one back up", async () => {
    coursesForMock.mockResolvedValue([course("paused")]);
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("Pick one back up")).toBeDefined();
    expect(screen.getByRole("button", { name: "Pick it up" })).toBeDefined();
  });

  it("offers a stopped one too — stopping is not a door locked behind you", async () => {
    coursesForMock.mockResolvedValue([course("abandoned")]);
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Pick it up" })).toBeDefined();
  });

  /**
   * A finished course has no action on it, so offering it as a way back in
   * would be offering a row that does nothing when tapped.
   */
  it("does not offer a finished one", async () => {
    coursesForMock.mockResolvedValue([course("achieved")]);
    render(await TodayPage({ searchParams: search() }));

    expect(screen.queryByText("Pick one back up")).toBeNull();
  });

  it("says the proof survives being put aside", async () => {
    coursesForMock.mockResolvedValue([course("paused")]);
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText(/still yours/i)).toBeDefined();
  });
});

/**
 * §8 screen 3's conversation persists in `goal_intake`, and nothing anywhere
 * told the learner it was still there. A conversation someone walked away from
 * is a better offer than a fresh one, so it takes the primary slot.
 */
describe("with a conversation left unfinished", () => {
  beforeEach(() => {
    todayForMock.mockResolvedValue(undefined);
  });

  const partway = (overrides: Partial<Intake> = {}): Intake => ({
    ...EMPTY_INTAKE,
    messages: [
      { r: "l", t: "I want to take better photos" },
      { r: "a", t: "How much time have you got each week?" },
    ],
    captured: { subject: "Photography" } as Intake["captured"],
    ...overrides,
  });

  it("offers to carry on, and says how far in they got", async () => {
    loadIntakeMock.mockResolvedValue(partway());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("You were partway through")).toBeDefined();
    // Specific enough not to collide with the subject of the same name in the
    // sample below, which is a different offer about the same word.
    expect(screen.getByText(/We were talking about Photography/)).toBeDefined();
    expect(screen.getByText(/1 of 6 questions answered/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Carry on" }).getAttribute("href"),
    ).toBe("/start");
  });

  it("does not name a subject the analyzer never settled on", async () => {
    loadIntakeMock.mockResolvedValue(partway({ captured: undefined }));
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText(/working out what you wanted/i)).toBeDefined();
  });

  /**
   * Answered everything and never pressed the button. "Carry on answering" and
   * "we have everything, build it" are different offers, and the second is the
   * better thing to have walked away from.
   */
  it("offers to build rather than to carry on once the analyzer has closed", async () => {
    loadIntakeMock.mockResolvedValue(partway({ done: true }));
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("Your course is ready to build")).toBeDefined();
    expect(screen.getByText(/just needs building/i)).toBeDefined();
    expect(screen.getByRole("link", { name: "Build it" })).toBeDefined();
  });

  it("is not offered for a conversation that never had a turn in it", async () => {
    loadIntakeMock.mockResolvedValue(EMPTY_INTAKE);
    render(await TodayPage({ searchParams: search() }));

    expect(screen.queryByText("You were partway through")).toBeNull();
    expect(screen.getByText("Pick something to get good at")).toBeDefined();
  });
});

/**
 * §7.1's Generated tier takes about three minutes, and a learner who walks away
 * from the wait screen is still mid-course-creation. The screen used to offer
 * them "Build it" — a button that fails, because they already have a course
 * being built.
 */
describe("with a subject being written for them", () => {
  const building = {
    slug: "kite-surfing",
    subject: "Kite surfing",
    status: "building" as const,
    detail: null,
    startedAt: new Date("2026-08-13T09:00:00.000Z"),
  };

  beforeEach(() => {
    todayForMock.mockResolvedValue(undefined);
    buildInFlightForMock.mockResolvedValue(building);
    // The conversation that started the build is still on file, and is the
    // offer this one has to beat.
    loadIntakeMock.mockResolvedValue({
      ...EMPTY_INTAKE,
      messages: [{ r: "l", t: "kite surfing" }],
      captured: { subject: "Kite surfing" } as Intake["captured"],
      done: true,
    });
  });

  it("says the course is being written, and sends them to the wait screen", async () => {
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText(/writing your course now/)).toBeDefined();
    expect(screen.getByText(/Nobody had written Kite surfing/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: /See how it/ }).getAttribute("href"),
    ).toBe("/start/building?subject=kite-surfing");
  });

  it("does not offer to build a course that is already being built", async () => {
    render(await TodayPage({ searchParams: search() }));

    expect(screen.queryByRole("link", { name: "Build it" })).toBeNull();
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

    // §4.2 law 5 — scope reduction is never silent, so the telling has to be
    // loud enough to count as telling. The planner's own sentence, under a
    // claim that says what it is about.
    expect(screen.getByText("Dropped 3 skills to make 1 December.")).toBeDefined();
    expect(
      screen.getByText("Your deadline is deciding what fits"),
    ).toBeDefined();
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
    // And said where they are looking, not only on the button. A label that
    // reads "Carry on" instead of "Start session" is a difference you can only
    // notice if you already know both labels exist.
    expect(screen.getByText("Already started")).toBeDefined();
  });

  it("says nothing about an open session when there isn't one", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));
    expect(screen.queryByText("Already started")).toBeNull();
  });

  /**
   * The one important event in the product that had no surface at all.
   *
   * A learner between courses is told their subject is being written —
   * `standingFor` reads the row and `NothingRunning` says so. A learner who
   * already had a course running was told nothing, anywhere: the build was
   * happening on their behalf and the only screen that mentioned it was a wait
   * page they would have had to remember the URL of.
   */
  it("says a second subject is being written while a course runs", async () => {
    todayForMock.mockResolvedValue(view());
    buildInFlightForMock.mockResolvedValue({
      slug: "kite-surfing",
      subject: "Kite surfing",
      requestedBy: "u1",
      status: "building" as const,
      stage: null,
      detail: null,
      startedAt: new Date("2026-08-13T09:00:00.000Z"),
    });
    render(await TodayPage({ searchParams: search() }));

    expect(
      screen.getByText("We’re writing your Kite surfing course"),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: /See how it/ }).getAttribute("href"),
    ).toBe("/start/building?subject=kite-surfing");
    // And it does not leave them wondering which course today's session is on.
    expect(screen.getByText(/is on Photography and is unaffected/)).toBeDefined();
  });

  it("draws no build band when nothing is being built", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));
    expect(screen.queryByRole("link", { name: /See how it/ })).toBeNull();
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

describe("what the pack is", () => {
  it("says nothing extra about a pack a person wrote and checked", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));
    expect(screen.queryByText(/Experimental/)).toBeNull();
  });

  it("tells a learner when their course was built on request", async () => {
    /*
     * §7.1 — depth is declared, not faked. Someone who never saw the wait
     * screen would otherwise have nothing on the screen they live on telling
     * them their course has not been read by a person.
     */
    const generated = view();
    todayForMock.mockResolvedValue({
      ...generated,
      pack: { ...generated.pack, maturity: "generated" },
    });

    render(await TodayPage({ searchParams: search() }));
    expect(screen.getByText(/Experimental/)).toBeDefined();
  });
});

describe("when the month's sessions are spent", () => {
  it("offers the upgrade above the session band", async () => {
    // The one wall on this screen, so the one thing on it that may ask for
    // money — and it asks with what a paid plan would have done instead.
    nudgeMock.mockResolvedValue({
      reason: "sessions_spent",
      headline: "That's this month's sessions",
      body: "On a paid plan you would have carried straight on.",
      cta: "Compare the plans",
      href: "/pricing",
    });

    render(await TodayPage({ searchParams: search({ error: "sessions" }) }));

    expect(
      screen.getByRole("heading", { name: "That's this month's sessions" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Compare the plans" }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("says nothing on an ordinary visit", async () => {
    render(await TodayPage({ searchParams: search() }));

    expect(nudgeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Compare the plans" })).toBeNull();
  });

  it("says nothing when the resolver declines to sell", async () => {
    // A plan with no session wall in front of it is never shown a way past one.
    nudgeMock.mockResolvedValue(undefined);
    render(await TodayPage({ searchParams: search({ error: "sessions" }) }));

    expect(screen.queryByRole("link", { name: "Compare the plans" })).toBeNull();
  });
});
