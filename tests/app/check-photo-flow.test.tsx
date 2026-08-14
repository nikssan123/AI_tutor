// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { decode, encode, type CheckCookie } from "@/lib/check/session";
import { cookieFor, narrow } from "@/lib/check/run";
import { gradingModeFor } from "@/lib/engine/diagnostic";

/**
 * §7.3's photograph, from the file input to the mastery it moves.
 *
 * This is the only place in the product where a learner's actual work is
 * marked without a person in the loop and without an account, so what is under
 * test is mostly what happens when it *cannot* be marked: a file we cannot
 * read, a file too large to send, and the four ways the marking itself does not
 * happen. Each has to land somewhere honest, and only one of them is the
 * learner's to fix.
 */

const markPhotoAnswer = vi.fn();
const markOpenAnswer = vi.fn();

vi.mock("@/lib/check/mark", () => ({
  markPhotoAnswer: (...a: unknown[]) => markPhotoAnswer(...a),
  markOpenAnswer: (...a: unknown[]) => markOpenAnswer(...a),
}));

vi.mock("@/lib/ai/client", () => ({
  hasApiKey: () => true,
  getAnthropic: () => ({ stub: true }),
}));

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const page = await import("@/app/(marketing)/check/[topic]/[skill]/page");
const actions = await import("@/app/(marketing)/check/[topic]/actions");
const { findPack } = await import("@/lib/content");

const REF = { topic: "photography", skill: "depth-of-field" };
const PATH = `/check/${REF.topic}/${REF.skill}`;
const params = () => Promise.resolve(REF);

const pack = findPack(REF.topic)!;
const artefact = narrow(pack, REF).items.find(
  (i) => gradingModeFor(i.type) === "excluded",
)!;

const seed = (state: CheckCookie) => jar.set(cookieFor(REF), encode(state));
const stored = (): CheckCookie => decode(jar.get(cookieFor(REF)));

const photo = () =>
  new File([new Uint8Array([1, 2, 3])], "frame.jpg", { type: "image/jpeg" });

const submit = async (over: Record<string, string | File> = {}) => {
  const fd = new FormData();
  fd.set("item", artefact.slug);
  fd.set("response", "");
  fd.set("photo", photo());
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  await expect(actions.submitAnswer(REF, fd)).rejects.toThrow(
    `REDIRECT:${PATH}`,
  );
};

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
  markPhotoAnswer.mockResolvedValue({
    marking: { correct: true, feedback: "The middle object is the only crisp one." },
    refused: null,
  });
  seed({ s: 1, a: [] });
});

/**
 * The selector is coverage-first, so the artefact is only next once the other
 * questions about this skill are answered. Rendering it is what needs that;
 * the action takes the item off the form and does not care.
 */
const artefactIsNext = () =>
  seed({
    s: 1,
    a: narrow(pack, REF)
      .items.filter((i) => i.slug !== artefact.slug)
      .map((i) => ({ i: i.slug, c: 1 as const })),
  });

afterEach(cleanup);

describe("the question that asks for a photograph", () => {
  it("offers a file input rather than a textarea to answer with", async () => {
    artefactIsNext();
    const { container } = render(await page.default({ params: params() }));

    const upload = container.querySelector<HTMLInputElement>(
      'input[type="file"][name="photo"]',
    )!;
    expect(upload).not.toBeNull();
    expect(upload.accept).toContain("image/jpeg");
    expect(upload.required).toBe(true);
    // And a place to say something about it, which is not the answer.
    expect(container.querySelector('textarea[name="response"]')).not.toBeNull();
    expect(screen.getByText(/a photograph$/)).toBeDefined();
  });

  it("says what it will take, and that it keeps nothing", async () => {
    artefactIsNext();
    render(await page.default({ params: params() }));

    expect(screen.getByText(/JPEG, PNG or WebP/)).toBeDefined();
    expect(screen.getByText(/we do not keep it/)).toBeDefined();
  });
});

describe("a photograph that was marked", () => {
  it("records it as work, not as an answer about work", async () => {
    await submit({ response: "f/1.8 at a metre." });

    // `k` is what tells a replay this was the thing itself — it moves the
    // belief further than prose would (`ARTEFACT_CONFIDENCE`).
    expect(stored().a).toEqual([{ i: artefact.slug, c: 1, g: 1, k: 1 }]);
    expect(stored().m).toMatchObject({
      i: artefact.slug,
      c: 1,
      r: "f/1.8 at a metre.",
    });
  });

  it("hands the grader the file, the task and the skill's own bar", async () => {
    await submit({ response: "a note" });

    const [, answer] = markPhotoAnswer.mock.calls[0]!;
    const skill = pack.skills.find((s) => s.slug === REF.skill)!;
    expect(answer).toMatchObject({
      question: artefact.prompt,
      expected: skill.canDoStatement,
      note: "a note",
    });
    expect((answer as { file: File }).file.type).toBe("image/jpeg");
  });

  it("moves mastery further than the same verdict on prose would", async () => {
    const { replay, toDiagnostic } = await import("@/lib/check/session");
    const { skills, items } = toDiagnostic(pack);
    const now = "2026-08-14T09:00:00.000Z";
    const answer = { i: artefact.slug, c: 1 as const, g: 1 as const };

    const asWork = replay({ a: [{ ...answer, k: 1 }] }, skills, items, now);
    const asProse = replay({ a: [answer] }, skills, items, now);

    expect(asWork.mastery[REF.skill]!.mastery).toBeGreaterThan(
      asProse.mastery[REF.skill]!.mastery,
    );
    expect(asWork.asked[0]!.mode).toBe("artefact");
  });
});

describe("a photograph that could not be marked", () => {
  it("asks again, and says what was wrong with the file", async () => {
    markPhotoAnswer.mockResolvedValue({ marking: null, refused: "too-big" });
    await submit();

    // Nothing recorded: the question was not answered, it was not accepted.
    expect(stored().a).toEqual([]);
    expect(stored().e).toBe("too-big");

    artefactIsNext();
    jar.set(cookieFor(REF), encode({ ...stored(), e: "too-big" }));
    render(await page.default({ params: params() }));
    expect(screen.getByText(/Export it smaller/)).toBeDefined();
    expect(screen.getByText(artefact.prompt)).toBeDefined();
  });

  it("says the other thing for a file that is not an image", async () => {
    markPhotoAnswer.mockResolvedValue({ marking: null, refused: "wrong-type" });
    await submit();

    artefactIsNext();
    jar.set(cookieFor(REF), encode({ ...stored(), e: "wrong-type" }));
    render(await page.default({ params: params() }));
    expect(screen.getByText(/not an image we can read/)).toBeDefined();
  });

  it("treats a form with no file at all as a file we cannot read", async () => {
    const fd = new FormData();
    fd.set("item", artefact.slug);
    fd.set("response", "");
    await expect(actions.submitAnswer(REF, fd)).rejects.toThrow(
      `REDIRECT:${PATH}`,
    );

    expect(stored().e).toBe("wrong-type");
    expect(markPhotoAnswer).not.toHaveBeenCalled();
  });

  it("clears the complaint as soon as another answer arrives", async () => {
    markPhotoAnswer.mockResolvedValue({ marking: null, refused: "too-big" });
    await submit();
    expect(stored().e).toBe("too-big");

    markPhotoAnswer.mockResolvedValue({
      marking: { correct: false, feedback: "No falloff anywhere." },
      refused: null,
    });
    await submit();

    expect(stored().e).toBeUndefined();
    expect(stored().a).toHaveLength(1);
  });

  /**
   * Ours rather than theirs — no key, no budget, a failed call — so it falls
   * back to what every other unmarked answer falls back to: the learner marks
   * themselves against the key, and §7.2 refuses to count it.
   */
  it("falls back to self-marking when the failure is ours", async () => {
    markPhotoAnswer.mockResolvedValue({ marking: null, refused: null });
    await submit({ response: "my attempt" });

    expect(stored().a).toEqual([]);
    expect(stored().e).toBeUndefined();
    expect(stored().p).toEqual({ i: artefact.slug, r: "my attempt" });
  });
});
