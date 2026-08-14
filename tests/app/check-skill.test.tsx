// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { decode, encode, type CheckCookie } from "@/lib/check/session";
import { budgetFor, cookieFor, narrow } from "@/lib/check/run";
import { MASTERY_TARGET } from "@/lib/engine/scoring";

/**
 * §24 E11's `/check/{skill}` — the deep check, running.
 *
 * This page was an apology for two epics: it described a skill and said "you
 * cannot check this skill on its own yet". The arithmetic is why it had to
 * exist eventually. Clearing `MASTERY_TARGET` takes three to five observations
 * on one skill, and a nine-question check across twenty-six of them can never
 * give any single skill that many — so the broad check locates a learner and
 * proves nothing, whatever its budget.
 */

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

const page = await import("@/app/(marketing)/check/[topic]/[skill]/page");
const actions = await import("@/app/(marketing)/check/[topic]/actions");
const { findPack } = await import("@/lib/content");

const TOPIC = "photography";
const SKILL = "depth-of-field";
const REF = { topic: TOPIC, skill: SKILL };
const PATH = `/check/${TOPIC}/${SKILL}`;
const params = () => Promise.resolve({ topic: TOPIC, skill: SKILL });

const pack = findPack(TOPIC)!;
const { items } = narrow(pack, REF);
const budget = budgetFor(REF, items);

const seed = (state: CheckCookie) => jar.set(cookieFor(REF), encode(state));
const stored = (): CheckCookie => decode(jar.get(cookieFor(REF)));

const run = async (fn: () => Promise<void>) => {
  await expect(fn()).rejects.toThrow(`REDIRECT:${PATH}`);
};

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("before it starts", () => {
  it("is a description of the skill, not a check in progress", async () => {
    render(await page.default({ params: params() }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Depth of field",
    );
    expect(screen.getByText("What counts as knowing this")).toBeDefined();
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    // The state a crawler is served, and the one worth ranking.
    expect(screen.queryByText(/Question 1 of/)).toBeNull();
  });

  /**
   * Not a fixture curiosity: twenty skills across the catalogue have exactly
   * one question a check can ask, so a one-question deep check is an ordinary
   * case. It is also the clearest statement of the item-bank gap a visitor can
   * see — the page promises what it can actually ask, and no more.
   *
   * Written subjects are where it bites hardest, because their work cannot be
   * handed in here at all: a memo is §7.3's Text workspace, which the check has
   * no way to take, so the artefact question stays out and the pool is whatever
   * prose was written for it.
   */
  it("says 'question' when the bank holds exactly one", async () => {
    const ref = { topic: "business-writing", skill: "executive-summary" };
    expect(narrow(findPack(ref.topic)!, ref).items).toHaveLength(1);

    render(await page.default({ params: Promise.resolve(ref) }));
    expect(screen.getByText(/Up to 1 question on this skill/)).toBeDefined();
  });
});

describe("while it runs", () => {
  it("asks about this skill and no other", async () => {
    seed({ s: 1, a: [] });
    render(await page.default({ params: params() }));

    expect(screen.getByText(new RegExp(`Question 1 of ${budget}`))).toBeDefined();
    const prompts = items.map((i) => i.prompt);
    expect(prompts.some((p) => screen.queryByText(p) !== null)).toBe(true);
  });

  /**
   * The running screens drop the rest of the page. One question at a time is
   * the point, and a prerequisites map underneath would be an invitation to go
   * and read the answer.
   */
  it("puts nothing else on the screen", async () => {
    seed({ s: 1, a: [] });
    render(await page.default({ params: params() }));

    expect(screen.queryByText("What counts as knowing this")).toBeNull();
    expect(screen.queryByText(/need these first/)).toBeNull();
  });

  it("writes its answers to its own cookie, not the subject's", async () => {
    seed({ s: 1, a: [] });
    const closed = items.find((i) => i.type === "mcq")!;

    await run(() =>
      actions.submitAnswer(REF, formOf({ item: closed.slug, response: "0" })),
    );

    expect(stored().a).toHaveLength(1);
    // The subject's own check is untouched: a deep check must not eat the
    // questions a later broad one was going to ask.
    expect(jar.get(`check_${TOPIC}`)).toBeUndefined();
  });

  it("shows the grader's marking, and the answer it marked", async () => {
    const item = items[0]!;
    seed({
      s: 1,
      a: [{ i: item.slug, c: 1, g: 1 }],
      m: { i: item.slug, c: 1, f: "You named the control that put it there.", r: "wide aperture" },
    });

    render(await page.default({ params: params() }));
    expect(screen.getByText("Counted as right")).toBeDefined();
    expect(
      screen.getByText("You named the control that put it there."),
    ).toBeDefined();
    expect(screen.getByText("wide aperture")).toBeDefined();
  });

  it("falls back to the key and the learner's own verdict", async () => {
    const open = items.find((i) => i.type !== "mcq")!;
    seed({ s: 1, a: [], p: { i: open.slug, r: "a guess" } });

    render(await page.default({ params: params() }));
    expect(screen.getByText("A good answer covers")).toBeDefined();
    expect(screen.getByText("a guess")).toBeDefined();
    expect(screen.getByRole("button", { name: "I had that" })).toBeDefined();
  });

  it("survives a cookie that names an item this skill does not have", async () => {
    // The bank can be edited under a six-hour cookie.
    seed({ s: 1, a: [], p: { i: "gone", r: "…" } });
    await expect(page.default({ params: params() })).rejects.toThrow(
      `REDIRECT:${PATH}`,
    );

    seed({ s: 1, a: [], m: { i: "gone", c: 1, f: "…", r: "…" } });
    await expect(page.default({ params: params() })).rejects.toThrow(
      `REDIRECT:${PATH}`,
    );
  });
});

describe("when it is over", () => {
  /** Everything answered: `isComplete` is true because the bank ran out. */
  const answeredAll = (correct: 0 | 1) => ({
    s: 1 as const,
    a: items.map((i) => ({ i: i.slug, c: correct })),
  });

  it("says it could not settle the skill rather than implying it did", async () => {
    // Two observations cannot clear 0.85 — which is the item bank being thin,
    // not the check being wrong, and the page says the true thing.
    seed(answeredAll(1));
    render(await page.default({ params: params() }));

    expect(screen.getByText("The bar, unchanged")).toBeDefined();
    expect(screen.getByText(/Start again/)).toBeDefined();
    expect(screen.queryByText(/You cleared the bar/)).toBeNull();
  });

  it("keeps the bar on screen, in the same words as before the check", async () => {
    seed(answeredAll(0));
    render(await page.default({ params: params() }));

    const skill = pack.skills.find((s) => s.slug === SKILL)!;
    expect(screen.getByText(skill.canDoStatement)).toBeDefined();
  });

  it("sends a learner who wants proof to a graded project", async () => {
    seed(answeredAll(1));
    const { container } = render(await page.default({ params: params() }));
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );

    expect(hrefs).toContain("/projects");
    expect(hrefs).toContain(`/check/${TOPIC}`);
  });

  it("counts nothing when every answer was the learner's own verdict", async () => {
    // Self-marked answers are Tier 5 and cannot move mastery, so the result has
    // to say nothing counted rather than reporting a band off the priors.
    //
    // A skill with no closed item, because a closed one is marked whatever the
    // learner says about it — and most photography skills have exactly one
    // usable question, which is the item-bank gap this check is measured
    // against rather than a fixture convenience.
    const ref = { topic: TOPIC, skill: "metering-and-histogram" };
    const open = narrow(pack, ref).items;
    expect(open.every((i) => i.type !== "mcq")).toBe(true);

    jar.set(
      cookieFor(ref),
      encode({ s: 1, a: open.map((i) => ({ i: i.slug, c: 1 as const })) }),
    );

    render(await page.default({ params: Promise.resolve(ref) }));
    expect(screen.getByText(/Nothing here could be marked/)).toBeDefined();
  });

  it("declares the skill proved only when the belief actually cleared the bar", async () => {
    // Marked answers, enough of them, all right: this is the state the whole
    // page exists to be able to reach.
    seed({
      s: 1,
      a: items.map((i) => ({ i: i.slug, c: 1 as const, g: 1 as const })),
    });

    const { skills } = narrow(pack, REF);
    const { replay } = await import("@/lib/check/session");
    const state = replay(stored(), skills, items, new Date().toISOString());
    const cleared = state.mastery[SKILL]!.mastery >= MASTERY_TARGET;

    render(await page.default({ params: params() }));
    expect(screen.queryByText(/You cleared the bar/) !== null).toBe(cleared);
  });
});

function formOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
