import { describe, expect, it } from "vitest";
import {
  COOKIE_PREFIX,
  cookieName,
  decode,
  encode,
  MAX_ANSWERS,
  needsSelfMark,
  readableAnswerKey,
  replay,
  type CheckCookie,
} from "@/lib/check/session";
import type { DiagnosticItem, DiagnosticSkill } from "@/lib/engine/diagnostic";

/**
 * The cookie is untrusted input from an anonymous visitor, so the properties
 * that matter are: it never throws, and it can never invent a mastery score.
 */

const NOW = "2026-08-13T09:00:00.000Z";
const priors = { pInit: 0.2, pLearn: 0.2, pSlip: 0.1, pGuess: 0.2 };

const skills: DiagnosticSkill[] = [{ slug: "alpha", name: "Alpha", priors }];

const items: DiagnosticItem[] = [
  {
    slug: "closed",
    skill: "alpha",
    type: "mcq",
    difficulty: 0.4,
    discrimination: 1,
    prompt: "Which one is right?",
    options: ["wrong", "right"],
    answerKey: { correct: 1 },
  },
  {
    slug: "open",
    skill: "alpha",
    type: "explain",
    difficulty: 0.5,
    discrimination: 1,
    prompt: "Explain the thing.",
    answerKey: { concepts: ["first", "second"] },
  },
];

describe("cookieName", () => {
  it("namespaces per subject", () => {
    expect(cookieName("photography")).toBe(`${COOKIE_PREFIX}photography`);
  });

  it("strips anything that is not a slug, so a path cannot be injected", () => {
    expect(cookieName("../../evil; Path=/")).toBe(`${COOKIE_PREFIX}evilPath`);
  });
});

describe("decode — never throws, whatever arrives", () => {
  it("round-trips what encode wrote", () => {
    const state: CheckCookie = { s: 1, a: [{ i: "closed", c: 1 }] };
    expect(decode(encode(state))).toEqual(state);
  });

  it.each([
    ["nothing at all", undefined],
    ["an empty string", ""],
    ["not base64", "!!!!not-base64!!!!"],
    ["base64 of not-JSON", Buffer.from("nonsense").toString("base64url")],
    ["JSON that is not an object", Buffer.from("42").toString("base64url")],
    ["JSON null", Buffer.from("null").toString("base64url")],
    ["an object with no answers", Buffer.from('{"x":1}').toString("base64url")],
    [
      "answers that are not an array",
      Buffer.from('{"a":"nope"}').toString("base64url"),
    ],
  ])("falls back to a fresh check for %s", (_name, raw) => {
    expect(decode(raw as string | undefined)).toEqual({ a: [] });
  });

  it("drops malformed entries rather than the whole cookie", () => {
    const raw = encode({
      a: [
        { i: "keep", c: 1 },
        // Each of these is individually invalid.
        { i: 5, c: 1 },
        { i: "bad-c", c: 7 },
        null,
        "string",
      ] as never,
    });
    expect(decode(raw).a).toEqual([{ i: "keep", c: 1 }]);
  });

  it("caps how many answers it will read", () => {
    const many = Array.from({ length: MAX_ANSWERS + 15 }, (_, n) => ({
      i: `q${n}`,
      c: 1 as const,
    }));
    expect(decode(encode({ a: many })).a).toHaveLength(MAX_ANSWERS);
  });

  it("keeps a well-formed pending answer", () => {
    const raw = encode({ s: 1, a: [], p: { i: "open", r: "my answer" } });
    expect(decode(raw).p).toEqual({ i: "open", r: "my answer" });
  });

  it("truncates an oversized pending response", () => {
    const raw = encode({ a: [], p: { i: "open", r: "x".repeat(9000) } });
    expect(decode(raw).p!.r).toHaveLength(4000);
  });

  it.each([
    ["a non-object", { i: "open", r: "ok" }, "p", "nope"],
    ["a missing slug", undefined, "p", { r: "ok" }],
    ["a missing response", undefined, "p", { i: "open" }],
  ])("drops a pending answer that is %s", (_name, _a, key, value) => {
    const raw = Buffer.from(
      JSON.stringify({ a: [], [key]: value }),
    ).toString("base64url");
    expect(decode(raw).p).toBeUndefined();
  });

  it("only honours the started flag when it is exactly 1", () => {
    expect(decode(encode({ s: 1, a: [] })).s).toBe(1);
    expect(
      decode(Buffer.from('{"a":[],"s":true}').toString("base64url")).s,
    ).toBeUndefined();
  });
});

describe("replay — the cookie is input, the engine is the authority", () => {
  it("reconstructs mastery from answers alone", () => {
    const state = replay({ a: [{ i: "closed", c: 1 }] }, skills, items, NOW);
    expect(state.asked).toHaveLength(1);
    expect(state.mastery.alpha!.mastery).toBeGreaterThan(priors.pInit);
  });

  it("is deterministic — the same cookie always rebuilds the same state", () => {
    const cookie: CheckCookie = { a: [{ i: "closed", c: 1 }] };
    expect(replay(cookie, skills, items, NOW)).toEqual(
      replay(cookie, skills, items, NOW),
    );
  });

  /**
   * A cookie written before a pack was edited must degrade to a shorter check,
   * not a crash — and must not silently credit a skill that no longer exists.
   */
  it("skips an item that is no longer in the pack", () => {
    const state = replay(
      { a: [{ i: "deleted-last-week", c: 1 }, { i: "closed", c: 1 }] },
      skills,
      items,
      NOW,
    );
    expect(state.asked.map((a) => a.itemSlug)).toEqual(["closed"]);
  });

  it("skips an item whose skill is out of scope", () => {
    const orphan: DiagnosticItem = { ...items[0]!, slug: "orphan", skill: "gone" };
    const state = replay({ a: [{ i: "orphan", c: 1 }] }, skills, [orphan], NOW);
    expect(state.asked).toEqual([]);
  });

  /** A forged cookie can only lie to itself: self-marks still never count. */
  it("cannot be forged into a mastery score", () => {
    const forged: CheckCookie = {
      a: Array.from({ length: 20 }, () => ({ i: "open", c: 1 as const })),
    };
    const state = replay(forged, skills, items, NOW);
    expect(state.mastery.alpha!.mastery).toBe(priors.pInit);
    expect(state.mastery.alpha!.evidenceCount).toBe(0);
  });
});

describe("needsSelfMark", () => {
  it("is false for a closed item and true for an open one", () => {
    expect(needsSelfMark(items[0]!)).toBe(false);
    expect(needsSelfMark(items[1]!)).toBe(true);
  });
});

describe("readableAnswerKey", () => {
  it("lists the concepts a good answer covers", () => {
    expect(readableAnswerKey(items[1]!)).toEqual(["first", "second"]);
  });

  it("resolves a correct-option index to its text", () => {
    expect(readableAnswerKey(items[0]!)).toEqual(["right"]);
  });

  it("keeps only string concepts", () => {
    expect(
      readableAnswerKey({ ...items[1]!, answerKey: { concepts: ["ok", 5, null] } }),
    ).toEqual(["ok"]);
  });

  it.each([
    ["no key", undefined],
    ["a non-object key", "x" as unknown],
    ["a null key", null],
    ["an empty key", {}],
    ["an index with no matching option", { correct: 9 }],
    ["a non-numeric index", { correct: "1" }],
  ])("returns nothing for %s rather than inventing an answer", (_n, answerKey) => {
    expect(readableAnswerKey({ ...items[0]!, answerKey })).toEqual([]);
  });
});
