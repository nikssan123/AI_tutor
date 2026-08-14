// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { decode, encode, type CheckCookie } from "@/lib/check/session";

/**
 * The Skill Check when §14.2's Assessment Agent is there to mark prose.
 *
 * Its own file because the premise is the opposite of `check-run.test.tsx`'s:
 * that suite runs with no API key, which is the fallback every environment
 * serving the public site alone will take. Here the marker answers, and what is
 * under test is that the check *records which happened* — a replay that
 * reconstructed a kinder mastery than the learner was shown would be the one
 * failure nobody would ever see.
 */

const markOpenAnswer = vi.fn();

vi.mock("@/lib/check/mark", () => ({
  markOpenAnswer: (...args: unknown[]) => markOpenAnswer(...args),
}));

/*
 * The client is stubbed rather than keyed, because the Anthropic SDK refuses to
 * construct in a browser-like environment and these page tests run in jsdom.
 * What is under test is the action's decision to build one at all, not the
 * SDK's constructor — and the decision is still the real code.
 */
vi.mock("@/lib/ai/client", () => ({
  hasApiKey: () => true,
  getAnthropic: () => ({ stub: true }),
}));

const jar = new Map<string, string>();

const cookiesMock = {
  get: (name: string) =>
    jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
};

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/headers", () => ({ cookies: async () => cookiesMock }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const page = await import("@/app/(marketing)/check/[topic]/page");
const actions = await import("@/app/(marketing)/check/[topic]/actions");
const { findPack } = await import("@/lib/content");
const { replay, toDiagnostic } = await import("@/lib/check/session");

const TOPIC = "photography";
const COOKIE = `check_${TOPIC}`;
const NOW = "2026-08-14T09:00:00.000Z";
const params = (topic = TOPIC) => Promise.resolve({ topic });

const pack = findPack(TOPIC)!;
const openItem = pack.items.find((i) => i.type === "explain")!;

const seed = (state: CheckCookie) => jar.set(COOKIE, encode(state));
const stored = (): CheckCookie => decode(jar.get(COOKIE));

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

const run = async (fn: () => Promise<void>) => {
  await expect(fn()).rejects.toThrow(`REDIRECT:/check/${TOPIC}`);
};

const marking = { correct: true, feedback: "You said the thing that matters." };

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
  markOpenAnswer.mockResolvedValue(marking);
});

afterEach(cleanup);

describe("an answer the grader marked", () => {
  it("records it, flags who marked it, and holds the marking to be read", async () => {
    seed({ s: 1, a: [] });

    await run(() =>
      actions.submitAnswer(
        TOPIC,
        form({ item: openItem.slug, response: "Light falls off with distance." }),
      ),
    );

    expect(stored().a).toEqual([{ i: openItem.slug, c: 1, g: 1 }]);
    expect(stored().m).toEqual({
      i: openItem.slug,
      c: 1,
      f: marking.feedback,
      r: "Light falls off with distance.",
    });
    // Not parked: nothing is waiting on the learner's own verdict.
    expect(stored().p).toBeUndefined();
  });

  it("holds the answer against the skill's own bar, not a second one", async () => {
    // The sentence the page prints as "what counts as knowing this" is the same
    // sentence the grader is handed. One bar, said once.
    seed({ s: 1, a: [] });
    const skill = pack.skills.find((s) => s.slug === openItem.skill)!;

    await run(() =>
      actions.submitAnswer(TOPIC, form({ item: openItem.slug, response: "x" })),
    );

    expect(markOpenAnswer.mock.calls[0]![1]).toEqual({
      question: openItem.prompt,
      expected: skill.canDoStatement,
      answer: "x",
    });
  });

  it("records a failed answer as failed, and says so", async () => {
    markOpenAnswer.mockResolvedValue({
      correct: false,
      feedback: "That is the effect, not the cause.",
    });
    seed({ s: 1, a: [] });

    await run(() =>
      actions.submitAnswer(TOPIC, form({ item: openItem.slug, response: "hmm" })),
    );

    expect(stored().a).toEqual([{ i: openItem.slug, c: 0, g: 1 }]);
    expect(stored().m?.c).toBe(0);
  });

  it("hands the marker a real client when there is a key to build one from", async () => {
    seed({ s: 1, a: [] });
    await run(() =>
      actions.submitAnswer(TOPIC, form({ item: openItem.slug, response: "x" })),
    );

    expect(markOpenAnswer.mock.calls[0]![0]).toMatchObject({
      client: { stub: true },
      // A factory, not a connection: a check with no marking to do never opens
      // one, and `getDb()` throws where there is no database to open.
      db: expect.any(Function),
    });
  });

  it("shows the marking before anything else, even when it ends the check", async () => {
    seed({
      s: 1,
      a: [],
      m: { i: openItem.slug, c: 0, f: "You described the effect, not the cause.", r: "dunno" },
    });

    render(await page.default({ params: params() }));

    expect(screen.getByText("Not right yet")).toBeDefined();
    expect(
      screen.getByText("You described the effect, not the cause."),
    ).toBeDefined();
    expect(screen.getByText("dunno")).toBeDefined();
    expect(screen.getByRole("button", { name: "Next question" })).toBeDefined();
    // Not the result screen, and not the next question.
    expect(screen.queryByText("Your result")).toBeNull();
  });

  it("says plainly when the marking was a pass", async () => {
    seed({
      s: 1,
      a: [{ i: openItem.slug, c: 1, g: 1 }],
      m: { i: openItem.slug, c: 1, f: "That is the reason, in your own words.", r: "…" },
    });

    render(await page.default({ params: params() }));
    expect(screen.getByText("Counted as right")).toBeDefined();
  });

  it("clears the marking and asks the next question", async () => {
    seed({
      s: 1,
      a: [{ i: openItem.slug, c: 1, g: 1 }],
      m: { i: openItem.slug, c: 1, f: "Good.", r: "…" },
    });

    await run(() => actions.continueAfterMarking(TOPIC));
    expect(stored().m).toBeUndefined();
    expect(stored().a).toHaveLength(1);
  });

  it("survives a marking for an item that has since left the pack", async () => {
    // A cookie outlives an edit to the item bank. The check would rather start
    // the next question than render a screen about a question nobody has.
    seed({ s: 1, a: [], m: { i: "gone", c: 1, f: "…", r: "…" } });

    await expect(page.default({ params: params() })).rejects.toThrow(
      `REDIRECT:/check/${TOPIC}`,
    );
  });

  it("does nothing when asked to continue with no marking to clear", async () => {
    seed({ s: 1, a: [] });
    await run(() => actions.continueAfterMarking(TOPIC));
    expect(stored().m).toBeUndefined();
  });
});

/**
 * §7.2's hard rule is the one thing that must not move: a graded answer counts,
 * a self-marked one never does. The two now live side by side in the same
 * cookie, so this asserts the difference where it is decided rather than where
 * it is displayed.
 */
describe("what a graded answer is worth", () => {
  const { skills, items } = toDiagnostic(pack);
  const correct = { i: openItem.slug, c: 1 as const };

  it("moves mastery when the grader marked it, and not when the learner did", () => {
    const graded = replay({ a: [{ ...correct, g: 1 }] }, skills, items, NOW);
    const selfMarked = replay({ a: [correct] }, skills, items, NOW);

    expect(graded.mastery[openItem.skill]!.mastery).toBeGreaterThan(
      selfMarked.mastery[openItem.skill]!.mastery,
    );
    expect(graded.asked[0]!.mode).toBe("graded");
    expect(selfMarked.asked[0]!.mode).toBe("self");
  });

  it("counts as assessed on the result screen only when something marked it", async () => {
    const { summarise } = await import("@/lib/engine/diagnostic");

    const graded = summarise(
      replay({ a: [{ ...correct, g: 1 }] }, skills, items, NOW),
      skills,
      NOW,
    );
    const selfMarked = summarise(
      replay({ a: [correct] }, skills, items, NOW),
      skills,
      NOW,
    );

    expect(graded.assessedCount).toBe(1);
    expect(graded.selfMarkedCount).toBe(0);
    expect(selfMarked.assessedCount).toBe(0);
    expect(selfMarked.selfMarkedCount).toBe(1);
  });
});
