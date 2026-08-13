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
const createGoalMock = vi.fn(async () => "goal-1");
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
vi.mock("@/lib/packs/build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/build")>()),
  startBuild: (...a: unknown[]) => startBuildMock(...(a as [])),
  findBuild: (...a: unknown[]) => findBuildMock(...(a as [])),
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
const search = (params: { error?: string; topic?: string } = {}) =>
  Promise.resolve(params);

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
  runAnalyzerMock.mockResolvedValue(turn());
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

  it("ignores an empty answer", async () => {
    await expect(replyAction(form({ reply: "   " }))).rejects.toThrow(
      "REDIRECT:/start",
    );
    expect(runAnalyzerMock).not.toHaveBeenCalled();
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
