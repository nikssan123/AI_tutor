import { describe, expect, it } from "vitest";
import { masteryFromCheck, parseGoalForm } from "@/lib/goals/intake";
import { STATED_CLARITY } from "@/lib/contracts/goal";
import { encode, toDiagnostic } from "@/lib/check/session";
import { findPack } from "@/lib/content";
import { gradingModeFor } from "@/lib/engine/diagnostic";

/**
 * §24 E3 (the deterministic half) and §24 E11's "the anonymous check result is
 * preserved through signup".
 */

const NOW = "2026-08-13T09:00:00.000Z";
const pack = findPack("photography")!;

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
};

const valid = {
  outcomeType: "career",
  statedLevel: "beginner",
  weeklyHours: "4",
};

describe("parseGoalForm", () => {
  it("fills every GoalSpec field from what was asked", () => {
    const result = parseGoalForm(
      form({ ...valid, rawGoal: "stop guessing at shutter speed" }),
      pack,
    );

    expect(result).toEqual({
      ok: true,
      spec: {
        rawGoal: "stop guessing at shutter speed",
        domain: pack.slug,
        targetOutcome: pack.name,
        outcomeType: "career",
        statedLevel: "beginner",
        weeklyHours: 4,
        deadline: null,
        motivation: "",
        constraints: [],
        existingAssets: [],
        // Nor a background control: the analyzer asks about what a learner
        // already works with, the form does not, so the schema default lands.
        priorDomain: "none",
        // The form has no depth control, so the schema's default lands here.
        // A goal created before the dial existed reads back the same way, which
        // is what makes `standard` the only safe default: it is the behaviour
        // every existing goal was already planned under.
        depth: "standard",
        // Nothing was inferred, so there is nothing left to clarify. The Goal
        // Analyzer will produce values below this and ask again.
        clarity: STATED_CLARITY,
      },
    });
  });

  it("writes a plain goal sentence when the learner leaves it blank", () => {
    const result = parseGoalForm(form(valid), pack);
    expect(result.ok && result.spec.rawGoal).toBe("Get good at photography");
  });

  it("keeps a long goal rather than rejecting the form over it", () => {
    const result = parseGoalForm(
      form({ ...valid, rawGoal: "x".repeat(900) }),
      pack,
    );
    expect(result.ok && result.spec.rawGoal.length).toBe(500);
  });

  it("accepts a real deadline and drops an empty one", () => {
    expect(
      parseGoalForm(form({ ...valid, deadline: "2026-12-01" }), pack),
    ).toMatchObject({ ok: true, spec: { deadline: "2026-12-01" } });

    expect(parseGoalForm(form({ ...valid, deadline: "  " }), pack)).toMatchObject(
      { ok: true, spec: { deadline: null } },
    );
  });

  it.each([
    ["not a number", { weeklyHours: "soon" }, /Weekly hours/],
    ["below the floor", { weeklyHours: "0.1" }, /Weekly hours/],
    ["above the ceiling", { weeklyHours: "41" }, /Weekly hours/],
    ["an unknown level", { statedLevel: "godlike" }, /starting from/],
    ["a missing level", { statedLevel: "" }, /starting from/],
    ["an unknown outcome", { outcomeType: "vibes" }, /what this is for/i],
    ["a hand-typed deadline", { deadline: "next tuesday" }, /deadline/i],
  ])("rejects %s with a message naming the field", (_label, patch, message) => {
    const result = parseGoalForm(form({ ...valid, ...patch }), pack);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(message);
  });

  it("truncates a long motivation instead of failing", () => {
    const result = parseGoalForm(
      form({ ...valid, motivation: "y".repeat(900) }),
      pack,
    );
    expect(result.ok && result.spec.motivation.length).toBe(500);
  });
});

describe("masteryFromCheck", () => {
  const { items } = toDiagnostic(pack);
  const closed = items.filter((i) => gradingModeFor(i.type) === "auto");
  const open = items.filter((i) => gradingModeFor(i.type) === "self");

  it("carries nothing across when there was no check", () => {
    expect(masteryFromCheck(pack, undefined, NOW)).toEqual([]);
    expect(masteryFromCheck(pack, encode({ a: [] }), NOW)).toEqual([]);
  });

  it("returns only the skills the check actually observed", () => {
    const item = closed[0]!;
    const carried = masteryFromCheck(
      pack,
      encode({ a: [{ i: item.slug, c: 1 }] }),
      NOW,
    );

    // Seeding a row per pack skill would write the pack's priors into the
    // learner's record as though they were evidence about them.
    expect(carried.map((m) => m.skillId)).toEqual([item.skill]);
    expect(carried[0]!.evidenceCount).toBe(1);
  });

  it("never lets a self-marked answer raise mastery", () => {
    // §7.2 — self-marking is Tier 5. Someone who forges a cookie claiming they
    // aced every open question gets exactly what an honest learner gets, and
    // the rule lives in the BKT rather than in this file.
    const cookie = encode({ a: open.slice(0, 6).map((i) => ({ i: i.slug, c: 1 as const })) });
    const carried = masteryFromCheck(pack, cookie, NOW);

    for (const state of carried) {
      const prior = pack.skills.find((s) => s.slug === state.skillId)!.bktPriors;
      expect(state.mastery).toBeLessThanOrEqual(prior.pInit);
    }
  });

  it("ignores answers to items a pack edit has since removed", () => {
    const item = closed[0]!;
    const carried = masteryFromCheck(
      pack,
      encode({ a: [{ i: "deleted-item", c: 1 }, { i: item.slug, c: 1 }] }),
      NOW,
    );

    expect(carried.map((m) => m.skillId)).toEqual([item.skill]);
  });

  it("is sorted, so two identical checks store identical rows", () => {
    const answers = closed.slice(0, 4).map((i) => ({ i: i.slug, c: 1 as const }));
    const carried = masteryFromCheck(pack, encode({ a: answers }), NOW);
    const slugs = carried.map((m) => m.skillId);

    expect(slugs).toEqual([...slugs].sort());
  });
});
