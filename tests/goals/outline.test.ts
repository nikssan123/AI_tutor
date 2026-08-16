import { describe, expect, it } from "vitest";
import { buildOutline } from "@/lib/goals/outline";
import { projectSkills } from "@/lib/goals/projection";
import type { CurriculumModule } from "@/lib/contracts/curriculum";
import type {
  EngineDependency,
  EngineSkill,
  EngineSkillGraph,
  MasteryState,
} from "@/lib/engine";

/**
 * The outline is the screen's whole claim: *everything is here, and the things
 * you can't start yet say why*. Both halves are asserted, because both are
 * sentences a learner reads and neither is recoverable from a render test.
 *
 * The states themselves are not re-derived here — §16.1's eligibility filter
 * and the projection own them, and they have their own tests. What is tested is
 * that the outline says the same thing they do, in words.
 */

const NOW = "2026-08-13T09:00:00.000Z";
const priors = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.25 };

function skill(id: string, overrides: Partial<EngineSkill> = {}): EngineSkill {
  return {
    id,
    slug: id,
    name: id,
    level: "core",
    evalTier: 1,
    estimatedHours: 4,
    bktPriors: priors,
    canDoStatement: `Do ${id} correctly`,
    area: "queries",
    ...overrides,
  };
}

function hard(from: string, to: string): EngineDependency {
  return { fromSkillId: from, toSkillId: to, type: "hard", strength: 1 };
}

function proved(skillId: string): MasteryState {
  return {
    skillId,
    mastery: 0.95,
    confidence: 0.8,
    evidenceCount: 3,
    lastSuccessAt: NOW,
    lastPracticedAt: NOW,
    decayHalfLifeDays: 180,
  };
}

/**
 * A shape with one of everything: a skill with no prerequisites, a chain, a
 * skill gated on *two* things at once, and a specialist that is both out of
 * scope and unreachable.
 */
const graph = (): EngineSkillGraph => ({
  skills: [
    skill("basics", {
      name: "Basics",
      level: "foundational",
      area: "foundations",
      estimatedHours: 2,
      canDoStatement: "Read a table without guessing",
    }),
    skill("joins", { name: "Joins", estimatedHours: 4 }),
    skill("windows", { name: "Windows", level: "advanced", estimatedHours: 8 }),
    skill("report", {
      name: "The report",
      level: "advanced",
      estimatedHours: 6,
    }),
    skill("tuning", {
      name: "Tuning",
      level: "specialist",
      area: "query-tuning",
      estimatedHours: 16,
    }),
  ],
  dependencies: [
    hard("basics", "joins"),
    hard("joins", "windows"),
    hard("joins", "report"),
    hard("windows", "report"),
    hard("windows", "tuning"),
  ],
});

function outlineFor(mastery: MasteryState[] = [], modules?: CurriculumModule[]) {
  const g = graph();
  return buildOutline({
    graph: g,
    mastery,
    now: NOW,
    projection: projectSkills({ graph: g, mastery, now: NOW }),
    modules,
  });
}

function skillNamed(
  outline: ReturnType<typeof outlineFor>,
  name: string,
) {
  return outline.sections.flatMap((s) => s.skills).find((s) => s.name === name)!;
}

describe("buildOutline without a generated curriculum", () => {
  /**
   * The state most goals are in most of the time: generation is a model call
   * the learner has to ask for. The screen used to answer it with a button.
   */
  it("lays the subject out by area, in the order the skills are met", () => {
    const outline = outlineFor();

    expect(outline.sections.map((s) => s.title)).toEqual([
      "Foundations",
      "Queries",
      "Query tuning",
    ]);
    expect(outline.sections.flatMap((s) => s.skills).map((s) => s.name)).toEqual(
      ["Basics", "Joins", "Windows", "The report", "Tuning"],
    );
  });

  it("holds every skill in the graph exactly once", () => {
    const ids = outlineFor()
      .sections.flatMap((s) => s.skills)
      .map((s) => s.skillId);

    expect(new Set(ids).size).toBe(5);
  });

  /** The sentence that replaces a grey rectangle nobody can interrogate. */
  it("names what a locked skill is waiting for", () => {
    const outline = outlineFor();

    expect(skillNamed(outline, "Joins").state).toBe("locked");
    expect(skillNamed(outline, "Joins").note).toBe(
      "Unlocks once you've done Basics.",
    );
  });

  it("names every blocker when more than one is in the way", () => {
    expect(skillNamed(outlineFor(), "The report").note).toBe(
      "Unlocks once you've done Joins and Windows.",
    );
  });

  /**
   * The sentence says the thing the row could not otherwise say, and no more.
   * It used to open "Open to you now —", which is four words repeating the
   * label printed beside it.
   */
  it("says what an open skill will get you, without repeating its own label", () => {
    const basics = skillNamed(outlineFor(), "Basics");

    expect(basics.state).toBe("open");
    expect(basics.note).toBe("You'll be able to read a table without guessing.");
  });

  /**
   * A specialist skill behind an unmet prerequisite is locked *and* out of
   * scope. Answering "why can't I do this" with the lock would be answering
   * the wrong question — the reason is the depth, which is a dial they can
   * move, and the lock is downstream of a decision they never made.
   */
  it("calls an out-of-scope skill optional rather than locked", () => {
    const tuning = skillNamed(outlineFor(), "Tuning");

    expect(tuning.state).toBe("optional");
    expect(tuning.note).toBe(
      "Not in your course at this depth — still yours to take on.",
    );
  });

  it("takes each section's state from the most actionable thing in it", () => {
    expect(outlineFor().sections.map((s) => s.state)).toEqual([
      "open",
      "locked",
      "optional",
    ]);
  });

  it("opens exactly one section — the first with work in it", () => {
    const outline = outlineFor();

    expect(outline.sections.filter((s) => s.current).map((s) => s.title)).toEqual(
      ["Foundations"],
    );
  });

  /** Nothing left to do is not a reason to shout. */
  it("opens nothing when every skill is already proved", () => {
    const outline = outlineFor(
      ["basics", "joins", "windows", "report", "tuning"].map(proved),
    );

    expect(outline.sections.some((s) => s.current)).toBe(false);
    expect(outline.sections.map((s) => s.state)).toEqual([
      "proved",
      "proved",
      "proved",
    ]);
  });

  it("says what a proved skill proved", () => {
    const basics = skillNamed(outlineFor([proved("basics")]), "Basics");

    expect(basics.state).toBe("proved");
    expect(basics.note).toBe(
      "You already showed you can read a table without guessing.",
    );
  });

  it("counts every skill under one state", () => {
    expect(outlineFor().counts).toEqual({
      open: 1,
      locked: 3,
      proved: 0,
      optional: 1,
    });
  });

  /**
   * The hours are `remainingHoursFor`, the same figure the page header totals.
   * Quoting the pack's own estimate instead would put a number on the row that
   * contradicts the number at the top of the screen.
   */
  it("prices a section against what the learner already has", () => {
    const full = outlineFor();
    expect(full.sections.map((s) => s.hours)).toEqual([2, 18, 16]);

    const partial = outlineFor([proved("basics")]);
    // Proved, so nothing is owed on it — and the section drops to zero rather
    // than quoting the two hours it would have cost someone else.
    expect(partial.sections[0]!.hours).toBe(0);
    expect(skillNamed(partial, "Basics").hours).toBe(0);
  });
});

describe("buildOutline with a generated curriculum", () => {
  const modules: CurriculumModule[] = [
    {
      order: 1,
      title: "Joining tables",
      targetSkillIds: ["joins"],
      estimatedHours: 4,
      outputArtifact: "project",
      acceptanceCriteria: [],
      rubricId: null,
    },
    {
      order: 0,
      title: "Getting started",
      targetSkillIds: ["basics"],
      estimatedHours: 2,
      outputArtifact: "exercise",
      acceptanceCriteria: [],
      rubricId: null,
    },
    {
      order: 2,
      title: "A module about a skill the pack no longer has",
      targetSkillIds: ["removed-in-a-later-pack-version"],
      estimatedHours: 1,
      outputArtifact: "none",
      acceptanceCriteria: [],
      rubricId: null,
    },
  ];

  const outline = () => outlineFor([proved("report")], modules);

  it("follows the modules, in their own order", () => {
    expect(outline().sections.slice(0, 2).map((s) => s.title)).toEqual([
      "Getting started",
      "Joining tables",
    ]);
  });

  /**
   * A stored curriculum outlives the pack it was written against. A skill that
   * has since left the graph is dropped, and a module left with nothing goes
   * with it — the alternative is a section titled after work that no longer
   * exists.
   */
  it("drops a module skill the pack no longer has, and the empty module with it", () => {
    expect(outline().sections.map((s) => s.title)).not.toContain(
      "A module about a skill the pack no longer has",
    );
  });

  /**
   * §14.6's generated curriculum only covers what is left to do, so without
   * the trailing sections the outline would silently lose every skill the
   * learner has already proved — the half of the screen §8 is most insistent
   * about.
   */
  it("keeps the skills no module mentions, sorted by what they are", () => {
    const trailing = outline().sections.slice(2);

    expect(trailing.map((s) => s.title)).toEqual([
      "Already yours",
      "Also on your path",
      "Not in your course",
    ]);
    expect(trailing.map((s) => s.skills.map((k) => k.name))).toEqual([
      ["The report"],
      ["Windows"],
      ["Tuning"],
    ]);
  });

  it("puts a hand-in on a module that ends in graded work, and only there", () => {
    const [started, joining] = outline().sections;

    expect(started!.handIn).toBeNull();
    expect(joining!.handIn).toBe(
      "Ends with a project you hand in, and we mark it",
    );
  });

  it("still opens the first section with work in it", () => {
    expect(outline().sections.filter((s) => s.current).map((s) => s.title)).toEqual(
      ["Getting started"],
    );
  });
});
