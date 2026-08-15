// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Intake } from "@/lib/goals/intake-store";
import { EMPTY_INTAKE } from "@/lib/goals/intake-store";
import type { CapturedGoal } from "@/lib/goals/analyzer";

/**
 * §8 screen 3 as it is actually rendered, and the actions behind it.
 *
 * The properties worth holding: the turn cap is enforced by the server and not
 * by the model, a subject we do not have starts a build rather than failing,
 * and every transition works with no client JavaScript.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const runAnalyzerMock = vi.fn();
const startBuildMock = vi.fn();
const sendMock = vi.fn(async () => undefined);
// Typed to take its arguments so a test can read them back: a bare
// `vi.fn(async () => …)` infers an empty tuple, and `mock.calls[0]![1]` on that
// is a type error rather than the assertion it looks like.
const createGoalMock = vi.fn(async (..._a: unknown[]) => "goal-1");
const saveIntakeMock = vi.fn(
  async (_db: unknown, _userId: string, _intake: Intake) => undefined,
);
const clearIntakeMock = vi.fn(async () => undefined);
const findBuildMock = vi.fn(async () => undefined as unknown);
const packMock = vi.fn(async (_db: unknown, slug: unknown): Promise<unknown> =>
  slug === "photography"
    ? { slug: "photography", name: "Photography", skills: [{ slug: "a" }] }
    : undefined,
);

let intake: Intake = { ...EMPTY_INTAKE };

vi.mock("next/headers", () => ({
  cookies: async () => new Map(),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  // The composer is a client component now; the page renders it.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/lib/billing/store", () => ({
  entitlementsForUser: (...a: unknown[]) => entitlementsMock(...(a as [])),
}));
const freshEntitlements = () => ({
  planId: "pro",
  entitlements: {
    evaluationsPerMonth: 10,
    sessionsPerMonth: null as number | null,
    aiCurriculum: true,
    lessonsPerCourse: null as number | null,
    packBuildsLifetime: null as number | null,
    premiumModels: true,
  },
  spendCapCents: 1_500,
  source: "plan",
});
const entitlementsMock = vi.fn(async (..._a: unknown[]) => freshEntitlements());
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => ({}) }));
vi.mock("@/lib/ai/runlog", () => ({
  logCall: async (_db: unknown, _u: unknown, r: unknown) => r,
}));
vi.mock("@/lib/goals/analyzer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals/analyzer")>()),
  runAnalyzer: (...args: unknown[]) => runAnalyzerMock(...args),
}));
vi.mock("@/lib/goals/intake-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals/intake-store")>()),
  loadIntake: async () => intake,
  saveIntake: (db: unknown, userId: string, next: Intake) =>
    saveIntakeMock(db, userId, next),
  clearIntake: (...a: unknown[]) => clearIntakeMock(...(a as [])),
}));
vi.mock("@/lib/goals/store", () => ({
  createGoal: (...a: unknown[]) => createGoalMock(...(a as [])),
}));
/**
 * How many packs this account has ever commissioned — the free tier's lifetime
 * quota. Mocked rather than seeded because every assertion below is about what
 * the screen does with the number, not about how it is counted.
 */
const commissionedMock = vi.fn(async () => 0);
const finishBuildMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/packs/build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/build")>()),
  startBuild: (...a: unknown[]) => startBuildMock(...(a as [])),
  findBuild: (...a: unknown[]) => findBuildMock(...(a as [])),
  finishBuild: (...a: unknown[]) => finishBuildMock(...(a as [])),
  buildsCommissionedBy: () => commissionedMock(),
}));
// The wait screen asks whether the pack exists yet; that is the real answer,
// and the build row is only how the learner got to the screen.
vi.mock("@/lib/content/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content/resolve")>()),
  resolvePack: (db: unknown, slug: string) => packMock(db, slug),
}));
vi.mock("@/lib/inngest/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inngest/client")>()),
  inngest: { send: sendMock },
}));
vi.mock("@/lib/packs/read", () => ({ packFromDb: async () => undefined }));
// The screen resolves an arriving brief itself, so nothing a visitor can put
// in the query string reaches the page unless it names a project we publish.
const findProjectMock = vi.fn((_slug: string) => undefined as unknown);
vi.mock("@/lib/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content")>()),
  findProject: (slug: string) => findProjectMock(slug),
}));

const { default: StartPage } = await import("@/app/(app)/start/page");
const { default: BuildingPage } = await import(
  "@/app/(app)/start/building/page"
);
const {
  buildFromConversationAction,
  openAction,
  replyAction,
  restartAction,
  startFreshAction,
  adoptBuiltPackAction,
  requestBuildAction,
} = await import("@/app/(app)/start/actions");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const search = (
  params: { error?: string; topic?: string; project?: string } = {},
) => Promise.resolve(params);

const captured = (over: Partial<CapturedGoal> = {}): CapturedGoal => ({
  subject: "Rust programming",
  matchedPack: null,
  outcomeType: "career",
  statedLevel: "none",
  weeklyHours: 4,
  deadline: null,
  motivation: null,
  constraints: [],
  existingAssets: [],
  priorDomain: "none",
  ...over,
});

const turn = (over: Record<string, unknown> = {}) => ({
  status: "ok" as const,
  value: {
    reply: "How much time do you have?",
    captured: captured(),
    clarity: 0.3,
    done: false,
    chips: ["1-2 hrs", "3-5 hrs"],
    ...over,
  },
});

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  intake = { ...EMPTY_INTAKE };
  getSessionMock.mockResolvedValue(SIGNED_IN);
  // Explicit, because `clearAllMocks` clears calls but keeps a return value a
  // previous test set — which would leak a brief into every screen after it.
  findProjectMock.mockReturnValue(undefined);
  runAnalyzerMock.mockResolvedValue(turn());
  // Same reason as the brief above, and it bites harder: a test that drops the
  // learner onto free leaves every later one there, so seven unrelated builds
  // start failing on an entitlement none of them set.
  entitlementsMock.mockResolvedValue(freshEntitlements());
  startBuildMock.mockResolvedValue({ kind: "started" });
  findBuildMock.mockResolvedValue(undefined);
  packMock.mockImplementation(async (_db: unknown, slug: unknown) =>
    slug === "photography"
      ? { slug: "photography", name: "Photography", skills: [{ slug: "a" }] }
      : undefined,
  );
});

afterEach(cleanup);

describe("the screen", () => {
  it("sends a signed-out visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(StartPage({ searchParams: search() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("carries the typed subject through sign-in and back", async () => {
    // Without this the offer on /learn is a lie for anyone signed out: they
    // are told we will build their subject, then asked what it is again.
    getSessionMock.mockResolvedValue(null);
    await expect(
      StartPage({ searchParams: search({ topic: "basket weaving" }) }),
    ).rejects.toThrow(
      "REDIRECT:/sign-in?next=%2Fstart%3Ftopic%3Dbasket%2520weaving",
    );
  });

  it("offers to open the conversation before there is one", async () => {
    const { container } = render(await StartPage({ searchParams: search() }));
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    // Nothing to seed from, so the analyzer asks the first question.
    expect(container.querySelector("input[name=reply]")).toBeNull();
  });

  /*
   * The way in from `/learn`, which offers to build a subject nothing covers.
   * Making them type it again on arrival is the kind of small betrayal that
   * ends an intake before it starts.
   */
  it("opens with what the visitor already typed, when they came with one", async () => {
    const { container } = render(
      await StartPage({ searchParams: search({ topic: "  basket weaving  " }) }),
    );

    expect(screen.getByText(/basket weaving/)).toBeDefined();
    // Sent as the learner's first message rather than held for later, so the
    // analyzer's opening question responds to it.
    const seeded = container.querySelector<HTMLInputElement>(
      "input[name=reply]",
    )!;
    expect(seeded.type).toBe("hidden");
    expect(seeded.value).toBe("basket weaving");
  });

  /*
   * Arriving with a subject while an old conversation is still sitting there.
   * The screen rendered the old one and said nothing about the topic, so
   * `/start?topic=javascript` opened a half-finished conversation about
   * Japanese — which reads as the product having invented both the subject and
   * the answers underneath it.
   */
  it("offers the subject they arrived with, not the one they abandoned", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "Studied any Japanese before?" }],
      captured: captured({ subject: "Japanese" }),
    };
    const { container } = render(
      await StartPage({ searchParams: search({ topic: "javascript" }) }),
    );

    expect(screen.getByText(/Start on “javascript”\?/)).toBeDefined();
    expect(screen.getByText(/still have a conversation going about Japanese/))
      .toBeDefined();

    // One click starts the new one, carrying what they typed.
    const seeded = container.querySelector<HTMLInputElement>(
      "input[name=reply]",
    )!;
    expect(seeded.value).toBe("javascript");
    // And the old one is not destroyed behind their back.
    expect(
      screen.getByRole("link", { name: /Carry on with Japanese/ }).getAttribute("href"),
    ).toBe("/start");
  });

  it("says something useful when the old conversation has no subject yet", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "What do you want to learn?" }],
      captured: captured({ subject: null }),
    };
    render(await StartPage({ searchParams: search({ topic: "javascript" }) }));

    expect(screen.getByText(/conversation going about something else/)).toBeDefined();
    expect(screen.getByRole("link", { name: /Carry on where I was/ })).toBeDefined();
  });

  /*
   * Arriving from a graded brief, which is the case that shipped broken.
   *
   * The brief travelled as a sentence in `?topic=` — the parameter a search box
   * fills — so the screen compared a sentence against the stored subject (never
   * equal, so it always collided), rendered the sentence inside `Start on “…”?`
   * quotes and full stop included, and drew the abandoned conversation in full
   * underneath. Reported from the product as "it contains context from my old
   * chats", which is exactly what it was.
   */
  const BRIEF = {
    slug: "sales-dashboard",
    title: "Sales dashboard",
    topicSlug: "sql-data-analysis",
    topicName: "SQL & Data Analysis",
  };

  it("gives a brief the screen, and does not draw the old conversation on it", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "Studied any Japanese before?" }],
      captured: captured({ subject: "Japanese" }),
    };
    findProjectMock.mockReturnValue(BRIEF);

    render(
      await StartPage({ searchParams: search({ project: BRIEF.slug }) }),
    );

    /*
     * The heading names the *course*, not the brief.
     *
     * `Start “Sales dashboard”` read as an offer to do one piece of work, and
     * a brief is not something this product can sell on its own: it belongs to
     * one pack, is marked against that pack's rubric, and proves that pack's
     * skills. The button enrols them in the whole course, so the heading says
     * so — with the brief named right under it, so a reader who came for that
     * brief can still see they are in the right place.
     */
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Start the SQL & Data Analysis course",
    );
    expect(screen.getByText(/“Sales dashboard” is one of its graded briefs/))
      .toBeDefined();

    // The reported symptom, asserted directly: not one word of the old chat.
    expect(screen.queryByText(/Studied any Japanese before\?/)).toBeNull();
    // And no sentence masquerading as a subject in a heading.
    expect(screen.queryByText(/Start on “I want to learn/)).toBeNull();
  });

  it("carries the slug in the form, so a failed turn can come back here", async () => {
    findProjectMock.mockReturnValue(BRIEF);
    const { container } = render(
      await StartPage({ searchParams: search({ project: BRIEF.slug }) }),
    );

    const carried = container.querySelector<HTMLInputElement>(
      "input[name=project]",
    )!;
    // The action cannot recover it from the reply — by then it is prose.
    expect(carried.value).toBe(BRIEF.slug);
  });

  it("posts the brief as the opening line, clearing whatever was held", async () => {
    findProjectMock.mockReturnValue(BRIEF);
    const { container } = render(
      await StartPage({ searchParams: search({ project: BRIEF.slug }) }),
    );

    const seeded = container.querySelector<HTMLInputElement>(
      "input[name=reply]",
    )!;
    // A sentence here is right — this one is posted as a reply to the analyzer,
    // never compared against a subject or rendered as a heading.
    expect(seeded.value).toBe(
      'I want to learn SQL & Data Analysis so I can do the "Sales dashboard" project.',
    );
  });

  /*
   * The brief's own course, sent as a slug alongside that sentence.
   *
   * The brief knows its pack — it belongs to exactly one — and the page used to
   * throw that away and leave the analyzer to recognise it back out of the
   * prose above at the end of the conversation. That is a model call standing
   * in for a fact we were holding.
   */
  it("carries the course the brief belongs to", async () => {
    findProjectMock.mockReturnValue(BRIEF);
    const { container } = render(
      await StartPage({ searchParams: search({ project: BRIEF.slug }) }),
    );

    const pack = container.querySelector<HTMLInputElement>("input[name=pack]")!;
    expect(pack.value).toBe("sql-data-analysis");
  });

  it("says the button enrols them in the whole course", async () => {
    findProjectMock.mockReturnValue(BRIEF);
    render(await StartPage({ searchParams: search({ project: BRIEF.slug }) }));

    expect(
      screen.getByRole("button", { name: "Start the SQL & Data Analysis course" }),
    ).toBeDefined();
    // And that the one thing it is not about to ask is the subject.
    expect(screen.getByText(/The subject is settled/)).toBeDefined();
  });

  it("carries the course a typed subject resolves to", async () => {
    const { container } = render(
      await StartPage({ searchParams: search({ topic: "Photography" }) }),
    );
    expect(
      container.querySelector<HTMLInputElement>("input[name=pack]")!.value,
    ).toBe("photography");
  });

  it("carries no course for a subject we do not run", async () => {
    // Which is the case this screen exists for: §7.1's Generated tier decides
    // it from the conversation, and there is nothing to lock in advance.
    const { container } = render(
      await StartPage({ searchParams: search({ topic: "basket weaving" }) }),
    );
    expect(container.querySelector("input[name=pack]")).toBeNull();
  });

  it("carries the course through the offer to abandon an old conversation", async () => {
    // The collision card is a second way into the same first turn, and a
    // course dropped here would leave the one route in that still has to
    // recognise the subject back out of prose.
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "Studied any Japanese before?" }],
      captured: captured({ subject: "Japanese" }),
    };

    const { container } = render(
      await StartPage({ searchParams: search({ topic: "Photography" }) }),
    );

    expect(screen.getByText(/Start on “Photography”\?/)).toBeDefined();
    expect(
      container.querySelector<HTMLInputElement>("input[name=pack]")!.value,
    ).toBe("photography");
  });

  it("warns before putting an unfinished conversation aside, and does not destroy it", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "Studied any Japanese before?" }],
      captured: captured({ subject: "Japanese" }),
    };
    findProjectMock.mockReturnValue(BRIEF);

    render(await StartPage({ searchParams: search({ project: BRIEF.slug }) }));

    expect(
      screen.getByText(/still have a conversation going about Japanese/),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Carry on with Japanese/ }).getAttribute("href"),
    ).toBe("/start");
    // Rendering the screen must not clear anything: `Link` prefetches this
    // route, so a GET that threw the intake away would do it on a hover.
    expect(clearIntakeMock).not.toHaveBeenCalled();
  });

  it("says something useful when the held conversation has no subject yet", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "What do you want to learn?" }],
      captured: captured({ subject: null }),
    };
    findProjectMock.mockReturnValue(BRIEF);

    render(await StartPage({ searchParams: search({ project: BRIEF.slug }) }));
    expect(screen.getByText(/conversation going about something else/)).toBeDefined();
    expect(screen.getByRole("link", { name: /Carry on with it/ })).toBeDefined();
  });

  it("says nothing about putting anything aside when there is nothing held", async () => {
    findProjectMock.mockReturnValue(BRIEF);
    render(await StartPage({ searchParams: search({ project: BRIEF.slug }) }));
    expect(screen.queryByText(/still have a conversation going/)).toBeNull();
  });

  it("still reports an analyzer error on the brief's own screen", async () => {
    findProjectMock.mockReturnValue(BRIEF);
    render(
      await StartPage({
        searchParams: search({ project: BRIEF.slug, error: "analyzer" }),
      }),
    );
    expect(screen.getByText(/That didn't go through/)).toBeDefined();
  });

  it("falls back to a general message for an error code it does not know", async () => {
    // `?error=` is in the query string, so it is whatever arrives — including a
    // code from a redirect we later rename. Showing the general message beats
    // rendering a blank banner with no text in it.
    findProjectMock.mockReturnValue(BRIEF);
    render(
      await StartPage({
        searchParams: search({ project: BRIEF.slug, error: "not-a-code" }),
      }),
    );
    expect(screen.getByText(/couldn't work out what you wanted/)).toBeDefined();
  });

  it("ignores a project slug that names nothing, rather than echoing it", async () => {
    // The reason the slug travels instead of the wording: an unresolved slug
    // leaves no trace, where a sentence in the URL was rendered straight back.
    findProjectMock.mockReturnValue(undefined);
    render(
      await StartPage({ searchParams: search({ project: "<not-a-project>" }) }),
    );

    expect(screen.queryByText(/not-a-project/)).toBeNull();
    // Falls through to the ordinary intake.
    expect(screen.getByText(/Let’s work out what you need/)).toBeDefined();
  });

  it("carries the brief through sign-in, not just the typed subject", async () => {
    // They read a whole rubric before pressing the button. Landing on a bare
    // intake after signing in throws all of that away.
    getSessionMock.mockResolvedValue(null);
    findProjectMock.mockReturnValue(BRIEF);

    await expect(
      StartPage({ searchParams: search({ project: BRIEF.slug }) }),
    ).rejects.toThrow(
      `REDIRECT:/sign-in?next=${encodeURIComponent("/start?project=sales-dashboard")}`,
    );
  });

  it("does not interrupt when they came back for the subject they were already on", async () => {
    // The stored subject is the analyzer's wording and the topic is theirs;
    // "JavaScript" and "javascript" are not two different subjects.
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "How much time?" }],
      captured: captured({ subject: "JavaScript" }),
    };
    render(await StartPage({ searchParams: search({ topic: "javascript" }) }));
    expect(screen.queryByText(/Start on/)).toBeNull();
  });

  it("does not carry more than one turn's worth of typed topic", async () => {
    const { container } = render(
      await StartPage({ searchParams: search({ topic: "x".repeat(900) }) }),
    );
    expect(
      container.querySelector<HTMLInputElement>("input[name=reply]")!.value,
    ).toHaveLength(500);
  });

  it("promises to build a subject we do not have", async () => {
    // The claim the landing page makes; it has to be true on this screen too.
    render(await StartPage({ searchParams: search() }));
    expect(screen.getByText(/we&rsquo;ll build it|we’ll build it/)).toBeDefined();
  });

  it("renders the conversation and the questions asked so far", async () => {
    intake = {
      messages: [
        { r: "a", t: "What do you want to learn?" },
        { r: "l", t: "Rust" },
      ],
      captured: captured(),
      chips: ["1-2 hrs"],
      clarity: 0.3,
      done: false,
      packSlug: null,
    };

    const { container } = render(await StartPage({ searchParams: search() }));
    expect(screen.getByText("What do you want to learn?")).toBeDefined();
    expect(screen.getByText("Rust")).toBeDefined();
    expect(screen.getByText(/1 of 6 questions/)).toBeDefined();

    // Only the newest turn carries the anchor those redirects aim at.
    const anchored = container.querySelectorAll("#latest");
    expect(anchored).toHaveLength(1);
    expect(anchored[0]!.textContent).toContain("Rust");
  });

  /*
   * The composer is the one thing needed on every turn, and in normal flow it
   * was the one thing that had scrolled off the bottom — each answer pushed it
   * further down, so answering meant hunting for the box first.
   */
  it("pins the answer box to the bottom of the screen", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "How long?" }],
      chips: ["1-2 hrs"],
    };
    const { container } = render(await StartPage({ searchParams: search() }));

    // `#reply` rather than `[name=reply]`, which the chips' hidden fields also
    // answer to — and they come first in the DOM.
    const bar = container.querySelector("input#reply")!.closest("form")!
      .parentElement!;
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("bottom-0");
    // The chips and the way out ride in the bar too: a sibling below a sticky
    // element gets overlapped by it, which is how "Start over" would have
    // become a half-covered link.
    expect(bar.textContent).toContain("1-2 hrs");
    expect(bar.textContent).toContain("Start over");
  });

  it("retires the hero once there is a conversation above it", async () => {
    // The headline asks a question that, by turn two, has answers sitting
    // above it — so it stops taking the room of a landing page.
    render(await StartPage({ searchParams: search() }));
    expect(screen.getByRole("heading", { level: 1 }).className).toContain(
      "text-display-size",
    );

    cleanup();
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "hi" }] };
    render(await StartPage({ searchParams: search() }));

    const heading = screen.getByRole("heading", { level: 1 });
    // Still an h1 — the screen needs one — at a size that no longer competes.
    expect(heading.textContent).toContain("What do you want to get good at?");
    expect(heading.className).toContain("text-label-size");
    expect(screen.queryByText(/Tell us in your own words/)).toBeNull();
  });

  it("stops offering the form once there are answers to lose", async () => {
    // Two reasons. Offering the form four questions in offers to throw away
    // the four answers — and anything after the composer extends the page past
    // it, so the bar stopped feeling pinned exactly when you scrolled to it.
    render(await StartPage({ searchParams: search() }));
    expect(screen.getByRole("link", { name: /Do that instead/ })).toBeDefined();

    cleanup();
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "hi" }] };
    render(await StartPage({ searchParams: search() }));
    expect(screen.queryByRole("link", { name: /Do that instead/ })).toBeNull();
  });

  it("renders chips as buttons, so one tap needs no JavaScript", async () => {
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "How long?" }], chips: ["1-2 hrs", "3-5 hrs"] };
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "1-2 hrs" })).toBeDefined();
    expect(screen.getByRole("button", { name: "3-5 hrs" })).toBeDefined();
  });

  it("shows what has been captured, and what has not", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "hi" }],
      captured: captured({ weeklyHours: 4, statedLevel: "none" }),
    };
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByText("Rust programming")).toBeDefined();
    expect(screen.getByText("4 hrs/week")).toBeDefined();
    expect(screen.getByText("Never done it")).toBeDefined();
    // Deadline was never given, and the row says so rather than vanishing.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  /*
   * The panel's whole claim is that it is repeating what it heard. It was
   * doing the opposite: answering "Complete beginner" with "Dabbled a bit",
   * turning the chip "1-2 hrs" into "1.5 hrs/week", and printing "before a
   * trip next summer" as the raw ISO string 2027-06-01.
   */
  it("quotes the learner rather than paraphrasing them back", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "l", t: "Complete beginner" }],
      captured: captured({
        statedLevel: "beginner",
        levelSaid: "Complete beginner",
        weeklyHours: 1.5,
        weeklyHoursSaid: "1-2 hrs",
        deadline: "2027-06-01",
        deadlineSaid: "before a trip next summer",
      }),
    };
    render(await StartPage({ searchParams: search() }));

    // Their words, in the panel — not our bucket for them.
    expect(screen.getAllByText("Complete beginner").length).toBe(2);
    expect(screen.getByText("1-2 hrs")).toBeDefined();
    expect(screen.getByText("before a trip next summer")).toBeDefined();

    expect(screen.queryByText("Dabbled a bit")).toBeNull();
    expect(screen.queryByText("1.5 hrs/week")).toBeNull();
    expect(screen.queryByText("2027-06-01")).toBeNull();
  });

  it("writes a date for a person when nobody gave one in words", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "hi" }],
      captured: captured({ deadline: "2027-06-01" }),
    };
    render(await StartPage({ searchParams: search() }));
    expect(screen.getByText("1 June 2027")).toBeDefined();
  });

  it("says when the subject is one we already cover", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "hi" }],
      captured: captured({ matchedPack: "photography" }),
    };
    render(await StartPage({ searchParams: search() }));
    expect(screen.getByText(/cover this one already/)).toBeDefined();
  });

  it("offers to build the plan once the conversation has closed", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "That's everything I need." }],
      captured: captured(),
      done: true,
    };
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Build my plan" })).toBeDefined();
    expect(screen.queryByPlaceholderText("Type your answer…")).toBeNull();
  });

  it("shows an error the action handed back", async () => {
    render(await StartPage({ searchParams: search({ error: "busy" }) }));
    expect(screen.getByText(/already have a course being built/)).toBeDefined();
  });

  it("falls back to a general message for an error it does not know", async () => {
    render(await StartPage({ searchParams: search({ error: "wat" }) }));
    expect(screen.getByText(/couldn't work out what you wanted/)).toBeDefined();
  });

  /**
   * The bug this pair exists for: pressing "Build my plan" on a plan without
   * generated packs bounced to `?error=generated`, which had no entry here and
   * fell through to the `subject` fallback — so the screen said we could not
   * work out what you wanted to learn, about a subject it had just spent five
   * questions establishing. Reported, fairly, as nothing having happened.
   */
  it("says what a refused build actually was", async () => {
    render(await StartPage({ searchParams: search({ error: "generated" }) }));

    // Said as a thing they have already had rather than one they were never
    // offered: free builds one custom subject, and somebody seeing this has
    // spent it. "Not part of your plan" would be false twice over.
    expect(screen.getByText(/already had the one custom subject/)).toBeDefined();
    expect(screen.queryByText(/couldn't work out what you wanted/)).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /which plans build more/ })
        .getAttribute("href"),
    ).toBe("/pricing");
  });

  /** Free, with its one lifetime build already spent — the refusing state. */
  const onFreePlan = () =>
    entitlementsMock.mockResolvedValue({
      ...freshEntitlements(),
      planId: "free",
      entitlements: {
        evaluationsPerMonth: 1,
        sessionsPerMonth: 1,
        aiCurriculum: false,
        lessonsPerCourse: 1,
        packBuildsLifetime: 1,
        premiumModels: false,
      },
      spendCapCents: 120,
    });

  /*
   * Said before the button, not after it.
   *
   * A banner is the right thing once somebody has been stopped. It is the wrong
   * thing to be the first mention of a limit, five answers into a screen headed
   * "Anything — if we don't already cover it, we'll build it".
   */
  it("offers the button to a free learner who still has their build", async () => {
    /*
     * The change this whole tier turns on. Free used to be refused here
     * outright, which made it "the seven subjects we happen to have"; it now
     * gets one custom subject, and the button is how it gets it.
     */
    onFreePlan();
    commissionedMock.mockResolvedValue(0);
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "That's everything I need." }],
      captured: captured(),
      done: true,
    };
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Build my plan" })).toBeDefined();
    expect(screen.queryByText(/We don’t run Rust programming yet/)).toBeNull();
  });

  it("does not offer a button that its own action will refuse", async () => {
    onFreePlan();
    // The quota spent: one custom subject per free account, ever.
    commissionedMock.mockResolvedValue(1);
    // `captured()` names Rust and matches no pack, so this is the gap the
    // Generated tier exists for — the case the plan does not cover.
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "That's everything I need." }],
      captured: captured(),
      done: true,
    };
    render(await StartPage({ searchParams: search() }));

    expect(screen.queryByRole("button", { name: "Build my plan" })).toBeNull();
    expect(screen.getByText(/We don’t run Rust programming yet/)).toBeDefined();
    expect(screen.getByText(/already had the custom subject/)).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: /which plans build more/ })
        .getAttribute("href"),
    ).toBe("/pricing");
    // The answers are not thrown away by a wall, and saying so is the point.
    expect(screen.getByRole("button", { name: "Start over" })).toBeDefined();
  });

  it("still offers the button for a subject we already run", async () => {
    // The same plan. The wall is on authoring a new course, not on having one.
    onFreePlan();
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "That's everything I need." }],
      captured: captured({ matchedPack: "photography" }),
      done: true,
    };
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Build my plan" })).toBeDefined();
    expect(screen.queryByText(/already had the one custom subject/)).toBeNull();
  });

  it("asks nothing of billing while the conversation is still going", async () => {
    // Two queries per render, on a screen that re-renders every turn. The
    // button they pay to press does not exist yet.
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "How much time do you have?" }],
      captured: captured(),
    };
    render(await StartPage({ searchParams: search() }));

    expect(entitlementsMock).not.toHaveBeenCalled();
  });

  it("keeps the form reachable for anyone who would rather have one", async () => {
    render(await StartPage({ searchParams: search() }));
    const link = screen.getByRole("link", { name: /Do that instead/ });
    expect(link.getAttribute("href")).toBe("/start/form");
  });

  it("is never indexed", async () => {
    const { metadata } = await import("@/app/(app)/start/page");
    expect(metadata.robots).toMatchObject({ index: false });
  });
});

describe("the conversation actions", () => {
  it("opens with a question from the analyzer", async () => {
    await expect(openAction()).rejects.toThrow("REDIRECT:/start");
    expect(saveIntakeMock).toHaveBeenCalledOnce();
    expect(saveIntakeMock.mock.calls[0]![2]).toMatchObject({ done: false });
  });

  it("hands back an error rather than a blank screen when the model fails", async () => {
    runAnalyzerMock.mockResolvedValue({ status: "invalid", detail: "nope" });
    await expect(openAction()).rejects.toThrow("REDIRECT:/start?error=analyzer");
  });

  it("lands the learner on the new question, not the top of the page", async () => {
    // The composer is pinned to the bottom of the screen, so it covers the
    // tail of the conversation — without the anchor the page opens showing
    // chips that answer a question you cannot read.
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "What do you want?" }] };
    await expect(replyAction(form({ reply: "Rust" }))).rejects.toThrow(
      "REDIRECT:/start#latest",
    );

    intake = { ...EMPTY_INTAKE };
    await expect(openAction()).rejects.toThrow("REDIRECT:/start#latest");
  });

  it("records what the learner said and what came back", async () => {
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "What do you want?" }] };
    await expect(replyAction(form({ reply: "Rust" }))).rejects.toThrow(
      "REDIRECT:/start",
    );

    const saved = saveIntakeMock.mock.calls[0]![2];
    expect(saved.messages.map((m) => m.t)).toEqual([
      "What do you want?",
      "Rust",
      "How much time do you have?",
    ]);
  });

  it("keeps what they typed when the model fails mid-conversation", async () => {
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "What do you want?" }] };
    runAnalyzerMock.mockResolvedValue({ status: "refused", detail: "no" });

    await expect(replyAction(form({ reply: "Rust" }))).rejects.toThrow(
      "REDIRECT:/start?error=analyzer",
    );
    const saved = saveIntakeMock.mock.calls[0]![2];
    expect(saved.messages.at(-1)!.t).toBe("Rust");
  });

  /**
   * A failed opening turn has to land back on the brief, not on a bare intake.
   *
   * The redirect above drops everything the reader arrived with, which is a
   * shrug in the middle of a conversation and a real loss on the first turn:
   * they read a whole rubric and pressed a button, and a bad minute from the
   * model would have left them on an empty "what do you want to get good at?"
   * with no sign of the work they came for.
   */
  it("returns a failed opening turn to the brief it came from", async () => {
    runAnalyzerMock.mockResolvedValue({ status: "refused", detail: "no" });

    await expect(
      replyAction(
        form({
          reply: 'I want to learn SQL so I can do the "Sales dashboard" project.',
          project: "sales-dashboard",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/start?project=sales-dashboard&error=analyzer");
  });

  it("keeps the brief out of it once the conversation is under way", async () => {
    // Later turns come from the composer, which carries no slug: by then the
    // project is in the conversation itself and the generic screen is right.
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "What do you want?" }] };
    runAnalyzerMock.mockResolvedValue({ status: "refused", detail: "no" });

    await expect(replyAction(form({ reply: "Rust" }))).rejects.toThrow(
      "REDIRECT:/start?error=analyzer",
    );
  });

  it("ignores an empty answer", async () => {
    await expect(replyAction(form({ reply: "   " }))).rejects.toThrow(
      "REDIRECT:/start",
    );
    expect(runAnalyzerMock).not.toHaveBeenCalled();
  });

  /* ── The course they arrived having chosen ─────────────────────────────── */

  it("tells the analyzer the subject is settled, from the first turn", async () => {
    // Otherwise the opening question is "what do you want to get good at?"
    // asked of someone who answered it by pressing a button.
    await expect(
      replyAction(form({ reply: "I want to learn Photography", pack: "photography" })),
    ).rejects.toThrow("REDIRECT:/start#latest");

    expect(runAnalyzerMock.mock.calls[0]![1]).toMatchObject({
      committed: { slug: "photography", name: "Photography" },
    });
    expect(saveIntakeMock.mock.calls[0]![2].packSlug).toBe("photography");
  });

  it("keeps the course through the turns that do not name it", async () => {
    // Every later turn comes from the composer, which has no course to send.
    // Reading the field on those would let an empty one unlock the subject
    // halfway through the conversation.
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "What are you shooting?" }],
      packSlug: "photography",
    };

    await expect(replyAction(form({ reply: "Weddings" }))).rejects.toThrow(
      "REDIRECT:/start#latest",
    );
    expect(saveIntakeMock.mock.calls[0]![2].packSlug).toBe("photography");
  });

  it("saves the course even when that first turn fails", async () => {
    // They still chose it. Losing the lock to a bad minute from the model
    // would put them back on a conversation about nothing in particular.
    runAnalyzerMock.mockResolvedValue({ status: "refused", detail: "no" });

    await expect(
      replyAction(form({ reply: "Photography", pack: "photography" })),
    ).rejects.toThrow("REDIRECT:/start?error=analyzer");
    expect(saveIntakeMock.mock.calls[0]![2].packSlug).toBe("photography");
  });

  /*
   * The field is a claim, not a fact: it arrives in a form body, so a signed-in
   * learner can put anything in it. Unchecked it would ride all the way to
   * `createGoal`'s `packId`, which is a foreign key.
   */
  it("drops a course that is not real rather than binding a goal to it", async () => {
    await expect(
      replyAction(form({ reply: "Rust", pack: "../../etc/passwd" })),
    ).rejects.toThrow("REDIRECT:/start#latest");

    expect(runAnalyzerMock.mock.calls[0]![1]).toMatchObject({ committed: null });
    expect(saveIntakeMock.mock.calls[0]![2].packSlug).toBeNull();
  });

  it("leaves the subject open when no course was named", async () => {
    await expect(replyAction(form({ reply: "basket weaving" }))).rejects.toThrow(
      "REDIRECT:/start#latest",
    );
    expect(saveIntakeMock.mock.calls[0]![2].packSlug).toBeNull();
  });

  it("refuses to continue a conversation that has already closed", async () => {
    intake = { ...EMPTY_INTAKE, done: true };
    await expect(replyAction(form({ reply: "more" }))).rejects.toThrow(
      "REDIRECT:/start",
    );
    expect(runAnalyzerMock).not.toHaveBeenCalled();
  });

  it("ends the conversation at the cap however the model answers", async () => {
    /*
     * §24 E3 — "≤6 turns, always", and the cap lives here rather than in the
     * prompt. The model is still saying done:false on its sixth question.
     */
    intake = {
      ...EMPTY_INTAKE,
      messages: Array.from({ length: 6 }, () => [
        { r: "a" as const, t: "another question" },
        { r: "l" as const, t: "an answer" },
      ]).flat(),
    };
    runAnalyzerMock.mockResolvedValue(turn({ done: false, clarity: 0.1 }));

    await expect(replyAction(form({ reply: "again" }))).rejects.toThrow(
      "REDIRECT:/start",
    );
    expect(saveIntakeMock.mock.calls[0]![2].done).toBe(true);
  });

  it("tells the model to close once it has enough", async () => {
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "q" }], clarity: 0.9 };
    await expect(replyAction(form({ reply: "yes" }))).rejects.toThrow(
      "REDIRECT:/start",
    );
    expect(runAnalyzerMock.mock.calls[0]![1]).toMatchObject({ finalTurn: true });
  });

  it("throws the conversation away on request", async () => {
    await expect(restartAction()).rejects.toThrow("REDIRECT:/start");
    expect(clearIntakeMock).toHaveBeenCalledOnce();
  });

  it("clears the old conversation before opening one on the new subject", async () => {
    // Order is the whole point: seeding without clearing first appends
    // "javascript" to the Japanese conversation, which is a worse answer than
    // the bug it is fixing.
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "Studied any Japanese?" }],
      captured: captured({ subject: "Japanese" }),
    };
    clearIntakeMock.mockImplementation(async () => {
      intake = { ...EMPTY_INTAKE };
    });

    await expect(
      startFreshAction(form({ reply: "javascript" })),
    ).rejects.toThrow("REDIRECT:/start#latest");

    expect(clearIntakeMock).toHaveBeenCalledOnce();
    // One learner message, and it is theirs — nothing carried over.
    expect(runAnalyzerMock.mock.calls[0]![1]).toMatchObject({
      messages: [{ r: "l", t: "javascript" }],
    });
  });
});

describe("turning the conversation into a goal", () => {
  it("goes straight to a plan for a subject we already cover", async () => {
    intake = {
      ...EMPTY_INTAKE,
      captured: captured({ matchedPack: "photography" }),
      done: true,
    };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/today",
    );
    expect(createGoalMock).toHaveBeenCalledOnce();
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("starts a build for a subject nobody has curated", async () => {
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust-programming",
    );
    expect(startBuildMock).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it("releases the claim when the queue cannot be reached", async () => {
    /*
     * The bug this exists for, reported from a dev machine with no Inngest
     * server running: `startBuild` writes the row *before* the dispatch, so a
     * `fetch failed` left a slug claimed that nobody would ever pick up — the
     * wait screen polling "writing it now" for fifteen minutes at a subject
     * that was not being built.
     *
     * On a plan with a lifetime quota it is worse than a wedged screen. The
     * quota counts build rows, so ten seconds of an unreachable queue would
     * have spent a free account's one custom subject on a build that never
     * ran, and lifetime means never getting it back.
     */
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };
    sendMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust-programming",
    );

    // Marked failed rather than left claimed: that is the state the wait screen
    // renders with a "Try again" button, and the retry reuses this same slug —
    // so the row, and therefore the quota, is untouched.
    expect(finishBuildMock).toHaveBeenCalledWith(
      expect.anything(),
      "rust-programming",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("says what happened rather than throwing a 500 at the learner", async () => {
    // A server action that throws renders the error overlay in development and
    // an unexplained failure in production. The learner gets a sentence.
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };
    sendMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(buildFromConversationAction()).rejects.toThrow("REDIRECT:");

    const detail = finishBuildMock.mock.calls[0]![2] as { detail: string };
    expect(detail.detail).toMatch(/try again/i);
  });

  it("joins a build already running rather than sending a second event", async () => {
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };
    startBuildMock.mockResolvedValue({
      kind: "already",
      build: { slug: "rust-programming" },
    });

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust-programming",
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("says so rather than queueing when the learner is already building one", async () => {
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };
    startBuildMock.mockResolvedValue({ kind: "rate-limited" });

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start?error=busy",
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("goes back to the start when nothing was captured", async () => {
    intake = { ...EMPTY_INTAKE, done: true };
    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start",
    );
  });

  it("gives up honestly when the analyzer named no subject at all", async () => {
    intake = {
      ...EMPTY_INTAKE,
      captured: captured({ subject: null, matchedPack: null }),
      done: true,
    };
    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start?error=subject",
    );
  });

  /*
   * The course the learner chose beats the one the model worked out.
   *
   * `captured()` here is a conversation the analyzer read as a subject we do
   * not run — which is the honest reading of "I want to learn Photography so I
   * can do the … project" going wrong, and before the pack travelled it was the
   * reading that won. Someone who clicked a published brief could be sent off
   * to *generate* a pack while the real one sat next to it.
   */
  it("builds the course they chose, not the one the model guessed", async () => {
    intake = {
      ...EMPTY_INTAKE,
      captured: captured({ subject: "Rust programming", matchedPack: null }),
      packSlug: "photography",
      done: true,
    };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/today",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
    expect(createGoalMock.mock.calls[0]![1]).toMatchObject({
      packSlug: "photography",
    });
  });

  it("falls back to the conversation when the chosen course is gone", async () => {
    // Withdrawn between the click and the build. Better a plan for what they
    // talked about than a goal pointing at a pack that is not there.
    intake = {
      ...EMPTY_INTAKE,
      captured: captured(),
      packSlug: "withdrawn-pack",
      done: true,
    };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust-programming",
    );
  });
});

describe("the wait screen", () => {
  it("sends a signed-out visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(
      BuildingPage({ searchParams: Promise.resolve({ subject: "rust" }) }),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("goes back to the start when no subject was named", async () => {
    await expect(
      BuildingPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/start");
  });

  it("says it is building, and how long that takes", async () => {
    findBuildMock.mockResolvedValue({
      slug: "rust-programming",
      subject: "Rust",
      status: "building",
      detail: null,
      startedAt: new Date(),
    });
    intake = { ...EMPTY_INTAKE, captured: captured() };

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );
    expect(screen.getByText(/about three minutes/)).toBeDefined();
    // It refreshes itself rather than polling with a script.
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeTruthy();
  });

  it("says what actually went wrong when a build failed", async () => {
    // §4.2 law 3 — the reason, not "something went wrong, try again".
    findBuildMock.mockResolvedValue({
      slug: "rust-programming",
      subject: "Rust",
      status: "failed",
      detail: "7 items; a diagnostic needs at least 24",
      startedAt: new Date(),
    });

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );
    expect(
      screen.getByText("7 items; a diagnostic needs at least 24"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("falls back to a plain sentence when a failure carried no detail", async () => {
    findBuildMock.mockResolvedValue({
      slug: "rust-programming",
      subject: "Rust",
      status: "failed",
      detail: null,
      startedAt: new Date(),
    });

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );
    expect(screen.getByText(/Something went wrong while building/)).toBeDefined();
  });
});

describe("adopting a pack that finished building", () => {
  it("badges it Experimental rather than passing it off as reviewed", async () => {
    // §7.1 — depth is declared, never faked.
    packMock.mockResolvedValue({
      slug: "photography",
      name: "Photography",
      skills: [{ slug: "a" }, { slug: "b" }],
    });

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "photography" }),
      }),
    );
    expect(screen.getByText(/Experimental/)).toBeDefined();
    expect(screen.getByRole("button", { name: "See my plan" })).toBeDefined();
  });

  it("creates the goal from the same conversation a covered subject would use", async () => {
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    await expect(
      adoptBuiltPackAction(form({ slug: "photography" })),
    ).rejects.toThrow("REDIRECT:/today");
    expect(createGoalMock).toHaveBeenCalledOnce();
  });

  it("refuses a slug that is not a real pack", async () => {
    await expect(adoptBuiltPackAction(form({ slug: "nope" }))).rejects.toThrow(
      "REDIRECT:/start?error=subject",
    );
  });

  it("goes back to the start when the conversation is gone", async () => {
    intake = { ...EMPTY_INTAKE };
    await expect(
      adoptBuiltPackAction(form({ slug: "photography" })),
    ).rejects.toThrow("REDIRECT:/start");
  });
});

describe("retrying a failed build", () => {
  it("starts it again and sends the event", async () => {
    await expect(
      requestBuildAction(form({ slug: "rust-programming", subject: "Rust" })),
    ).rejects.toThrow("REDIRECT:/start/building?subject=rust-programming");
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it("abandons it when the learner picks something else", async () => {
    await expect(requestBuildAction(form({ cancel: "1" }))).rejects.toThrow(
      "REDIRECT:/start",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("goes back rather than building nothing", async () => {
    await expect(requestBuildAction(form({ slug: "", subject: "" }))).rejects.toThrow(
      "REDIRECT:/start",
    );
  });

  it("respects the one-build-at-a-time limit on a retry too", async () => {
    startBuildMock.mockResolvedValue({ kind: "rate-limited" });
    await expect(
      requestBuildAction(form({ slug: "rust", subject: "Rust" })),
    ).rejects.toThrow("REDIRECT:/start?error=busy");
  });

  it("does not re-send the event when a build is already running", async () => {
    startBuildMock.mockResolvedValue({ kind: "already", build: { slug: "rust" } });
    await expect(
      requestBuildAction(form({ slug: "rust", subject: "Rust" })),
    ).rejects.toThrow("REDIRECT:/start/building?subject=rust");
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("the last few edges", () => {
  it("names the subject generically when the conversation did not", async () => {
    findBuildMock.mockResolvedValue({
      slug: "rust",
      subject: "Rust",
      status: "building",
      detail: null,
      startedAt: new Date(),
    });
    intake = { ...EMPTY_INTAKE };

    render(
      await BuildingPage({ searchParams: Promise.resolve({ subject: "rust" }) }),
    );
    expect(screen.getByText(/this subject/)).toBeDefined();
  });

  it("treats a missing slug field as no slug", async () => {
    await expect(adoptBuiltPackAction(new FormData())).rejects.toThrow(
      "REDIRECT:/start?error=subject",
    );
  });

  it("refuses to retry a build with a slug but no subject", async () => {
    await expect(requestBuildAction(form({ slug: "rust" }))).rejects.toThrow(
      "REDIRECT:/start",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("gives up when a finished pack cannot make a valid spec", async () => {
    // A conversation that captured a subject but nothing a GoalSpec accepts.
    intake = {
      ...EMPTY_INTAKE,
      captured: captured({ weeklyHours: 9_999 }),
      done: true,
    };
    await expect(
      adoptBuiltPackAction(form({ slug: "photography" })),
    ).rejects.toThrow("REDIRECT:/start?error=subject");
  });
});

describe("forms with fields missing entirely", () => {
  it("ignores a reply form with no reply field on it", async () => {
    await expect(replyAction(new FormData())).rejects.toThrow("REDIRECT:/start");
    expect(runAnalyzerMock).not.toHaveBeenCalled();
  });

  it("ignores a retry form with nothing on it", async () => {
    await expect(requestBuildAction(new FormData())).rejects.toThrow(
      "REDIRECT:/start",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("gives up when a covered subject cannot make a valid spec", async () => {
    intake = {
      ...EMPTY_INTAKE,
      captured: captured({ matchedPack: "photography", weeklyHours: 9_999 }),
      done: true,
    };
    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start?error=subject",
    );
  });
});

describe("a free account may commission one pack, ever", () => {
  /** Free with its one build already spent — the only state that refuses. */
  const onFree = () => {
    commissionedMock.mockResolvedValue(1);
    entitlementsMock.mockResolvedValue({
      ...freshEntitlements(),
      planId: "free",
      entitlements: {
        evaluationsPerMonth: 1,
        sessionsPerMonth: 1,
        aiCurriculum: false,
        lessonsPerCourse: 1,
        packBuildsLifetime: 1,
        premiumModels: false,
      },
      spendCapCents: 120,
    });
  };

  it("refuses a free learner before the slug is claimed", async () => {
    // Checked before `startBuild`, which claims the slug: a claim we then
    // refuse to honour would lock the subject behind a build that never runs.
    onFree();
    // The same state the "starts a build for a subject nobody has curated"
    // test sets up — a captured intake with no matched pack.
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start?error=generated",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("lets a free learner spend the build they still have", async () => {
    /*
     * The whole point of the quota being a number rather than a flag: free is
     * not refused, it is metered. This is the path a free account takes exactly
     * once, and the build it starts is the one the catalogue pays for.
     */
    onFree();
    commissionedMock.mockResolvedValue(0);
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust-programming",
    );
    expect(startBuildMock).toHaveBeenCalled();
  });

  it("refuses a retry too", async () => {
    onFree();
    const form = new FormData();
    form.set("slug", "rust");
    form.set("subject", "Rust");

    await expect(requestBuildAction(form)).rejects.toThrow(
      "REDIRECT:/start?error=generated",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
  });
});
