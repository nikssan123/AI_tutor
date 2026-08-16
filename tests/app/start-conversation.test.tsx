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
    restartIntake: true,
    premiumModels: true,
  },
  spendCapCents: 1_500,
  source: "plan",
});
/**
 * Free, whose two limits both land on this screen.
 *
 * One custom subject, ever — which closes the conversation once it is spent —
 * and one conversation, which is editable to the last moment and never thrown
 * away to be re-asked. Written once because three tests below set the same
 * plan for different reasons, and a fourth entitlement added to the catalog
 * should not have to be remembered in three places.
 */
const freeEntitlements = () => ({
  ...freshEntitlements(),
  planId: "free",
  entitlements: {
    evaluationsPerMonth: 1,
    sessionsPerMonth: 1,
    aiCurriculum: false,
    lessonsPerCourse: 1 as number | null,
    packBuildsLifetime: 1 as number | null,
    restartIntake: false,
    premiumModels: false,
  },
  spendCapCents: 120,
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
const goalsForMock = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock("@/lib/goals/store", () => ({
  createGoal: (...a: unknown[]) => createGoalMock(...(a as [])),
  // Read by the adopt action to stay idempotent, and by the closed-intake
  // screen to point at the course it is telling them they already have.
  goalsFor: (...a: unknown[]) => goalsForMock(...(a as [])),
}));
/**
 * How many packs this account has ever commissioned — the free tier's lifetime
 * quota. Mocked rather than seeded because every assertion below is about what
 * the screen does with the number, not about how it is counted.
 */
const commissionedMock = vi.fn(async () => 0);
/**
 * Whether this account already commissioned *this* subject — the other half of
 * the quota, and the half that decides whether a failed build can be retried.
 */
const ownsBuildMock = vi.fn(async () => false);
const finishBuildMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/packs/build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/build")>()),
  startBuild: (...a: unknown[]) => startBuildMock(...(a as [])),
  findBuild: (...a: unknown[]) => findBuildMock(...(a as [])),
  finishBuild: (...a: unknown[]) => finishBuildMock(...(a as [])),
  buildsCommissionedBy: () => commissionedMock(),
  hasCommissioned: () => ownsBuildMock(),
}));
/**
 * Telling the team a build stopped, from the one path that never reaches the
 * worker — see "tells the team" below. Mocked rather than exercised because
 * `tests/packs/notify.test.ts` already owns what the mail says; what matters
 * here is only that the dispatch failure calls it at all.
 */
const notifyFailedMock = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/packs/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/notify")>()),
  notifyBuildFailed: (...a: unknown[]) => notifyFailedMock(...(a as [])),
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
  reopenAction,
  replyAction,
  restartAction,
  startFreshAction,
  adoptBuiltPackAction,
  abandonBuildAction,
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
  // Nobody owns anything until a test says so, for the same reason.
  commissionedMock.mockResolvedValue(0);
  // Same again: a learner who has already adopted a course leaks into every
  // later case as an unexpected redirect if this is not put back.
  goalsForMock.mockResolvedValue([]);
  ownsBuildMock.mockResolvedValue(false);
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

  /** A finished conversation, which is the state the whole end of the screen
      turns on. */
  const closed = () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "That's everything I need." }],
      captured: captured(),
      done: true,
    };
  };

  it("offers to build the plan once the conversation has closed", async () => {
    closed();
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Build my plan" })).toBeDefined();
    expect(screen.queryByPlaceholderText("Type your answer…")).toBeNull();
  });

  /**
   * The button used to be the whole of the offer: a bare "Build my plan" in a
   * plain card, the same weight and the same white as the six bubbles above it,
   * at the bottom of the scroll. It is now the shape the product uses for
   * something waiting on the learner — the same one `/today` uses to say a plan
   * was left ready, so the offer looks the same on both ends of that link.
   */
  it("says the plan is ready rather than just showing a button", async () => {
    closed();
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByText("Your plan is ready to build")).toBeDefined();
    expect(screen.getByText("Waiting on you")).toBeDefined();
    // Their subject, in the analyzer's wording, so the offer is about the thing
    // they spent five questions describing.
    expect(
      screen.getByText(/Nothing more to answer about Rust programming/),
    ).toBeDefined();
  });

  /**
   * Where every "Build it" on the product points, and it has to be the button
   * itself: a fragment focuses its target only when the target can hold focus,
   * so an id on the card around it would scroll there and leave the keyboard
   * where it was — and cancel the `autofocus` below into the bargain.
   */
  it("puts the anchor on the button, and the focus with it", async () => {
    closed();
    render(await StartPage({ searchParams: search() }));

    const build = screen.getByRole("button", { name: "Build my plan" });
    expect(build.id).toBe("ready");
    // The arrival no fragment can reach: a client-side navigation never
    // re-parses the document, so React's mount is the only thing left to move
    // focus. jsdom runs the same `autoFocus` commit the browser does.
    expect(document.activeElement).toBe(build);

    // Announced with the sentence that explains it, rather than as two words on
    // their own — being focused on arrival is exactly what makes that the whole
    // announcement.
    expect(build.getAttribute("aria-describedby")).toBe("ready-lead");
    expect(
      document.getElementById("ready-lead")!.textContent,
    ).toContain("Nothing more to answer");
  });

  it("does not name a subject the analyzer never settled on", async () => {
    closed();
    intake = { ...intake, captured: undefined };
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByText(/^Nothing more to answer\./)).toBeDefined();
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
    entitlementsMock.mockResolvedValue(freeEntitlements());

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

  it("closes the conversation once the custom subject is spent", async () => {
    /*
     * Not a disabled button five questions in — no conversation at all. Every
     * turn is a model call and the button at the end commissions a ~£1 build
     * the catalogue pays for, so a free account that has had its one subject
     * meets the answer at the door.
     */
    onFreePlan();
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

    // No conversation at all — not the transcript with the button removed.
    expect(screen.queryByRole("button", { name: "Build my plan" })).toBeNull();
    expect(screen.queryByText(/We don’t run Rust programming yet/)).toBeNull();
    expect(
      screen.getByText(/had the custom subject your plan builds/),
    ).toBeDefined();

    // And neither way onward is a dead end: the catalogue is still open with
    // no model call and nothing to meter, and the plans page says what keeping
    // the conversation costs.
    expect(
      screen.getByRole("link", { name: "Pick a subject" }).getAttribute("href"),
    ).toBe("/start/form");
    expect(
      screen.getByRole("link", { name: /See the plans/ }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("points at the course it just told them they already have", async () => {
    /*
     * The screen named the course — "we built you a course for a subject
     * nobody had curated" — and then offered the catalogue and a price list,
     * with no way into the thing it had just described. That reads as a wall to
     * somebody who is standing here *because* they succeeded, and it is where
     * a second press of "See my plan" used to land them.
     */
    onFreePlan();
    commissionedMock.mockResolvedValue(1);
    goalsForMock.mockResolvedValue([
      { id: "g-9", packSlug: "photography", spec: {}, status: "active" },
    ]);
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    render(await StartPage({ searchParams: search() }));

    const open = screen.getByRole("link", { name: "Open my course" });
    expect(open.getAttribute("href")).toBe("/goals/g-9/path");
    // Named by the pack rather than by its slug: the course is called
    // "Photography", not "photography".
    expect(screen.getByText("Photography")).toBeDefined();
  });

  it("says nothing about a course when there is no goal to point at", async () => {
    // A learner can reach this wall with the build still running, or with the
    // pack discarded by an operator. An "Open my course" link to nothing would
    // be worse than the wall it was meant to soften.
    onFreePlan();
    commissionedMock.mockResolvedValue(1);
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    render(await StartPage({ searchParams: search() }));
    expect(screen.queryByRole("link", { name: "Open my course" })).toBeNull();
  });

  it("does not offer to retry the build at any price", async () => {
    // A stopped build is not theirs to retry however much they pay — it is the
    // team's. Selling a fix that money does not buy is what §4.2 law 3 is for.
    onFreePlan();
    commissionedMock.mockResolvedValue(1);
    render(await StartPage({ searchParams: search() }));

    expect(document.body.textContent).not.toMatch(/try again/i);
    expect(document.body.textContent).not.toMatch(/retry/i);
  });

  it("leaves a paid learner's conversation alone", async () => {
    // `packBuildsLifetime` is null on every paid plan, so there is no door to
    // close: the allowance is the monthly cap that bounds everything else.
    commissionedMock.mockResolvedValue(9);
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "That's everything I need." }],
      captured: captured(),
      done: true,
    };
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Build my plan" })).toBeDefined();
  });

  it("closes even for the subject they already commissioned", async () => {
    /*
     * A deliberate reversal, and worth reading beside the case it replaced.
     *
     * `mayBuild` was taught to let a learner re-commission the subject they
     * already owned, because a failed build leaves a row and the count that
     * meters the quota counts rows — so free spent its one subject, got
     * nothing, and was told it had already had one. The fix was to let the
     * retry through, since `startBuild` upserts and the count does not move.
     *
     * The retry does not live here any more. A stopped build is the team's to
     * restart from `/admin/packs`, and handing the learner a fresh conversation
     * would let a subject that cannot be built be re-commissioned at our
     * expense as often as somebody felt like answering five questions.
     */
    onFreePlan();
    commissionedMock.mockResolvedValue(1);
    ownsBuildMock.mockResolvedValue(true);
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "That's everything I need." }],
      captured: captured(),
      done: true,
    };
    render(await StartPage({ searchParams: search() }));

    expect(screen.queryByRole("button", { name: "Build my plan" })).toBeNull();
    expect(
      screen.getByText(/had the custom subject your plan builds/),
    ).toBeDefined();
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

  it("asks billing once, at the door, and not again per turn", async () => {
    /*
     * It used to ask nothing until the button existed, on the grounds that a
     * screen re-rendering every turn should not query what the learner cannot
     * press yet. That is still true of the *build* lookup — but the door check
     * has to happen first now, because a free account whose subject is spent
     * gets no conversation at all rather than five questions and a wall.
     *
     * One lookup, before anything else, and the mid-conversation render adds
     * nothing on top of it.
     */
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "How much time do you have?" }],
      captured: captured(),
    };
    render(await StartPage({ searchParams: search() }));

    expect(entitlementsMock).toHaveBeenCalledTimes(1);
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

  /**
   * The one turn that has no new question to land on.
   *
   * `#latest` would put them on the analyzer's closing sentence with the button
   * that acts on it somewhere below — on a conversation six exchanges long,
   * below the fold. The turn that ends the conversation ends on the offer.
   */
  it("lands the closing turn on the button rather than on the last sentence", async () => {
    intake = { ...EMPTY_INTAKE, messages: [{ r: "a", t: "Anything else?" }] };
    runAnalyzerMock.mockResolvedValue(turn({ done: true, clarity: 0.9 }));

    await expect(replyAction(form({ reply: "no" }))).rejects.toThrow(
      "REDIRECT:/start#ready",
    );
    expect(saveIntakeMock.mock.calls[0]![2].done).toBe(true);
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
      "REDIRECT:/goals/goal-1/path",
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
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust-programming",
    );

    // Logged as well as recorded: the learner's sentence is true and useless
    // for debugging, and whoever is running the server needs the cause.
    expect(logged).toHaveBeenCalledWith(
      "[packs] could not queue a build for",
      "rust-programming",
      expect.any(TypeError),
    );
    logged.mockRestore();

    // Marked failed rather than left claimed: `startBuild` lets a failed row be
    // retried on the same slug, so the row — and therefore the quota — survives
    // for the operator who picks it up.
    expect(finishBuildMock).toHaveBeenCalledWith(
      expect.anything(),
      "rust-programming",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("tells the team, because this is the failure the worker never sees", async () => {
    /*
     * The bug behind this one. `notifyBuildFailed` was reachable only from the
     * worker, and a dispatch failure by definition never reaches the worker —
     * so the single failure that means the queue itself is down was the single
     * failure nobody was told about. The learner was meanwhile shown "our team
     * has been told", which was false exactly when it mattered most.
     */
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };
    sendMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(buildFromConversationAction()).rejects.toThrow("REDIRECT:");
    logged.mockRestore();

    expect(notifyFailedMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        slug: "rust-programming",
        // The learner who is waiting, so the mail says who to unblock.
        userId: "u1",
      }),
    );

    // After the row is written, never before: the mail must not describe a
    // state the database does not have yet.
    expect(finishBuildMock.mock.invocationCallOrder[0]!).toBeLessThan(
      notifyFailedMock.mock.invocationCallOrder[0]!,
    );
  });

  it("says what happened rather than throwing a 500 at the learner", async () => {
    // A server action that throws renders the error overlay in development and
    // an unexplained failure in production. The learner gets a sentence.
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };
    sendMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(buildFromConversationAction()).rejects.toThrow("REDIRECT:");
    logged.mockRestore();

    const detail = finishBuildMock.mock.calls[0]![2] as { detail: string };
    expect(detail.detail).toMatch(/could not|couldn't/i);
    expect(detail.detail).toMatch(/queue/i);
    /*
     * And explicitly not "try again". There is no retry button on the wait
     * screen — it was removed on purpose — so a reason ending in "try again"
     * sent the learner hunting for a control that does not exist. The same
     * string is what an operator reads as `Reason:` in the mail.
     */
    expect(detail.detail).not.toMatch(/try again/i);

    // The learner and the team are given the same sentence, so a support reply
    // cannot contradict the screen the learner is looking at.
    const mailed = notifyFailedMock.mock.calls[0]![1] as { detail: string };
    expect(mailed.detail).toBe(detail.detail);
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
      "REDIRECT:/goals/goal-1/path",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
    expect(createGoalMock.mock.calls[0]![1]).toMatchObject({
      packSlug: "photography",
    });
  });

  /**
   * Every new goal asks the queue to cut it into modules.
   *
   * `EVENTS.buildPath` had no sender for the whole life of the product, so a
   * curriculum only ever existed if its owner found the button on the path
   * screen — and a goal without one has no checkpoints, which is why
   * `/calendar` opened empty on a course that had only just been built.
   */
  it("asks the queue for a path for the goal it just created", async () => {
    intake = {
      ...EMPTY_INTAKE,
      captured: captured({ matchedPack: "photography" }),
      done: true,
    };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/goals/goal-1/path",
    );

    expect(sendMock).toHaveBeenCalledWith({
      name: "goal/path.requested",
      data: { userId: "u1", goalId: "goal-1" },
    });
  });

  /**
   * And a queue that cannot be reached does not cost them the goal.
   *
   * Unlike a pack build there is no quota to protect and no row to mark: the
   * goal is written, the path screen still lays the whole subject out from the
   * pack's areas, and "Build my path" is the recovery. Failing the action here
   * would throw away a finished conversation over a dev server nobody started.
   */
  it("still lands the learner on their path when the queue is unreachable", async () => {
    intake = {
      ...EMPTY_INTAKE,
      captured: captured({ matchedPack: "photography" }),
      done: true,
    };
    sendMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/goals/goal-1/path",
    );

    // Swallowed for the learner, reported to whoever is running the server —
    // the same split `dispatchBuild` draws, and the half that was missing when
    // an unreachable queue first showed up as a bare `fetch failed`.
    expect(logged).toHaveBeenCalledWith(
      "[goals] could not queue a path build for",
      "goal-1",
      expect.any(TypeError),
    );
    logged.mockRestore();
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

  /** A build row as the wait screen finds it, with the phase it has reached. */
  const inFlight = (over: Record<string, unknown> = {}) => ({
    slug: "rust-programming",
    subject: "Rust",
    status: "building",
    stage: null,
    detail: null,
    startedAt: new Date(),
    ...over,
  });

  it("says it is building, and how long that takes", async () => {
    findBuildMock.mockResolvedValue(inFlight({ stage: "graph" }));

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );
    /*
     * A range, and the range is the assertion. It used to say "about 3
     * minutes" — the best case quoted as the only one, when a measured first
     * attempt alone ran 7m18s and a build that misses the quality floor gets a
     * second. The old copy left an ordinary two-attempt build looking overdue
     * against a figure this screen had invented for it.
     */
    expect(screen.getByText(/Usually 3–8 minutes/)).toBeDefined();
    // It refreshes itself rather than polling with a script.
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeTruthy();
  });

  it("marks off the phases the build has actually finished", async () => {
    /*
     * The screen used to say one thing for three minutes — that it was still
     * going — which is what a hung page says too, and it was reported as one.
     * Every claim here comes off the build row: a step is done because the
     * build said so, never because enough time has passed.
     */
    findBuildMock.mockResolvedValue(inFlight({ stage: "checking" }));

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );

    expect(screen.getByText("Step 3 of 4")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();
    // §8.5.5 bans colour as the sole carrier of meaning, so each marker says
    // what it means as well as showing it.
    expect(screen.getAllByText("Done:", { exact: false })).toHaveLength(2);
    expect(screen.getByText("Happening now:", { exact: false })).toBeDefined();
    expect(screen.getByText("Still to come:", { exact: false })).toBeDefined();
  });

  it("says it is queued rather than pretending it has started", async () => {
    // The row is written before the worker picks it up. Lighting the first step
    // there would be a small lie that makes the rest of the screen worthless.
    findBuildMock.mockResolvedValue(inFlight());

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );

    expect(screen.getByText("Queued")).toBeDefined();
    expect(screen.getByText("Starting in a moment")).toBeDefined();
    expect(screen.queryByText("Happening now:", { exact: false })).toBeNull();
  });

  it("explains the overrun once it is past the figure it quoted", async () => {
    findBuildMock.mockResolvedValue(
      inFlight({
        stage: "writing",
        startedAt: new Date(Date.now() - 10 * 60_000),
      }),
    );

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );

    expect(screen.getByText(/Started 10 minutes ago/)).toBeDefined();
    expect(screen.getByText(/Past the usual 8 minutes/)).toBeDefined();
  });

  it("stays quiet through a build that is merely on its second attempt", async () => {
    /*
     * The other half of the overrun message, and the reason the threshold
     * moved with the quoted figure. At six minutes a build is very likely on a
     * second attempt and behaving exactly as designed — the old cut-off fired
     * there, so the reassurance was shown to people who had nothing to be
     * reassured about, which is how a signal stops meaning anything.
     */
    findBuildMock.mockResolvedValue(
      inFlight({
        stage: "writing",
        startedAt: new Date(Date.now() - 6 * 60_000),
      }),
    );

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );

    expect(screen.getByText(/Started 6 minutes ago/)).toBeDefined();
    expect(screen.queryByText(/Past the usual/)).toBeNull();
  });

  it("says a build has stopped rather than waiting on it forever", async () => {
    /*
     * `startBuild` already treats a row this old as dead. Until this screen
     * agreed, the learner was told their course was being written, every six
     * seconds, indefinitely — and "nothing has failed" is only worth reading on
     * a screen that would say when something had.
     */
    findBuildMock.mockResolvedValue(
      inFlight({ startedAt: new Date(Date.now() - 40 * 60_000) }),
    );

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );

    expect(screen.getByText("This one stopped partway")).toBeDefined();
    expect(screen.getByText(/40 minutes/)).toBeDefined();
    /*
     * No retry, and its absence is the assertion. It used to be a button here,
     * which asked the learner to spend four model calls and about a pound on a
     * guess — the catalogue's pound, on free — made by the one person who
     * cannot tell a bad subject from a bad afternoon.
     */
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    /*
     * And the handover said plainly, on the screen where it is the only good
     * news available. A stalled build was never reported by anything — nothing
     * ran to report it — so the promise here is deliberately the operator's
     * list rather than the mail, which holds either way.
     */
    expect(screen.getByText("A person is picking this up")).toBeDefined();
    expect(screen.getByText("With our team")).toBeDefined();
    expect(screen.getByText(/nothing for you to report/)).toBeDefined();
    // Nothing is polling a build that is not coming back.
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });

  it("says nothing is being built when there is no build and no course", async () => {
    // Reachable: `discardPack` takes the pack and its build row together.
    findBuildMock.mockResolvedValue(undefined);

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "rust-programming" }),
      }),
    );

    expect(
      screen.getByText("Nothing is being built under that name"),
    ).toBeDefined();
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
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
    // The reason still shows in full — what is gone is only the learner's
    // ability to spend a pound acting on it.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Pick something else" }),
    ).toBeDefined();
    /*
     * The handover, which on this screen is the whole of the good news and used
     * to be a clause buried mid-paragraph in the faintest type available. It
     * gets a `Signal` now — the one element in the product that carries a
     * colour on its edge — so the fact that somebody has this is the second
     * thing read after the reason, not the fifth.
     */
    expect(screen.getByText("A person is picking this up")).toBeDefined();
    expect(screen.getByText("With our team")).toBeDefined();
    // And the offer kept out of that card: a different subject is not more
    // reassurance about this one.
    expect(screen.getByText(/subject we already cover in depth/)).toBeDefined();
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
  const built = {
    slug: "photography",
    name: "Photography",
    skills: [
      { slug: "a", name: "Exposure", level: "core", canDoStatement: "Set an exposure by hand." },
      { slug: "b", name: "Composition", level: "applied", canDoStatement: "Frame a shot that leads the eye." },
    ],
    items: [{ slug: "i1" }, { slug: "i2" }, { slug: "i3" }],
  };

  it("badges it Experimental rather than passing it off as reviewed", async () => {
    // §7.1 — depth is declared, never faked.
    packMock.mockResolvedValue(built);

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "photography" }),
      }),
    );
    expect(screen.getByText(/Experimental/)).toBeDefined();
    expect(screen.getByRole("button", { name: "See my plan" })).toBeDefined();
  });

  it("shows what was built, because the caveat asks them to check it", async () => {
    /*
     * This screen shipped as a lone `AppHeader` in a `narrow` frame — a title,
     * a sentence, a badge and a button, with ~350px of dead gutter either side.
     * Widening an empty page only widens the emptiness, so the fix was the
     * content: the lead asks a learner to say "when something looks wrong"
     * while showing them nothing to look at, and this is the one moment they
     * can sanity-check a machine-written course before committing to it.
     */
    packMock.mockResolvedValue(built);

    render(
      await BuildingPage({
        searchParams: Promise.resolve({ subject: "photography" }),
      }),
    );

    expect(screen.getByText("Exposure")).toBeDefined();
    expect(screen.getByText("Composition")).toBeDefined();
    // The can-do statement, not the slug: it is what tells them whether the
    // skill is the one they wanted.
    expect(screen.getByText("Set an exposure by hand.")).toBeDefined();
    // And the size of what they got, so "2 skills" is not the only fact.
    expect(screen.getByText(/2 skills · 3 questions/)).toBeDefined();
  });

  it("creates the goal from the same conversation a covered subject would use", async () => {
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    await expect(
      adoptBuiltPackAction(form({ slug: "photography" })),
    ).rejects.toThrow("REDIRECT:/goals/goal-1/path");
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

  it("opens the course they already adopted rather than bouncing them", async () => {
    /*
     * The bug, reported from the wait screen: "See my plan" pressed twice.
     *
     * `finish` clears the intake on its way out, so the second press found no
     * captured answers and fell through to `/start` — which, on a free account
     * that has spent its one custom subject, is the closed-intake wall. It says
     * "we built you a course for a subject nobody had curated" and then offers
     * the catalogue and a price list: bounced off their own finished course by
     * the button that exists to open it. The wait screen is a URL people leave
     * open and reload, so this is an ordinary path, not an exotic one.
     */
    intake = { ...EMPTY_INTAKE };
    goalsForMock.mockResolvedValue([
      { id: "g-9", packSlug: "photography", spec: {}, status: "active" },
    ]);

    await expect(
      adoptBuiltPackAction(form({ slug: "photography" })),
    ).rejects.toThrow("REDIRECT:/goals/g-9/path");
    // Idempotent, not merely redirected: a second goal for the same pack would
    // be a duplicate course with the same name in the learner's list.
    expect(createGoalMock).not.toHaveBeenCalled();
  });
});

describe("the closed door", () => {
  /**
   * Every way into the conversation, refused for a free account that has had
   * its one custom subject.
   *
   * Asserted per action rather than only on the page, because a server action
   * is a public endpoint whatever the screen around it looked like — and two of
   * these spend a model call before they produce anything a learner sees.
   */
  const spent = () => {
    entitlementsMock.mockResolvedValue(freeEntitlements());
    commissionedMock.mockResolvedValue(1);
  };

  it("refuses to open a new conversation", async () => {
    spent();
    await expect(openAction()).rejects.toThrow("REDIRECT:/start?error=generated");
    expect(runAnalyzerMock).not.toHaveBeenCalled();
  });

  it("refuses a turn before it costs a model call", async () => {
    // The ordering is the point: a turn on a conversation that can never
    // produce anything is money spent on a screen nobody will be shown.
    spent();
    await expect(
      replyAction(form({ reply: "I want to learn Rust" })),
    ).rejects.toThrow("REDIRECT:/start?error=generated");
    expect(runAnalyzerMock).not.toHaveBeenCalled();
  });

  it("refuses to start fresh without eating the old conversation", async () => {
    // Guarded before `clearIntake`. Otherwise a learner who cannot open a new
    // conversation loses the one they had to the refusal.
    spent();
    await expect(
      startFreshAction(form({ reply: "Something else entirely" })),
    ).rejects.toThrow("REDIRECT:/start?error=generated");
    expect(clearIntakeMock).not.toHaveBeenCalled();
  });

  it("leaves every paid plan alone", async () => {
    // `packBuildsLifetime` is null on paid, so `remaining` is Infinity and
    // there is no door to close.
    commissionedMock.mockResolvedValue(9);
    await expect(openAction()).rejects.toThrow("REDIRECT:/start");
    expect(runAnalyzerMock).toHaveBeenCalled();
  });
});

describe("abandoning a stopped build", () => {
  /*
   * What is left of the old retry action. The learner can stop waiting; they
   * cannot spend four model calls and about a pound on a guess about why it
   * failed. Retrying moved to `/admin/packs`, where the person pressing it has
   * the reason and the drop log in front of them.
   */
  it("goes back to choosing without touching the build", async () => {
    await expect(abandonBuildAction()).rejects.toThrow("REDIRECT:/start");
    expect(startBuildMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("leaves the row for the operator, and for the learner's own claim on it", async () => {
    // The row is the admin queue now. It is also what `mayBuild` reads to let
    // this learner keep the subject without spending their allowance twice, so
    // clearing it here would cost them the subject as well as the wait.
    await expect(abandonBuildAction()).rejects.toThrow("REDIRECT:");
    expect(finishBuildMock).not.toHaveBeenCalled();
  });

  it("still requires a signed-in learner", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(abandonBuildAction()).rejects.toThrow("REDIRECT:/sign-in");
  });
});

describe("the last few edges", () => {
  it("names the subject from the build row, not from the conversation", async () => {
    // The row holds the subject the build was asked for. The conversation may
    // have moved on to something else, or have been cleared — reading it there
    // was a longer way to the same string, and a wrong one half the time.
    findBuildMock.mockResolvedValue({
      slug: "rust",
      subject: "Rust",
      status: "building",
      stage: "graph",
      detail: null,
      startedAt: new Date(),
    });
    intake = { ...EMPTY_INTAKE };

    render(
      await BuildingPage({ searchParams: Promise.resolve({ subject: "rust" }) }),
    );
    expect(screen.getByText("Building your Rust course")).toBeDefined();
  });

  it("treats a missing slug field as no slug", async () => {
    await expect(adoptBuiltPackAction(new FormData())).rejects.toThrow(
      "REDIRECT:/start?error=subject",
    );
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
    entitlementsMock.mockResolvedValue(freeEntitlements());
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

  it("refuses a subject somebody else commissioned", async () => {
    // `startBuild` upserts, so this would move the row to them — a new subject
    // for this account, and the quota still applies to it.
    onFree();
    ownsBuildMock.mockResolvedValue(false);
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start?error=generated",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("refuses even the subject their allowance was spent on", async () => {
    // The action half of the reversal above. Guarded before the intake is read,
    // so a conversation that cannot produce anything costs nothing to refuse.
    onFree();
    ownsBuildMock.mockResolvedValue(true);
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    await expect(buildFromConversationAction()).rejects.toThrow(
      "REDIRECT:/start?error=generated",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
  });
});

/**
 * §7.1's free tier keeps the conversation it has, and keeps it editable.
 *
 * "Start over" was offered to everybody, in two places, and on the free tier it
 * was the one control that could quietly cost the catalogue money for nothing:
 * six answers thrown away and six questions re-asked is six more model calls
 * against a budget that has one conversation in it. So the discard is a paid
 * thing, and both doors to it are shut — the link in the composer and the offer
 * to start on a subject they arrived holding.
 *
 * **What replaces it is not a wall, and that is the part worth holding.** A
 * conversation closes the moment the analyzer has enough, which is often one
 * sentence after the answer somebody wishes they had given differently — so
 * "Change an answer" reopens it with everything still in it. Nobody on any plan
 * has to spend their one custom subject on a conversation they could not
 * correct.
 */
describe("a free account keeps the conversation it has", () => {
  const BRIEF = {
    slug: "sales-dashboard",
    title: "Sales dashboard",
    topicSlug: "sql-data-analysis",
    topicName: "SQL & Data Analysis",
  };

  /** A conversation in progress, about something other than what they typed. */
  const holding = (subject: string | null = "Japanese") => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "Studied any Japanese before?" }],
      captured: captured({ subject }),
    };
  };

  /** The same, finished — the state that used to offer only "Start over". */
  const closed = () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [{ r: "a", t: "That's everything I need." }],
      captured: captured(),
      done: true,
    };
  };

  beforeEach(() => {
    entitlementsMock.mockResolvedValue(freeEntitlements());
  });

  it("draws no way to throw a conversation away while it is going", async () => {
    holding();
    render(await StartPage({ searchParams: search() }));

    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
    // The conversation itself is untouched — this takes nothing away from
    // somebody halfway through answering.
    expect(screen.getByLabelText("Your answer")).toBeDefined();
  });

  it("offers to change an answer once the conversation has closed", async () => {
    closed();
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Change an answer" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
    // And the thing they came for is still the loudest thing on the screen.
    expect(screen.getByRole("button", { name: "Build my plan" })).toBeDefined();
  });

  it("keeps both offers on a plan that includes starting over", async () => {
    entitlementsMock.mockResolvedValue(freshEntitlements());
    closed();
    render(await StartPage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Change an answer" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Start over" })).toBeDefined();
  });

  it("will not swap the conversation for a subject they arrived with", async () => {
    // The other door, and the one that made gating the link alone theatre: a
    // search on `/learn` and one click was a full reroll.
    holding();
    render(await StartPage({ searchParams: search({ topic: "javascript" }) }));

    expect(screen.getByText(/already have a conversation going/)).toBeDefined();
    expect(screen.queryByText(/Start on “javascript”\?/)).toBeNull();
    // Both ways onward are real: carry on with what they have, or read what a
    // paid plan does differently.
    expect(
      screen.getByRole("link", { name: /Carry on with Japanese/ }).getAttribute("href"),
    ).toBe("/start");
    expect(
      screen.getByRole("link", { name: /which plans start another/ }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("says something useful when the held conversation has no subject yet", async () => {
    holding(null);
    render(await StartPage({ searchParams: search({ topic: "javascript" }) }));

    expect(screen.getByText(/It’s about something else/)).toBeDefined();
    expect(screen.getByRole("link", { name: /Carry on where I was/ })).toBeDefined();
  });

  it("says the same thing when they arrive from a graded brief", async () => {
    holding();
    findProjectMock.mockReturnValue(BRIEF);
    render(await StartPage({ searchParams: search({ project: BRIEF.slug }) }));

    // The course is still described above — a reader who has just finished a
    // rubric should not find the page they asked for replaced by a price.
    expect(screen.getByText(/Start the SQL & Data Analysis course/)).toBeDefined();
    expect(screen.getByText(/already have a conversation going/)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Start the SQL & Data Analysis course/ }),
    ).toBeNull();
  });

  it("still opens a first conversation from a brief when none is held", async () => {
    // The line the whole rule turns on. Nothing is being discarded here, so
    // nothing is being refused: this is their conversation, not their second.
    findProjectMock.mockReturnValue(BRIEF);
    render(await StartPage({ searchParams: search({ project: BRIEF.slug }) }));

    expect(
      screen.getByRole("button", { name: /Start the SQL & Data Analysis course/ }),
    ).toBeDefined();
    expect(screen.queryByText(/already have a conversation going/)).toBeNull();
  });

  it("explains a refused discard that arrived as a bare POST", async () => {
    render(await StartPage({ searchParams: search({ error: "restart" }) }));
    expect(screen.getByText(/one goal conversation/)).toBeDefined();
  });

  it("refuses to throw the conversation away", async () => {
    // The screen is not the check: a server action is a public endpoint
    // whatever was rendered around it.
    holding();
    await expect(restartAction()).rejects.toThrow("REDIRECT:/start?error=restart");
    expect(clearIntakeMock).not.toHaveBeenCalled();
  });

  it("refuses to replace it with a subject they arrived holding", async () => {
    holding();
    await expect(
      startFreshAction(form({ reply: "javascript" })),
    ).rejects.toThrow("REDIRECT:/start?error=restart");

    expect(clearIntakeMock).not.toHaveBeenCalled();
    // Refused before the model, which is the point of refusing at all.
    expect(runAnalyzerMock).not.toHaveBeenCalled();
  });

  it("lets the same learner start one when they have none", async () => {
    await expect(
      startFreshAction(form({ reply: "javascript" })),
    ).rejects.toThrow("REDIRECT:/start#latest");
    expect(runAnalyzerMock).toHaveBeenCalledOnce();
  });
});

describe("changing an answer after the conversation has closed", () => {
  it("puts the conversation back in front of them, whole", async () => {
    intake = {
      ...EMPTY_INTAKE,
      messages: [
        { r: "a", t: "How many hours a week?" },
        { r: "l", t: "four" },
      ],
      captured: captured(),
      clarity: 0.9,
      packSlug: "photography",
      done: true,
    };

    await expect(reopenAction()).rejects.toThrow("REDIRECT:/start#latest");

    const saved = saveIntakeMock.mock.calls[0]![2];
    expect(saved.done).toBe(false);
    // Nothing re-asked and nothing forgotten: the same messages, the same
    // captured fields, and the course they chose on the way in.
    expect(saved.messages).toHaveLength(2);
    expect(saved.captured).toEqual(intake.captured);
    expect(saved.packSlug).toBe("photography");
  });

  it("writes nothing for a conversation that is still open", async () => {
    // Including the one that does not exist. Saving regardless would store an
    // empty intake for somebody who has never answered anything.
    await expect(reopenAction()).rejects.toThrow("REDIRECT:/start#latest");
    expect(saveIntakeMock).not.toHaveBeenCalled();
  });

  it("is closed to an account whose custom subject is spent", async () => {
    // The same door every other turn goes through: a conversation that can
    // never produce anything is not reopened to produce it.
    entitlementsMock.mockResolvedValue(freeEntitlements());
    commissionedMock.mockResolvedValue(1);
    intake = { ...EMPTY_INTAKE, captured: captured(), done: true };

    await expect(reopenAction()).rejects.toThrow("REDIRECT:/start?error=generated");
    expect(saveIntakeMock).not.toHaveBeenCalled();
  });
});
