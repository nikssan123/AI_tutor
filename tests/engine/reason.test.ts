import { describe, expect, it } from "vitest";
import {
  buildCompressionMessage,
  buildReason,
  NEGATIVE_PHRASES,
  POSITIVE_PHRASES,
} from "@/lib/engine/reason";
import type { ScoreComponents, ScoredSkill } from "@/lib/engine/types";
import { skill } from "./support";

const ZERO: ScoreComponents = {
  goalCriticality: 0,
  masteryGap: 0,
  prereqReadiness: 0,
  retentionUrgency: 0,
  momentum: 0,
  interleavingBonus: 0,
  frustrationRisk: 0,
  timeFit: 0,
  recentlyFailedTwice: 0,
};

function scored(components: Partial<ScoreComponents>): ScoredSkill {
  return {
    skillId: "joins",
    score: 1,
    components: { ...ZERO, ...components },
    effectiveMastery: 0.4,
  };
}

const joins = skill("joins", { name: "Join grain" });

describe("buildReason", () => {
  it("names the component that actually drove the choice", () => {
    // The sentence has to describe the arithmetic that picked this skill, not a
    // plausible story about it — that is why it is templated, not generated.
    const reason = buildReason({
      top: scored({ retentionUrgency: 1 }),
      skill: joins,
      minutes: 25,
      backingOff: false,
      isApplySession: false,
      retrievalCount: 0,
    });
    expect(reason).toContain("fading");
    expect(reason).toContain("25 minutes on Join grain");
  });

  it("leads with goal criticality when that dominates", () => {
    const reason = buildReason({
      top: scored({ goalCriticality: 1 }),
      skill: joins,
      minutes: 30,
      backingOff: false,
      isApplySession: false,
      retrievalCount: 0,
    });
    expect(reason).toContain("directly on the path to your goal");
  });

  it("mentions the retrieval warm-up when there is one", () => {
    const reason = buildReason({
      top: scored({ masteryGap: 1 }),
      skill: joins,
      minutes: 30,
      backingOff: false,
      isApplySession: false,
      retrievalCount: 3,
    });
    expect(reason).toContain("3 quick recall questions first");
  });

  it("uses the singular for a single recall question", () => {
    const reason = buildReason({
      top: scored({ masteryGap: 1 }),
      skill: joins,
      minutes: 30,
      backingOff: false,
      isApplySession: false,
      retrievalCount: 1,
    });
    expect(reason).toContain("1 quick recall question first");
    expect(reason).not.toContain("questions");
  });

  it("says what an apply session is for", () => {
    const reason = buildReason({
      top: scored({ goalCriticality: 1 }),
      skill: joins,
      minutes: 45,
      backingOff: false,
      isApplySession: true,
      retrievalCount: 0,
    });
    expect(reason).toContain("producing something real for us to grade");
  });

  it("leads with the negative term when that is what actually dominated", () => {
    // Ranking by signed contribution would surface the largest *positive* term
    // and tell someone who just failed twice that the groundwork is in place.
    // §4.2 law 3: overclaiming is the fastest way to lose an expert user.
    const reason = buildReason({
      top: scored({ recentlyFailedTwice: 1, prereqReadiness: 1 }),
      skill: joins,
      minutes: 20,
      isApplySession: false,
      backingOff: false,
      retrievalCount: 0,
    });
    expect(reason).toContain("hasn't gone well twice running");
    expect(reason).not.toContain("groundwork");
  });

  it("falls back only when nothing at all is driving the choice", () => {
    const reason = buildReason({
      top: scored({}),
      skill: joins,
      minutes: 20,
      isApplySession: false,
      backingOff: false,
      retrievalCount: 0,
    });
    expect(reason).toContain("the next thing worth your time");
  });

  it("says plainly when the session is backing off", () => {
    const reason = buildReason({
      top: scored({ recentlyFailedTwice: 1 }),
      skill: joins,
      minutes: 30,
      isApplySession: false,
      backingOff: true,
      retrievalCount: 0,
    });
    expect(reason).toContain("going back over it, with nothing to submit");
  });

  it("prefers backing off over the apply framing when both apply", () => {
    const reason = buildReason({
      top: scored({ recentlyFailedTwice: 1 }),
      skill: joins,
      minutes: 30,
      isApplySession: true,
      backingOff: true,
      retrievalCount: 0,
    });
    expect(reason).toContain("nothing to submit");
    expect(reason).not.toContain("grade");
  });

  it("always produces one clean sentence", () => {
    const reason = buildReason({
      top: scored({ momentum: 1 }),
      skill: joins,
      minutes: 20,
      backingOff: false,
      isApplySession: false,
      retrievalCount: 2,
    });
    expect(reason.endsWith(".")).toBe(true);
    expect(reason).not.toMatch(/\s{2,}/);
    expect(reason.charAt(0)).toBe(reason.charAt(0).toUpperCase());
    expect(reason.split(".").filter(Boolean)).toHaveLength(1);
  });

  it("covers every positive component phrasing", () => {
    const keys: Array<keyof ScoreComponents> = [
      "goalCriticality",
      "masteryGap",
      "prereqReadiness",
      "retentionUrgency",
      "momentum",
      "interleavingBonus",
      "timeFit",
    ];
    for (const key of keys) {
      const reason = buildReason({
        top: scored({ [key]: 1 } as Partial<ScoreComponents>),
        skill: joins,
        minutes: 20,
        backingOff: false,
        isApplySession: false,
        retrievalCount: 0,
      });
      expect(reason.length).toBeGreaterThan(20);
      expect(reason.endsWith(".")).toBe(true);
    }
  });

  it("reaches the negative-component phrasings when they lead", () => {
    // frustrationRisk and recentlyFailedTwice carry negative weights, so they
    // only ever surface through the fallback branch — assert both are reachable.
    for (const key of ["frustrationRisk", "recentlyFailedTwice"] as const) {
      const reason = buildReason({
        top: scored({ [key]: 1 }),
        skill: joins,
        minutes: 20,
        backingOff: false,
        isApplySession: false,
        retrievalCount: 0,
      });
      expect(reason).toContain("Join grain");
    }
  });
});

describe("the phrase tables", () => {
  const KEYS: Array<keyof ScoreComponents> = [
    "goalCriticality",
    "masteryGap",
    "prereqReadiness",
    "retentionUrgency",
    "momentum",
    "interleavingBonus",
    "frustrationRisk",
    "timeFit",
    "recentlyFailedTwice",
  ];

  it("has a positive and a negative phrasing for all nine components", () => {
    expect(Object.keys(POSITIVE_PHRASES).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(NEGATIVE_PHRASES).sort()).toEqual([...KEYS].sort());
  });

  it("renders every phrase as a lower-case clause naming the skill", () => {
    // These are sentence fragments spliced after "so today is…", so a stray
    // capital or full stop would show up as broken copy on /today.
    for (const key of KEYS) {
      for (const table of [POSITIVE_PHRASES, NEGATIVE_PHRASES]) {
        const phrase = table[key](joins);
        expect(phrase).toContain("Join grain");
        expect(phrase.endsWith(".")).toBe(false);
        expect(phrase.trim()).toBe(phrase);
        expect(phrase.length).toBeGreaterThan(10);
      }
    }
  });

  it("says something different in the positive and negative direction", () => {
    for (const key of KEYS) {
      // frustrationRisk and recentlyFailedTwice read the same either way —
      // there is no encouraging way to say "this went badly", and pretending
      // otherwise is the overclaiming §4.2 law 3 rules out.
      if (key === "frustrationRisk" || key === "recentlyFailedTwice") continue;
      expect(POSITIVE_PHRASES[key](joins)).not.toBe(NEGATIVE_PHRASES[key](joins));
    }
  });
});

describe("buildCompressionMessage", () => {
  it("tells the learner what was cut (§4.2 law 5)", () => {
    const message = buildCompressionMessage(
      [skill("a", { name: "Window functions" }), skill("b", { name: "CTEs" })],
      "2026-09-01",
    );
    expect(message).toContain("2026-09-01");
    expect(message).toContain("Window functions and CTEs");
    expect(message).toContain("moving the deadline");
  });

  it("handles a single dropped skill", () => {
    const message = buildCompressionMessage(
      [skill("a", { name: "CTEs" })],
      "2026-09-01",
    );
    expect(message).toContain("Dropped: CTEs.");
  });

  it("summarises a long list rather than dumping it", () => {
    const message = buildCompressionMessage(
      ["a", "b", "c", "d", "e"].map((id) =>
        skill(id, { name: `Skill ${id.toUpperCase()}` }),
      ),
      "2026-09-01",
    );
    expect(message).toContain("and 2 more");
  });

  it("is honest when the plan is compressed but nothing was cut", () => {
    const message = buildCompressionMessage([], "2026-09-01");
    expect(message).toContain("Nothing has been cut yet");
  });
});
