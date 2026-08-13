import { describe, expect, it } from "vitest";
import {
  bandFor,
  DEFAULT_BUDGET,
  gradeAuto,
  gradingModeFor,
  isComplete,
  observationsFor,
  recordResponse,
  selectNextItem,
  startDiagnostic,
  summarise,
  uncertainty,
  type DiagnosticItem,
  type DiagnosticSkill,
} from "@/lib/engine/diagnostic";
import { loadAllPacks } from "@/lib/packs/loader";

/**
 * §24 E4 — the Skill Check.
 *
 * The property under test throughout is the one that makes it shippable without
 * an evaluator: **the check never awards credit it cannot justify.** A
 * self-marked answer is Tier 5, and Tier 5 never raises mastery — asserted here
 * end to end rather than trusted to the BKT unit tests, because this is the
 * surface where a learner would actually be misled.
 */

const NOW = "2026-08-13T09:00:00.000Z";

const priors = { pInit: 0.2, pLearn: 0.2, pSlip: 0.1, pGuess: 0.2 };

const skills: DiagnosticSkill[] = [
  { slug: "alpha", name: "Alpha", priors },
  { slug: "beta", name: "Beta", priors },
];

const item = (over: Partial<DiagnosticItem> & { slug: string }): DiagnosticItem => ({
  skill: "alpha",
  type: "mcq",
  difficulty: 0.5,
  discrimination: 1,
  prompt: "A question that is long enough.",
  options: ["a", "b"],
  answerKey: { correct: 1 },
  ...over,
});

describe("gradingModeFor — what a machine may honestly judge", () => {
  it("decides a closed item", () => {
    expect(gradingModeFor("mcq")).toBe("auto");
  });

  it("leaves an artefact out of a ten-minute check entirely", () => {
    expect(gradingModeFor("micro_artifact")).toBe("excluded");
  });

  it.each(["short_text", "explain", "code_read"])(
    "hands %s to the learner to mark",
    (type) => {
      expect(gradingModeFor(type)).toBe("self");
    },
  );
});

describe("gradeAuto — never credit what it cannot decide", () => {
  it("marks the keyed option correct", () => {
    expect(gradeAuto(item({ slug: "q" }), "1")).toBe(true);
  });

  it("marks any other option wrong", () => {
    expect(gradeAuto(item({ slug: "q" }), "0")).toBe(false);
  });

  it("refuses to grade an item that is not closed", () => {
    expect(gradeAuto(item({ slug: "q", type: "explain" }), "1")).toBe(false);
  });

  it.each([
    ["a missing key", undefined],
    ["a non-object key", "1" as unknown],
    ["a null key", null],
    ["a key with no correct index", { concepts: ["x"] }],
    ["a non-numeric correct index", { correct: "1" }],
  ])("returns false for %s rather than guessing", (_name, answerKey) => {
    expect(gradeAuto(item({ slug: "q", answerKey }), "1")).toBe(false);
  });
});

describe("selectNextItem — deterministic and information-seeking", () => {
  it("returns the same question for the same state, every time", () => {
    const state = startDiagnostic(skills);
    const items = [
      item({ slug: "b-item", difficulty: 0.5 }),
      item({ slug: "a-item", difficulty: 0.5 }),
    ];
    const first = selectNextItem(state, items);
    expect(selectNextItem(state, items)).toEqual(first);
    // Ties break on slug, so the choice cannot drift between runs.
    expect(first!.slug).toBe("a-item");
  });

  it("never repeats an item already asked", () => {
    let state = startDiagnostic(skills);
    const items = [item({ slug: "one" }), item({ slug: "two" })];
    state = recordResponse(state, items[0]!, true, priors, NOW);
    expect(selectNextItem(state, items)!.slug).toBe("two");
  });

  it("skips artefact items, which belong to a project brief", () => {
    const state = startDiagnostic(skills);
    const items = [item({ slug: "art", type: "micro_artifact" })];
    expect(selectNextItem(state, items)).toBeUndefined();
  });

  it("ignores an item whose skill is out of scope", () => {
    const state = startDiagnostic(skills);
    expect(
      selectNextItem(state, [item({ slug: "x", skill: "not-in-scope" })]),
    ).toBeUndefined();
  });

  /**
   * Regression: information-greedy selection drilled one skill, because a
   * correct answer moves the posterior towards 0.5 where items are most
   * informative. Coverage is a hard rule for exactly this reason.
   */
  it("spreads across skills rather than drilling one", () => {
    let state = startDiagnostic(skills);
    const items = [
      item({ slug: "a1", skill: "alpha" }),
      item({ slug: "a2", skill: "alpha" }),
      item({ slug: "b1", skill: "beta" }),
    ];
    state = recordResponse(state, items[0]!, true, priors, NOW);
    // Alpha has been asked once, beta not at all, so beta wins next.
    expect(selectNextItem(state, items)!.skill).toBe("beta");
  });

  it("prefers an item pitched near the current estimate", () => {
    const state = startDiagnostic([{ slug: "alpha", name: "Alpha", priors }]);
    const items = [
      item({ slug: "far", difficulty: 0.95 }),
      item({ slug: "near", difficulty: 0.2 }),
    ];
    // pInit is 0.2, so the 0.2 item is the informative one.
    expect(selectNextItem(state, items)!.slug).toBe("near");
  });

  it("exhausts every skill once before asking any skill twice", () => {
    let state = startDiagnostic(skills);
    const items = [
      item({ slug: "a1", skill: "alpha" }),
      item({ slug: "a2", skill: "alpha" }),
      item({ slug: "a3", skill: "alpha" }),
      item({ slug: "b1", skill: "beta" }),
    ];
    const order: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = selectNextItem(state, items)!;
      order.push(next.skill);
      state = recordResponse(state, next, true, priors, NOW);
    }
    expect(order.slice(0, 2).sort()).toEqual(["alpha", "beta"]);
    expect(order[2]).toBe("alpha");
  });

  it("weights a more discriminating item higher, all else equal", () => {
    const state = startDiagnostic([{ slug: "alpha", name: "Alpha", priors }]);
    const items = [
      item({ slug: "a-blunt", discrimination: 0.5 }),
      item({ slug: "b-sharp", discrimination: 2 }),
    ];
    // "a-blunt" would win the slug tie-break, so only discrimination can flip it.
    expect(selectNextItem(state, items)!.slug).toBe("b-sharp");
  });
});

describe("uncertainty", () => {
  it("peaks where the belief is least settled", () => {
    expect(uncertainty(0.5)).toBe(1);
    expect(uncertainty(0)).toBe(0);
    expect(uncertainty(1)).toBe(0);
    expect(uncertainty(0.75)).toBeCloseTo(0.5);
  });
});

describe("the Tier 5 rule, at the surface a learner would see", () => {
  it("moves mastery on a correct closed answer", () => {
    const state = startDiagnostic(skills);
    const after = recordResponse(state, item({ slug: "q" }), true, priors, NOW);
    expect(after.mastery.alpha!.mastery).toBeGreaterThan(
      state.mastery.alpha!.mastery,
    );
    expect(after.asked[0]!.mode).toBe("auto");
  });

  /**
   * The heart of it: a learner can mark every open answer correct and still not
   * have proved anything. If this ever fails, the check has become the
   * self-declared progress bar the whole product exists to replace.
   */
  it("never moves mastery on a self-marked answer, however many", () => {
    let state = startDiagnostic(skills);
    const before = state.mastery.alpha!.mastery;

    for (const slug of ["q1", "q2", "q3", "q4", "q5"]) {
      state = recordResponse(
        state,
        item({ slug, type: "explain" }),
        true,
        priors,
        NOW,
      );
    }

    expect(state.mastery.alpha!.mastery).toBe(before);
    expect(state.mastery.alpha!.evidenceCount).toBe(0);
    expect(state.asked.every((a) => a.mode === "self")).toBe(true);
  });

  it("counts the practice even though it withholds the credit", () => {
    const state = recordResponse(
      startDiagnostic(skills),
      item({ slug: "q", type: "explain" }),
      true,
      priors,
      NOW,
    );
    expect(state.mastery.alpha!.lastPracticedAt).toBe(NOW);
    expect(observationsFor(state, "alpha")).toBe(1);
  });
});

describe("isComplete", () => {
  it("stops at the item budget", () => {
    let state = startDiagnostic(skills);
    const items = Array.from({ length: 20 }, (_, i) =>
      item({ slug: `q${i}`, skill: i % 2 ? "alpha" : "beta" }),
    );
    for (let i = 0; i < DEFAULT_BUDGET; i++) {
      state = recordResponse(state, items[i]!, true, priors, NOW);
    }
    expect(isComplete(state, items)).toBe(true);
  });

  it("stops early when the bank runs dry", () => {
    let state = startDiagnostic(skills);
    const items = [item({ slug: "only" })];
    expect(isComplete(state, items)).toBe(false);
    state = recordResponse(state, items[0]!, true, priors, NOW);
    expect(isComplete(state, items)).toBe(true);
  });

  it("honours a caller-supplied budget", () => {
    let state = startDiagnostic(skills);
    const items = [item({ slug: "a" }), item({ slug: "b" })];
    state = recordResponse(state, items[0]!, true, priors, NOW);
    expect(isComplete(state, items, 1)).toBe(true);
  });
});

describe("bandFor", () => {
  it.each([
    [0.9, true, "likely-known"],
    [0.7, true, "likely-known"],
    [0.5, true, "unclear"],
    [0.4, true, "unclear"],
    [0.2, true, "gap"],
  ])("maps %s to %s when a closed item decided it", (m, assessed, band) => {
    expect(bandFor(m as number, assessed as boolean)).toBe(band);
  });

  it("refuses to band a skill no closed item touched", () => {
    // Even at a high posterior — the prior alone is not a finding.
    expect(bandFor(0.95, false)).toBe("not-assessed");
  });
});

describe("summarise — separates what was checked from what was claimed", () => {
  it("reports self-marked answers without counting them as assessed", () => {
    let state = startDiagnostic(skills);
    state = recordResponse(
      state,
      item({ slug: "open", skill: "alpha", type: "explain" }),
      true,
      priors,
      NOW,
    );
    state = recordResponse(
      state,
      item({ slug: "closed", skill: "beta" }),
      true,
      priors,
      NOW,
    );

    const summary = summarise(state, skills, NOW);
    expect(summary.assessedCount).toBe(1);
    expect(summary.selfMarkedCount).toBe(1);

    const alpha = summary.verdicts.find((v) => v.skillSlug === "alpha")!;
    expect(alpha.band).toBe("not-assessed");
    expect(alpha.answered).toBe(1);

    const beta = summary.verdicts.find((v) => v.skillSlug === "beta")!;
    expect(beta.assessed).toBe(true);
  });

  it("lists every in-scope skill, including untouched ones", () => {
    const summary = summarise(startDiagnostic(skills), skills, NOW);
    expect(summary.verdicts).toHaveLength(2);
    expect(summary.verdicts.every((v) => v.band === "not-assessed")).toBe(true);
    expect(summary.gaps).toEqual([]);
  });

  it("collects gaps and unclear skills as the things to work on", () => {
    let state = startDiagnostic(skills);
    state = recordResponse(state, item({ slug: "q", skill: "alpha" }), false, priors, NOW);
    const summary = summarise(state, skills, NOW);
    expect(summary.gaps.map((g) => g.skillSlug)).toEqual(["alpha"]);
  });
});

describe("against the real packs", () => {
  const packs = loadAllPacks();

  it.each(packs.map((p) => [p.slug, p] as const))(
    "%s runs a full check without repeating or stalling",
    (_slug, pack) => {
      const packSkills: DiagnosticSkill[] = pack.skills.map((s) => ({
        slug: s.slug,
        name: s.name,
        priors: s.bktPriors,
      }));
      const priorsBySkill = new Map(packSkills.map((s) => [s.slug, s.priors]));
      const items: DiagnosticItem[] = pack.items.map((i) => ({
        slug: i.slug,
        skill: i.skill,
        type: i.type,
        difficulty: i.difficulty,
        discrimination: i.discrimination,
        prompt: i.prompt,
        options: i.options,
        answerKey: i.answerKey,
      }));

      let state = startDiagnostic(packSkills);
      const seen = new Set<string>();

      while (!isComplete(state, items)) {
        const next = selectNextItem(state, items)!;
        expect(seen.has(next.slug), `repeated ${next.slug}`).toBe(false);
        seen.add(next.slug);
        state = recordResponse(
          state,
          next,
          true,
          priorsBySkill.get(next.skill)!,
          NOW,
        );
      }

      expect(state.asked).toHaveLength(DEFAULT_BUDGET);
      expect(summarise(state, packSkills, NOW).verdicts).toHaveLength(
        pack.skills.length,
      );
    },
  );

  /**
   * A finding, pinned so it cannot regress quietly: the packs are production-
   * heavy by design (§16.4 requires it), which leaves very few closed items —
   * so a check can only *verify* a small share of any subject today. Writing
   * more MCQ items is the fix; this asserts the current floor rather than
   * pretending it is higher.
   */
  it.each(packs.map((p) => [p.slug, p] as const))(
    "%s has at least one closed item to verify with",
    (_slug, pack) => {
      const closed = pack.items.filter((i) => gradingModeFor(i.type) === "auto");
      expect(closed.length).toBeGreaterThan(0);
    },
  );
});
