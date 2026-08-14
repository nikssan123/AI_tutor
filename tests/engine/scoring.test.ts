import { describe, expect, it } from "vitest";
import {
  buildContext,
  DEADLINE_CRITICALITY_MULTIPLIER,
  HARD_PREREQ_THRESHOLD,
  isBehindSchedule,
  isEligible,
  MASTERY_TARGET,
  rankSkills,
  scoreComponents,
  totalScore,
  WEIGHTS,
} from "@/lib/engine/scoring";
import {
  attempt,
  constraints,
  dependency,
  graph,
  mastery,
  plannerInput,
  session,
  skill,
} from "./support";

describe("eligibility (§16.1 step 1)", () => {
  it("keeps a skill whose hard prerequisites are all at or above 0.7", () => {
    const input = plannerInput({
      graph: graph(
        [skill("basics"), skill("joins")],
        [dependency("basics", "joins")],
      ),
      goalSkillIds: ["joins"],
      mastery: [
        mastery("basics", {
          mastery: HARD_PREREQ_THRESHOLD,
          evidenceCount: 1,
          lastSuccessAt: "2026-08-12T09:00:00.000Z",
        }),
      ],
    });
    expect(isEligible(buildContext(input), "joins")).toBe(true);
  });

  it("blocks a skill whose hard prerequisite is below threshold", () => {
    const input = plannerInput({
      graph: graph(
        [skill("basics"), skill("joins")],
        [dependency("basics", "joins")],
      ),
      goalSkillIds: ["joins"],
      mastery: [mastery("basics", { mastery: 0.69 })],
    });
    expect(isEligible(buildContext(input), "joins")).toBe(false);
  });

  it("does not block on a soft prerequisite — soft means easier, not required", () => {
    const input = plannerInput({
      graph: graph(
        [skill("stats"), skill("windows")],
        [dependency("stats", "windows", "soft", 0.5)],
      ),
      goalSkillIds: ["windows"],
      mastery: [mastery("stats", { mastery: 0 })],
    });
    expect(isEligible(buildContext(input), "windows")).toBe(true);
  });

  it("drops a skill the learner has already mastered", () => {
    const input = plannerInput({
      graph: graph([skill("a")]),
      goalSkillIds: ["a"],
      mastery: [
        mastery("a", {
          mastery: MASTERY_TARGET,
          evidenceCount: 3,
          lastSuccessAt: "2026-08-12T09:00:00.000Z",
        }),
      ],
    });
    expect(isEligible(buildContext(input), "a")).toBe(false);
  });

  it("re-opens a mastered skill once decay drags it below the target", () => {
    // The point of the decay model: yesterday's mastery is not today's.
    const input = plannerInput({
      now: "2026-09-12T09:00:00.000Z",
      graph: graph([skill("a")]),
      goalSkillIds: ["a"],
      mastery: [
        mastery("a", {
          mastery: 0.9,
          evidenceCount: 3,
          lastSuccessAt: "2026-08-12T09:00:00.000Z",
          decayHalfLifeDays: 7,
        }),
      ],
    });
    expect(isEligible(buildContext(input), "a")).toBe(true);
  });

  it("drops a skill that is not on a path to any goal skill", () => {
    const input = plannerInput({
      graph: graph([skill("a"), skill("unrelated")]),
      goalSkillIds: ["a"],
    });
    expect(isEligible(buildContext(input), "unrelated")).toBe(false);
  });
});

describe("score components (§16.1 step 2)", () => {
  const base = plannerInput({
    graph: graph(
      [
        skill("basics", { area: "foundations", estimatedHours: 1.5 }),
        skill("joins", { area: "querying", estimatedHours: 1.5 }),
        skill("windows", { area: "analytics", estimatedHours: 1.5 }),
      ],
      [
        dependency("basics", "joins"),
        dependency("joins", "windows"),
        dependency("basics", "windows", "soft", 0.5),
      ],
    ),
    goalSkillIds: ["windows"],
  });

  it("scores masteryGap as the distance to the 0.85 target, clipped at 0", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        mastery: [
          mastery("joins", {
            mastery: 0.6,
            evidenceCount: 1,
            lastSuccessAt: "2026-08-12T09:00:00.000Z",
          }),
        ],
      }),
    );
    expect(scoreComponents(ctx, "joins", 30).masteryGap).toBeCloseTo(0.25, 10);
  });

  it("clips masteryGap at 0 rather than going negative", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        mastery: [
          mastery("joins", {
            mastery: 0.95,
            evidenceCount: 1,
            lastSuccessAt: "2026-08-12T09:00:00.000Z",
          }),
        ],
      }),
    );
    expect(scoreComponents(ctx, "joins", 30).masteryGap).toBe(0);
  });

  it("scores prereqReadiness as the mean of soft prerequisites", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        mastery: [
          mastery("basics", {
            mastery: 0.6,
            evidenceCount: 1,
            lastSuccessAt: "2026-08-12T09:00:00.000Z",
          }),
        ],
      }),
    );
    expect(scoreComponents(ctx, "windows", 30).prereqReadiness).toBeCloseTo(
      0.6,
      10,
    );
  });

  it("scores prereqReadiness as 1 when a skill has no soft prerequisites", () => {
    const ctx = buildContext(base);
    expect(scoreComponents(ctx, "basics", 30).prereqReadiness).toBe(1);
  });

  it("scores retentionUrgency from elapsed half-lives", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        now: "2026-08-19T09:00:00.000Z",
        mastery: [
          mastery("joins", {
            mastery: 0.6,
            evidenceCount: 2,
            lastSuccessAt: "2026-08-12T09:00:00.000Z",
            decayHalfLifeDays: 7,
          }),
        ],
      }),
    );
    expect(scoreComponents(ctx, "joins", 30).retentionUrgency).toBeCloseTo(
      0.5,
      10,
    );
  });

  it("scores retentionUrgency as 0 for a skill with no mastery row", () => {
    const ctx = buildContext(base);
    expect(scoreComponents(ctx, "joins", 30).retentionUrgency).toBe(0);
  });

  it("scores momentum higher for the most recent session than the one before", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        history: [
          session("2026-08-11T09:00:00.000Z", ["joins"], ["querying"]),
          session("2026-08-10T09:00:00.000Z", ["basics"], ["foundations"]),
        ],
      }),
    );
    expect(scoreComponents(ctx, "joins", 30).momentum).toBe(1);
    expect(scoreComponents(ctx, "basics", 30).momentum).toBe(0.5);
    expect(scoreComponents(ctx, "windows", 30).momentum).toBe(0);
  });

  it("awards the interleaving bonus for switching area, not topic", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        history: [session("2026-08-11T09:00:00.000Z", ["joins"], ["querying"])],
      }),
    );
    // Same area as yesterday: no bonus. Different area: bonus.
    expect(scoreComponents(ctx, "joins", 30).interleavingBonus).toBe(0);
    expect(scoreComponents(ctx, "windows", 30).interleavingBonus).toBe(1);
  });

  it("awards no interleaving bonus when there is no prior session", () => {
    const ctx = buildContext(base);
    expect(scoreComponents(ctx, "joins", 30).interleavingBonus).toBe(0);
  });

  it("awards no interleaving bonus for a skill missing from the graph", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        history: [session("2026-08-11T09:00:00.000Z", ["joins"], ["querying"])],
      }),
    );
    expect(scoreComponents(ctx, "ghost", 30).interleavingBonus).toBe(0);
  });

  it("raises frustrationRisk after recent failures on the skill", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        attempts: [
          attempt("joins", "2026-08-10T09:00:00.000Z", false),
          attempt("joins", "2026-08-11T09:00:00.000Z", false),
        ],
      }),
    );
    expect(scoreComponents(ctx, "joins", 30).frustrationRisk).toBe(1);
  });

  it("raises frustrationRisk from failures on the prerequisites too", () => {
    const ctx = buildContext(
      plannerInput({
        ...base,
        attempts: [attempt("basics", "2026-08-10T09:00:00.000Z", false)],
      }),
    );
    expect(scoreComponents(ctx, "joins", 30).frustrationRisk).toBe(1);
  });

  it("scores frustrationRisk as 0 with no attempt history", () => {
    const ctx = buildContext(base);
    expect(scoreComponents(ctx, "joins", 30).frustrationRisk).toBe(0);
  });

  /**
   * PLAN-ADAPTATION step 3 — the tutor's reading of a conversation, worth half a
   * failed attempt and capped at two. §7.2 puts a model's impression at tier 5,
   * and tier 5 may make the system gentler but must never drive it alone.
   */
  describe("tutor signals", () => {
    it("raises the damper for a learner who said they were lost", () => {
      const ctx = buildContext(
        plannerInput({ ...base, stuckSignals: ["joins"] }),
      );
      expect(scoreComponents(ctx, "joins", 30).frustrationRisk).toBe(0.5);
    });

    it("cannot max the damper on chat alone", () => {
      const ctx = buildContext(
        plannerInput({
          ...base,
          stuckSignals: ["joins", "joins", "joins", "joins", "joins"],
        }),
      );
      // Five signals, two counted: 0.5 × 2 / 2. Never 1, which is what three
      // failed attempts say.
      expect(scoreComponents(ctx, "joins", 30).frustrationRisk).toBe(0.5);
    });

    it("counts for less than an actual failure", () => {
      const signalled = buildContext(
        plannerInput({ ...base, stuckSignals: ["joins", "joins"] }),
      );
      const failed = buildContext(
        plannerInput({
          ...base,
          attempts: [
            attempt("joins", "2026-08-10T09:00:00.000Z", false),
            attempt("joins", "2026-08-11T09:00:00.000Z", false),
          ],
        }),
      );

      expect(
        scoreComponents(signalled, "joins", 30).frustrationRisk,
      ).toBeLessThan(scoreComponents(failed, "joins", 30).frustrationRisk);
    });

    it("nudges a mixed record rather than overwhelming it", () => {
      const ctx = buildContext(
        plannerInput({
          ...base,
          attempts: [
            attempt("joins", "2026-08-10T09:00:00.000Z", true),
            attempt("joins", "2026-08-11T09:00:00.000Z", false),
          ],
          stuckSignals: ["joins"],
        }),
      );
      // (1 failure + 0.5) / (2 attempts + 1) = 0.5, against 0.5 without the
      // signal — the prerequisite attempt list is empty, so this is the skill's
      // own record moving.
      expect(scoreComponents(ctx, "joins", 30).frustrationRisk).toBe(0.5);
    });

    it("attaches to the skill it was raised on, not its neighbours", () => {
      const ctx = buildContext(
        plannerInput({ ...base, stuckSignals: ["basics"] }),
      );
      expect(scoreComponents(ctx, "joins", 30).frustrationRisk).toBe(0);
      expect(scoreComponents(ctx, "basics", 30).frustrationRisk).toBe(0.5);
    });

    it("changes nothing when there are none", () => {
      const withEmpty = buildContext(
        plannerInput({ ...base, stuckSignals: [] }),
      );
      const without = buildContext(plannerInput(base));

      expect(scoreComponents(withEmpty, "joins", 30)).toEqual(
        scoreComponents(without, "joins", 30),
      );
    });
  });

  it("penalises a poor time fit", () => {
    const ctx = buildContext(base);
    // estimatedHours 1.5 -> 30-minute natural block. A 30-minute evening fits.
    expect(scoreComponents(ctx, "joins", 30).timeFit).toBe(0);
    // A 5-minute window does not.
    expect(scoreComponents(ctx, "joins", 5).timeFit).toBe(1);
  });

  it("treats zero available minutes as the worst possible fit", () => {
    const ctx = buildContext(base);
    expect(scoreComponents(ctx, "joins", 0).timeFit).toBe(1);
  });

  it("treats an unknown skill as the worst possible fit", () => {
    const ctx = buildContext(base);
    expect(scoreComponents(ctx, "ghost", 30).timeFit).toBe(1);
  });

  it("fires the hard damper only when the last two attempts both failed", () => {
    const twoFailures = buildContext(
      plannerInput({
        ...base,
        attempts: [
          attempt("joins", "2026-08-10T09:00:00.000Z", false),
          attempt("joins", "2026-08-11T09:00:00.000Z", false),
        ],
      }),
    );
    expect(scoreComponents(twoFailures, "joins", 30).recentlyFailedTwice).toBe(1);

    const recovered = buildContext(
      plannerInput({
        ...base,
        attempts: [
          attempt("joins", "2026-08-10T09:00:00.000Z", false),
          attempt("joins", "2026-08-11T09:00:00.000Z", true),
        ],
      }),
    );
    expect(scoreComponents(recovered, "joins", 30).recentlyFailedTwice).toBe(0);

    const single = buildContext(
      plannerInput({
        ...base,
        attempts: [attempt("joins", "2026-08-10T09:00:00.000Z", false)],
      }),
    );
    expect(scoreComponents(single, "joins", 30).recentlyFailedTwice).toBe(0);
  });

  it("orders attempts by time regardless of the order supplied", () => {
    // "the last two attempts" must mean the same thing however the caller
    // happened to sort the array.
    const ctx = buildContext(
      plannerInput({
        ...base,
        attempts: [
          attempt("joins", "2026-08-11T09:00:00.000Z", true),
          attempt("joins", "2026-08-09T09:00:00.000Z", false),
          attempt("joins", "2026-08-10T09:00:00.000Z", false),
        ],
      }),
    );
    expect(scoreComponents(ctx, "joins", 30).recentlyFailedTwice).toBe(0);
  });
});

describe("totalScore", () => {
  it("applies the §16.1 weights", () => {
    const components = {
      goalCriticality: 1,
      masteryGap: 0,
      prereqReadiness: 0,
      retentionUrgency: 0,
      momentum: 0,
      interleavingBonus: 0,
      frustrationRisk: 0,
      timeFit: 0,
      recentlyFailedTwice: 0,
    };
    expect(totalScore(components)).toBe(WEIGHTS.goalCriticality);
  });

  it("subtracts the negative-weighted terms", () => {
    const components = {
      goalCriticality: 0,
      masteryGap: 0,
      prereqReadiness: 0,
      retentionUrgency: 0,
      momentum: 0,
      interleavingBonus: 0,
      frustrationRisk: 1,
      timeFit: 1,
      recentlyFailedTwice: 1,
    };
    expect(totalScore(components)).toBeCloseTo(
      WEIGHTS.frustrationRisk + WEIGHTS.timeFit + WEIGHTS.recentlyFailedTwice,
      10,
    );
  });

  it("rounds to 6dp so scores serialise identically across platforms", () => {
    const components = {
      goalCriticality: 1 / 3,
      masteryGap: 1 / 7,
      prereqReadiness: 1 / 9,
      retentionUrgency: 0,
      momentum: 0,
      interleavingBonus: 0,
      frustrationRisk: 0,
      timeFit: 0,
      recentlyFailedTwice: 0,
    };
    const score = totalScore(components);
    expect(score).toBe(Math.round(score * 1e6) / 1e6);
  });
});

describe("rankSkills", () => {
  it("breaks ties on skill id so repeat runs are byte-identical", () => {
    const input = plannerInput({
      graph: graph([
        skill("zebra", { area: "a" }),
        skill("alpha", { area: "a" }),
      ]),
      goalSkillIds: ["zebra", "alpha"],
    });
    const { ranked } = rankSkills(input);
    expect(ranked[0]!.score).toBe(ranked[1]!.score);
    expect(ranked.map((r) => r.skillId)).toEqual(["alpha", "zebra"]);
  });

  it("returns nothing when every skill is blocked or mastered", () => {
    const input = plannerInput({
      graph: graph(
        [skill("basics"), skill("joins")],
        [dependency("basics", "joins")],
      ),
      goalSkillIds: ["joins"],
      mastery: [mastery("basics", { mastery: 0.1 })],
    });
    const { ranked } = rankSkills(input);
    // `basics` is eligible; `joins` is gated behind it.
    expect(ranked.map((r) => r.skillId)).toEqual(["basics"]);
  });
});

describe("deadline override (§16.1 step 3)", () => {
  const bigGraph = graph(
    [
      skill("core", { estimatedHours: 20 }),
      skill("extra", { estimatedHours: 20 }),
    ],
    [dependency("extra", "core", "soft", 0.4)],
  );

  it("does not fire without a deadline", () => {
    const input = plannerInput({
      graph: bigGraph,
      goalSkillIds: ["core"],
      constraints: constraints({ deadline: null, weeklyHours: 1 }),
    });
    expect(rankSkills(input).compressionApplied).toBe(false);
  });

  it("does not fire when the learner has no stated capacity", () => {
    const input = plannerInput({
      graph: bigGraph,
      goalSkillIds: ["core"],
      constraints: constraints({ deadline: "2026-08-20", weeklyHours: 0 }),
    });
    expect(rankSkills(input).compressionApplied).toBe(false);
  });

  it("fires when projected work exceeds the time remaining", () => {
    const input = plannerInput({
      graph: bigGraph,
      goalSkillIds: ["core"],
      constraints: constraints({ deadline: "2026-08-20", weeklyHours: 2 }),
    });
    const result = rankSkills(input);
    expect(result.compressionApplied).toBe(true);
    // Only goal-essential skills survive; the rest are reported as dropped.
    expect(result.ranked.map((r) => r.skillId)).toEqual(["core"]);
    expect(result.droppedSkillIds).toEqual(["extra"]);
  });

  it("doubles goalCriticality when compressed", () => {
    const relaxed = rankSkills(
      plannerInput({
        graph: bigGraph,
        goalSkillIds: ["core"],
        constraints: constraints({ deadline: null, weeklyHours: 40 }),
      }),
    );
    const compressed = rankSkills(
      plannerInput({
        graph: bigGraph,
        goalSkillIds: ["core"],
        constraints: constraints({ deadline: "2026-08-20", weeklyHours: 2 }),
      }),
    );

    const relaxedCore = relaxed.ranked.find((r) => r.skillId === "core")!;
    const compressedCore = compressed.ranked.find((r) => r.skillId === "core")!;

    // A goal skill is already at criticality 1, and the component is clamped to
    // the unit interval, so doubling cannot push it past 1.
    expect(relaxedCore.components.goalCriticality).toBe(1);
    expect(compressedCore.components.goalCriticality).toBe(1);
    expect(DEADLINE_CRITICALITY_MULTIPLIER).toBe(2);
  });

  it("doubles a non-goal skill's criticality up to the clamp", () => {
    const chain = graph(
      [skill("root", { estimatedHours: 40 }), skill("goal", { estimatedHours: 1 })],
      [dependency("root", "goal")],
    );
    const input = plannerInput({
      graph: chain,
      goalSkillIds: ["goal"],
      constraints: constraints({ deadline: "2026-08-13", weeklyHours: 1 }),
    });
    const ctx = buildContext(input);
    const relaxed = scoreComponents(ctx, "root", 30, 1);
    const doubled = scoreComponents(ctx, "root", 30, 2);
    expect(relaxed.goalCriticality).toBe(0.5);
    expect(doubled.goalCriticality).toBe(1);
  });

  it("treats a deadline already in the past as behind schedule", () => {
    const input = plannerInput({
      graph: bigGraph,
      goalSkillIds: ["core"],
      constraints: constraints({ deadline: "2026-08-01", weeklyHours: 40 }),
    });
    expect(rankSkills(input).compressionApplied).toBe(true);
  });

  it("ignores an unparseable deadline rather than compressing wrongly", () => {
    const input = plannerInput({
      graph: bigGraph,
      goalSkillIds: ["core"],
      constraints: constraints({ deadline: "not-a-date", weeklyHours: 2 }),
    });
    expect(rankSkills(input).compressionApplied).toBe(false);
  });

  it("skips an eligible id missing from the graph when projecting work", () => {
    const input = plannerInput({
      graph: bigGraph,
      goalSkillIds: ["core"],
      constraints: constraints({ deadline: "2027-08-20", weeklyHours: 40 }),
    });
    const ctx = buildContext(input);
    expect(isBehindSchedule(input, ctx, ["core", "ghost"])).toBe(false);
  });
});
