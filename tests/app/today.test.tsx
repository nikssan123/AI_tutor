// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { shortDate } from "@/lib/calendar/dates";
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
// Whether a new session would be refused. Read on every visit now, so the wall
// is drawn before the press rather than walked into.
const lockedMock = vi.fn(async (..._a: unknown[]) => false);

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
/**
 * Whether the tutor will actually answer. The page only advertises it when the
 * session screen would draw the panel, so the two cannot promise different
 * things — and a suite whose result depended on whether the machine running it
 * had a key exported would be worse than either branch.
 */
const apiKey = vi.fn(() => true);
vi.mock("@/lib/ai/client", () => ({ hasApiKey: () => apiKey() }));
/**
 * The dated band under the session card. Stubbed for `todayFor`'s reason: what
 * it computes is tested in tests/calendar/upcoming.test.ts, and the question
 * here is whether the rows reach the screen saying what they rest on.
 */
const upcomingMock = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
/**
 * The page reads the real clock, so these are relative. A fixed "18 Aug" would
 * be a test that passes in August and fails in September.
 */
const dayFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
vi.mock("@/lib/calendar/upcoming", () => ({
  upcomingFor: (...a: unknown[]) => upcomingMock(...(a as [])),
}));
vi.mock("@/lib/billing/gate", () => ({
  nudgeAt: (...a: unknown[]) => nudgeMock(...(a as [])),
  sessionsLocked: (...a: unknown[]) => lockedMock(...(a as [])),
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
  apiKey.mockReturnValue(true);
  upcomingMock.mockResolvedValue([]);
  // `clearAllMocks` clears calls, not implementations, so this has to be put
  // back or one test's spent month leaks into the next one's.
  lockedMock.mockResolvedValue(false);
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
    // To the question they stopped on, not the top of a conversation they have
    // already had — `/start` opens at the first thing they were asked.
    expect(
      screen.getByRole("link", { name: "Carry on" }).getAttribute("href"),
    ).toBe("/start#latest");
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
    /*
     * Onto the button, not onto the intake screen and good luck. The offer is
     * "build it"; landing at the top of six exchanges with the button below the
     * fold makes the reader hunt for the thing the link just promised.
     */
    expect(
      screen.getByRole("link", { name: "Build it" }).getAttribute("href"),
    ).toBe("/start#ready");
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
    // A block says what it asks for, not what it is about. Printing the skill
    // on every line made two different sessions preview identically — the same
    // three lines, so the next session read as the one just finished.
    expect(screen.getByText(`A lesson on ${pack.skills[1]!.name}`)).toBeDefined();
  });

  /**
   * The band was called "Your path" and linked nowhere.
   *
   * It has always printed two counts off the projection, on the screen people
   * open daily, while the screen that lays the whole course out had one inbound
   * link in the entire product — from `/calendar`'s empty state.
   */
  it("offers the path it is named after", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    const link = screen.getByRole("link", { name: "See all of it" });
    expect(link.getAttribute("href")).toBe("/path");
  });

  /**
   * §8 screen 7's tutor, which was reported as missing by someone who had never
   * started a session — correctly, because nothing outside one said it existed.
   */
  it("says a tutor comes with the session", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText(/A tutor sits with you through every block/)).toBeDefined();
  });

  it("does not promise a tutor that cannot answer", async () => {
    // The same condition the session screen swaps the panel out on. Advertising
    // it here regardless would be a promise the next screen visibly breaks.
    apiKey.mockReturnValue(false);
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.queryByText(/A tutor sits with you/)).toBeNull();
  });

  it("does not offer a tutor for a session with nothing in it", async () => {
    todayForMock.mockResolvedValue(view({ session: { blocks: [] } }));
    render(await TodayPage({ searchParams: search() }));

    expect(screen.queryByText(/A tutor sits with you/)).toBeNull();
  });

  /**
   * `/progress` holds the month and keeps it, but "is anything about to land on
   * me" is a question a learner has every morning — and answering it used to
   * cost two clicks and a scroll past the week's own read.
   */
  it("says what is coming, in the words the dates already have", async () => {
    const day = dayFromNow(5);
    upcomingMock.mockResolvedValue([
      {
        day,
        kind: "retrieval",
        certainty: "due",
        title: "3 questions come back to you",
        detail: "Metering · Exposure triangle · White balance",
      },
    ]);
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("3 questions come back to you")).toBeDefined();
    expect(
      screen.getByText("Metering · Exposure triangle · White balance"),
    ).toBeDefined();
    // Both halves of a date: the day itself — weekday included, so it can be
    // checked against your own week — and how far off it is.
    expect(screen.getByText(shortDate(day))).toBeDefined();
    expect(screen.getByText("in 5 days")).toBeDefined();
  });

  it("offers the month rather than reproducing it", async () => {
    upcomingMock.mockResolvedValue([
      {
        day: dayFromNow(4),
        kind: "retrieval",
        certainty: "due",
        title: "3 questions come back to you",
        detail: "Metering",
      },
    ]);
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(
      screen.getByRole("link", { name: "See the month" }).getAttribute("href"),
    ).toBe("/progress");
  });

  /**
   * Overdue is a fact about a date that has passed, so it is only ever said
   * about something that was actually owed — the same distinction `/progress`
   * draws, because a projection cannot be late.
   */
  it("marks work that was owed and has not been done", async () => {
    upcomingMock.mockResolvedValue([
      {
        day: dayFromNow(-3),
        kind: "retrieval",
        certainty: "due",
        title: "1 question comes back to you",
        detail: "Metering",
      },
    ]);
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.getByText("Waiting")).toBeDefined();
  });

  it("does not call a projection overdue", async () => {
    const day = dayFromNow(-3);
    upcomingMock.mockResolvedValue([
      {
        day,
        kind: "lapse",
        certainty: "projected",
        title: "Exposure triangle stops counting",
        detail: "You showed this once.",
      },
    ]);
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.queryByText("Waiting")).toBeNull();
    expect(screen.getByText(shortDate(day))).toBeDefined();
    expect(screen.getByText("3 days ago")).toBeDefined();
  });

  /**
   * §8 screen 6's "no feed, no browse" is the rule this band is closest to
   * breaking, and a permanent row saying "nothing is due" is exactly the
   * furniture that rule exists to keep off the screen.
   */
  it("drops the whole band rather than furnishing an empty one", async () => {
    upcomingMock.mockResolvedValue([]);
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    expect(screen.queryByText("What's coming")).toBeNull();
    expect(screen.queryByRole("link", { name: "See the month" })).toBeNull();
  });

  it("asks for the band against the learner's own goal and pack", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    const [, input] = upcomingMock.mock.calls[0] as [
      unknown,
      { userId: string; goal: { id: string } },
    ];
    expect(input.userId).toBe("u1");
    expect(input.goal.id).toBe("g1");
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

  /**
   * The press was reported as doing nothing for half a minute.
   *
   * It was doing plenty — re-planning the day, checking the allowance, opening
   * the session — but a server action posts over `fetch`, so the browser has no
   * navigation to spin and this screen stays exactly as it was until the
   * session arrives. `SubmitButton` is the acknowledgement, and its live region
   * is the part a plain `Button` cannot fake: asserting on it here means
   * swapping the component back fails the suite instead of shipping.
   *
   * What the region *says* while pending is `SubmitButton`'s own test, driving
   * a real form action. This one only asks that this screen still uses it.
   */
  it("acknowledges the press instead of sitting there unchanged", async () => {
    todayForMock.mockResolvedValue(view());
    render(await TodayPage({ searchParams: search() }));

    const form = screen
      .getByRole("button", { name: "Start session" })
      .closest("form")!;
    expect(within(form).getByRole("status")).toBeDefined();
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
    // The brief and the question, not the skill name twice over.
    expect(screen.getByText("b")).toBeDefined();
    expect(screen.getByText("p")).toBeDefined();
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

describe("asking for money", () => {
  const SESSIONS = {
    reason: "sessions_spent",
    headline: "That's this month's sessions",
    body: "On a paid plan you would have carried straight on.",
    cta: "Compare the plans",
    href: "/pricing",
  };

  const LOCKED = {
    reason: "course_locked",
    headline: "You can see all of this course, and read one lesson of it",
    body: "Free includes one lesson on any course.",
    cta: "Try everything for four days",
    href: "/pricing",
  };

  it("offers the upgrade above the session band when they are stopped", async () => {
    nudgeMock.mockResolvedValue(SESSIONS);

    render(await TodayPage({ searchParams: search({ error: "sessions" }) }));

    expect(
      screen.getByRole("heading", { name: SESSIONS.headline }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Compare the plans" }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("says what free includes on an ordinary visit", async () => {
    /*
     * This screen used to ask for nothing at all unless somebody had just been
     * bounced off a second session. That made the whole paywall unreachable for
     * the learner it was written for: sign up, read the one lesson free
     * includes, browse for a week, never press anything twice, never be
     * stopped, never be asked. A standing condition needs no wall.
     */
    nudgeMock.mockResolvedValue(LOCKED);

    render(await TodayPage({ searchParams: search() }));

    expect(nudgeMock).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      undefined,
      "course_locked",
    );
    expect(screen.getByRole("heading", { name: LOCKED.headline })).toBeTruthy();
  });

  it("shows one card, never two, when both could be true", async () => {
    /*
     * The accumulation `src/lib/billing/nudge.ts` exists to prevent: each
     * prompt reasonable on its own, nobody ever seeing them together. A learner
     * whose sessions are spent is also a learner with a capped course, so both
     * questions answer yes — and the wall they just hit wins, because it is
     * about what they were trying to do a second ago.
     */
    nudgeMock.mockResolvedValue(SESSIONS);

    render(await TodayPage({ searchParams: search({ error: "sessions" }) }));

    expect(screen.getAllByRole("link", { name: /Compare the plans|four days/ }))
      .toHaveLength(1);
    expect(screen.queryByRole("heading", { name: LOCKED.headline })).toBeNull();
    // Asked once. The standing question is never put when a wall answered.
    expect(nudgeMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The wall a learner could only find by walking into it.
   *
   * `startSessionAction` has always refused past the month's allowance and sent
   * them back with `?error=sessions` — so until they pressed the product's
   * biggest button, the screen showed a full plan and a live Start button. It
   * read as "go ahead" right up to the moment it did not, and a free account
   * that never pressed twice was never told there was anything to buy.
   */
  it("locks the button, and says so, before the press", async () => {
    todayForMock.mockResolvedValue(view());
    lockedMock.mockResolvedValue(true);
    nudgeMock.mockResolvedValue(SESSIONS);

    render(await TodayPage({ searchParams: search() }));

    const button = screen.getByRole("button", { name: "Start session" });
    expect(button.hasAttribute("disabled")).toBe(true);
    // Shown locked rather than hidden: a control that vanishes reads as a bug,
    // one that is greyed reads as a price.
    expect(screen.getByText(/That’s this month’s session/)).toBeDefined();
    // And the ask is on screen without having to be walked into.
    expect(screen.getByRole("heading", { name: SESSIONS.headline })).toBeTruthy();
  });

  it("never locks somebody out of a session they are in the middle of", async () => {
    // The one exception `startSessionAction` makes, for the reason it makes it:
    // an unfinished session is not a new one, and stranding a learner mid-way
    // behind a paywall is worse than not letting them begin.
    lockedMock.mockResolvedValue(true);
    todayForMock.mockResolvedValue({ ...view(), openSessionId: "s-1" });

    render(await TodayPage({ searchParams: search() }));

    const button = screen.getByRole("button", { name: "Carry on" });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("leaves a plan with no session cap alone", async () => {
    todayForMock.mockResolvedValue(view());
    lockedMock.mockResolvedValue(false);
    nudgeMock.mockResolvedValue(undefined);

    render(await TodayPage({ searchParams: search() }));

    expect(
      screen.getByRole("button", { name: "Start session" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("does not ask whether a session is locked when one is already open", async () => {
    // Resuming is not starting. The action makes the same exception, and asking
    // buys a query whose answer cannot change what this screen renders.
    todayForMock.mockResolvedValue({ ...view(), openSessionId: "s-1" });

    render(await TodayPage({ searchParams: search() }));
    expect(lockedMock).not.toHaveBeenCalled();
  });

  it("says nothing when the resolver declines to sell", async () => {
    // A plan with no ceiling in front of it is never shown a way past one —
    // and that now has to hold for both questions, not just the wall.
    nudgeMock.mockResolvedValue(undefined);

    render(await TodayPage({ searchParams: search() }));

    expect(screen.queryByRole("link", { name: /Compare the plans|four days/ }))
      .toBeNull();
  });
});
