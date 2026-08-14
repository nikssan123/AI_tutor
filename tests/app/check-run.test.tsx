// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { decode, encode, type CheckCookie } from "@/lib/check/session";
import { gradingModeFor } from "@/lib/engine/diagnostic";
import { EVAL_TIER_CLAIM } from "@/lib/claims";
import { tierFor } from "@/lib/evaluation/tier";

/**
 * §24 E4 — the Skill Check as a learner meets it.
 *
 * The engine's honesty is tested in `tests/engine/diagnostic.test.ts`; what is
 * tested here is that the *screens* say the same thing the engine does. A page
 * that shows a reassuring score the model never awarded would be the failure
 * §4.2 law 3 exists to prevent, and it would not show up in an engine test.
 */

const jar = new Map<string, string>();

/**
 * The options the cookie was actually written with, which this harness used to
 * throw away — and that is how a `path` nobody could receive survived two
 * passes. A jar handed straight to the function accepts any scope at all; the
 * browser is the part that decides, and it was not in the test.
 */
const writtenWith = new Map<string, Record<string, unknown>>();

const cookiesMock = {
  get: (name: string) =>
    jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  set: (name: string, value: string, options?: Record<string, unknown>) => {
    jar.set(name, value);
    writtenWith.set(name, options ?? {});
  },
};

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/headers", () => ({ cookies: async () => cookiesMock }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
}));

const page = await import("@/app/(marketing)/check/[topic]/page");
const actions = await import("@/app/(marketing)/check/[topic]/actions");
const { findPack } = await import("@/lib/content");

const TOPIC = "photography";
const COOKIE = `check_${TOPIC}`;
const params = (topic = TOPIC) => Promise.resolve({ topic });

const pack = findPack(TOPIC)!;
const closedItem = pack.items.find((i) => i.type === "mcq")!;
const openItem = pack.items.find((i) => i.type === "explain")!;

const seed = (state: CheckCookie) => jar.set(COOKIE, encode(state));
const stored = (): CheckCookie => decode(jar.get(COOKIE));

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

/** Actions always end in a redirect, which the mock throws. */
const run = async (fn: () => Promise<void>) => {
  await expect(fn()).rejects.toThrow(`REDIRECT:/check/${TOPIC}`);
};

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("the intro", () => {
  /**
   * The count this used to assert ("5 of the 33 questions can be marked
   * automatically") was true while only closed items could be marked. §14.2's
   * grader marks written answers now, and a number that has to be re-explained
   * the moment a marker is unavailable is worse than the rule it stood for.
   * The rule is what the page still states, and it has not moved.
   */
  it("states plainly what counts and what does not", async () => {
    render(await page.default({ params: params() }));

    expect(
      screen.getByText((t) => t.includes("If we can’t mark one, you’ll mark it")),
    ).toBeDefined();
    expect(
      screen.getByText(/marking your own work never counts as proof/),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Start the check/ })).toBeDefined();
  });

  it("quotes the tier the evaluator can honour, not the pack's declared one", async () => {
    // This page read `pack.evalTier` directly while every other surface went
    // through `topicSummary`, so it went on promising tier 1's "we run your
    // work" after the rest of the site had stopped. Found by curling the page,
    // not by the suite — which is why the assertion is here now.
    render(await page.default({ params: params() }));

    expect(screen.getByText(EVAL_TIER_CLAIM[tierFor(pack.evalTier)]!.label)).toBeDefined();
    expect(screen.queryByText(EVAL_TIER_CLAIM[1]!.label)).toBeNull();
  });

  it("404s for a subject that does not exist", async () => {
    await expect(page.default({ params: params("nope") })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("is submitted for indexing on exactly its pack's gate", async () => {
    // Named "is never submitted for indexing" until E4's assessment shipped and
    // the check earned §12.1's bar. It is gated on `isTopicIndexable` now — the
    // same review its curriculum sits behind — so this asserts the pairing
    // rather than a fixed answer, which is what went stale.
    const { findPack, isTopicIndexable } = await import("@/lib/content");
    const meta = await page.generateMetadata({ params: params() });

    if (isTopicIndexable(findPack("sql-data-analysis")!)) {
      expect(meta.robots).toBeUndefined();
    } else {
      expect(meta.robots).toEqual({ index: false, follow: true });
    }
  });

  it("returns empty metadata for an unknown subject", async () => {
    expect(await page.generateMetadata({ params: params("nope") })).toEqual({});
  });
});

/**
 * §24 E11 — "the anonymous check result is preserved through signup".
 *
 * The carry-in was built (`masteryFromCheck`), the badge that promises it was
 * built (`answeredTopics`, on `/today`, `/subjects` and the goal form), and none
 * of it could ever fire: the cookie was written at `path: /check/{topic}`, so a
 * browser sent it to the check and to nothing else. Every reader is outside that
 * path. Nothing failed loudly — the screens simply behaved as though no check
 * had been taken, which is indistinguishable from a visitor who took none.
 */
describe("where the cookie can be read from", () => {
  it("is written site-wide, or the carry-in cannot happen", async () => {
    await run(() => actions.startCheck(TOPIC));
    expect(writtenWith.get(COOKIE)?.path).toBe("/");
  });

  it("stays httpOnly, same-site and short-lived", async () => {
    // Widening the scope is not a licence to relax the rest of it: what this
    // holds is a list of item slugs and a 0 or 1 each, for six hours.
    await run(() => actions.startCheck(TOPIC));
    expect(writtenWith.get(COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 6,
    });
  });
});

describe("answering", () => {
  it("shows a closed question with its options and no answer given away", async () => {
    seed({ s: 1, a: [] });
    const { container } = render(await page.default({ params: params() }));

    expect(screen.getByText(/marked automatically/)).toBeDefined();
    expect(container.querySelectorAll('input[type="radio"]').length).toBeGreaterThan(1);
    expect(container.querySelector('input[name="item"]')).toBeDefined();
  });

  it("grades a closed answer and moves on", async () => {
    seed({ s: 1, a: [] });
    const correct = (closedItem.answerKey as { correct: number }).correct;

    await run(() =>
      actions.submitAnswer(
        TOPIC,
        form({ item: closedItem.slug, response: String(correct) }),
      ),
    );

    expect(stored().a).toEqual([{ i: closedItem.slug, c: 1 }]);
  });

  it("records a wrong closed answer as wrong", async () => {
    seed({ s: 1, a: [] });
    const correct = (closedItem.answerKey as { correct: number }).correct;

    await run(() =>
      actions.submitAnswer(
        TOPIC,
        form({ item: closedItem.slug, response: String(correct + 1) }),
      ),
    );

    expect(stored().a).toEqual([{ i: closedItem.slug, c: 0 }]);
  });

  /**
   * With no API key configured — which is this suite, and any environment
   * serving the public site alone — an open answer falls back to the behaviour
   * the check shipped with. Nothing is recorded until the learner has said how
   * it went, and §7.2 will refuse to count it when they do.
   */
  it("parks an open answer for self-marking when nothing can mark it", async () => {
    seed({ s: 1, a: [] });

    await run(() =>
      actions.submitAnswer(
        TOPIC,
        form({ item: openItem.slug, response: "my attempt" }),
      ),
    );

    expect(stored().a).toEqual([]);
    expect(stored().p).toEqual({ i: openItem.slug, r: "my attempt" });
    expect(stored().m).toBeUndefined();
  });

  it("drops a submission for an item that is not in the pack", async () => {
    seed({ s: 1, a: [] });
    await run(() =>
      actions.submitAnswer(TOPIC, form({ item: "forged", response: "0" })),
    );
    expect(stored().a).toEqual([]);
  });

  it("drops a submission for a subject that does not exist", async () => {
    await expect(
      actions.submitAnswer("nope", form({ item: "x", response: "0" })),
    ).rejects.toThrow("REDIRECT:/check/nope");
  });

  it("ignores a form with no item field at all", async () => {
    seed({ s: 1, a: [] });
    await run(() => actions.submitAnswer(TOPIC, new FormData()));
    expect(stored().a).toEqual([]);
  });

  /** Reached once the closed items are used up, which is most of the check. */
  it("shows an open question as a free-text box, promising nothing about who marks it", async () => {
    seed({
      s: 1,
      a: pack.items
        .filter((i) => i.type === "mcq")
        .map((i) => ({ i: i.slug, c: 1 as const })),
    });
    const { container } = render(await page.default({ params: params() }));

    // Neither promise is safe before the fact — the grader may or may not be
    // reachable and inside the day's budget when the answer arrives.
    expect(screen.getByText(/a written answer/)).toBeDefined();
    expect(screen.queryByText(/marked automatically/)).toBeNull();
    expect(container.querySelector('textarea[name="response"]')).toBeDefined();
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(
      screen.getByRole("button", { name: "Answer" }),
    ).toBeDefined();
  });

  it("treats a missing response as an answer rather than crashing", async () => {
    seed({ s: 1, a: [] });
    await run(() => actions.submitAnswer(TOPIC, form({ item: closedItem.slug })));
    expect(stored().a).toEqual([{ i: closedItem.slug, c: 0 }]);
  });
});

describe("self-marking — the honest part", () => {
  beforeEach(() => seed({ s: 1, a: [], p: { i: openItem.slug, r: "what I wrote" } }));

  it("reveals the answer key beside what the learner wrote", async () => {
    render(await page.default({ params: params() }));

    expect(screen.getByText("what I wrote")).toBeDefined();
    expect(screen.getByText(/A good answer covers/)).toBeDefined();
    expect(screen.getByRole("button", { name: "I had that" })).toBeDefined();
    expect(screen.getByRole("button", { name: "I did not" })).toBeDefined();
  });

  it("says outright that the self-mark will not move the record", async () => {
    render(await page.default({ params: params() }));
    expect(screen.getByText(/Either way, this does not count/)).toBeDefined();
  });

  it("shows a placeholder when the answer was left blank", async () => {
    seed({ s: 1, a: [], p: { i: openItem.slug, r: "" } });
    render(await page.default({ params: params() }));
    expect(screen.getByText("(left blank)")).toBeDefined();
  });

  it("records a generous self-mark, and the engine still withholds credit", async () => {
    await run(() => actions.submitSelfMark(TOPIC, form({ got: "1" })));
    expect(stored().a).toEqual([{ i: openItem.slug, c: 1 }]);
    expect(stored().p).toBeUndefined();
  });

  it("records an honest self-mark too", async () => {
    await run(() => actions.submitSelfMark(TOPIC, form({ got: "0" })));
    expect(stored().a).toEqual([{ i: openItem.slug, c: 0 }]);
  });

  it("does nothing when there is no pending answer to mark", async () => {
    seed({ s: 1, a: [] });
    await run(() => actions.submitSelfMark(TOPIC, form({ got: "1" })));
    expect(stored().a).toEqual([]);
  });

  it("falls back to the question screen if the parked item vanished", async () => {
    seed({ s: 1, a: [], p: { i: "deleted-item", r: "x" } });
    await expect(page.default({ params: params() })).rejects.toThrow(
      `REDIRECT:/check/${TOPIC}`,
    );
  });
});

describe("the result", () => {
  /** Nine closed answers: the only way anything gets machine-marked. */
  const nineClosed = (): CheckCookie => ({
    s: 1,
    a: pack.items
      .filter((i) => i.type === "mcq")
      .concat(pack.items.filter((i) => i.type === "explain"))
      .slice(0, 9)
      .map((i) => ({ i: i.slug, c: 1 as const })),
  });

  it("lists every skill, and marks the untouched ones Not assessed", async () => {
    seed(nineClosed());
    render(await page.default({ params: params() }));

    expect(screen.getByText("Your result")).toBeDefined();
    for (const skill of pack.skills) {
      expect(screen.getByText(skill.name), skill.slug).toBeDefined();
    }
    expect(screen.getAllByText("Not assessed").length).toBeGreaterThan(0);
  });

  it("counts self-marked answers separately and says they do not count", async () => {
    seed(nineClosed());
    render(await page.default({ params: params() }));
    expect(screen.getByText(/not in the list above/)).toBeDefined();
  });

  /**
   * The strongest claim on the page. A learner who marks themselves right on
   * every open question must still be told nothing was verified.
   */
  it("reports nothing verified when only open questions were answered", async () => {
    seed({
      s: 1,
      a: pack.items
        .filter((i) => gradingModeFor(i.type) === "self")
        .slice(0, 9)
        .map((i) => ({ i: i.slug, c: 1 as const })),
    });
    render(await page.default({ params: params() }));

    expect(
      screen.getByText(/None of these could be marked automatically/),
    ).toBeDefined();
    expect(screen.queryByText("Likely known")).toBeNull();
  });

  /**
   * The pack holds only four closed items, so a nine-answer check with exactly
   * one self-mark cannot be built from distinct ones. Repeating them is a fair
   * stand-in and doubles as a note that replay tolerates a repeated slug.
   */
  const nineWith = (selfMarks: number): CheckCookie => {
    const closed = pack.items.filter((i) => i.type === "mcq");
    const open = pack.items.filter((i) => gradingModeFor(i.type) === "self");
    const a = [
      ...open.slice(0, selfMarks).map((i) => ({ i: i.slug, c: 1 as const })),
    ];
    let n = 0;
    while (a.length < 9) {
      a.push({ i: closed[n++ % closed.length]!.slug, c: 1 as const });
    }
    return { s: 1, a };
  };

  it("says 'answer' not 'answers' for a single self-mark", async () => {
    seed(nineWith(1));
    render(await page.default({ params: params() }));
    expect(screen.getByText(/1 answer\b/)).toBeDefined();
  });

  it("stays silent about self-marking when there was none", async () => {
    seed(nineWith(0));
    render(await page.default({ params: params() }));
    expect(screen.getByText("Your result")).toBeDefined();
    expect(screen.queryByText(/deliberately does not count/)).toBeNull();
  });

  it("offers a way back to the map and to real graded work", async () => {
    seed(nineClosed());
    render(await page.default({ params: params() }));
    expect(
      screen.getByText("See the whole skill map").getAttribute("href"),
    ).toBe(`/learn/${TOPIC}`);
    expect(screen.getByText("Look at a graded project")).toBeDefined();
  });

  it("can be started again from scratch", async () => {
    seed(nineClosed());
    await run(() => actions.startCheck(TOPIC));
    expect(stored()).toEqual({ s: 1, a: [] });
  });
});
