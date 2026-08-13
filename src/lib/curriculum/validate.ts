import { effectiveMastery } from "@/lib/engine/bkt";
import { buildIndex, prerequisitesOf } from "@/lib/engine/graph";
import { HARD_PREREQ_THRESHOLD } from "@/lib/engine/scoring";
import type {
  EngineSkill,
  EngineSkillGraph,
  MasteryState,
  SkillLevel,
} from "@/lib/engine";
import {
  ALL_CHECKS,
  type CheckName,
  type CurriculumDraft,
  type ValidatorCheck,
  type ValidatorReport,
} from "@/lib/contracts/curriculum";

/**
 * §14.6 — the Curriculum Validator, "the anti-mediocrity gate".
 *
 * Nine checks, run on every generated curriculum before the learner sees it.
 * Eight of them are pure code and live here; only the factual spot-check needs
 * a model, and it is injected (see `runValidator` below) so the expensive,
 * non-deterministic part cannot quietly become a dependency of the cheap,
 * deterministic part.
 *
 * **It fails closed.** A generated curriculum is guilty until checked: the
 * report says which checks failed, at what severity, and — where the plan
 * defines a fail action that is mechanical rather than a judgement call —
 * carries the repair to apply. That is what stops the LLM's output being the
 * final word on what someone spends the next three months learning.
 */

/**
 * §14.6 — "no module targets a skill with mastery > 0.8".
 *
 * Deliberately *not* the planner's `MASTERY_TARGET` of 0.85. They answer
 * different questions: 0.85 is "is this skill finished?", and 0.8 is "is
 * putting this on a curriculum going to waste someone's time?". The second bar
 * is lower because a module is hours of work, not one session.
 */
export const CURRICULUM_MASTERED_THRESHOLD = 0.8;

/** §14.6 — "total hours within ±25% of (available hours × weeks to deadline)". */
export const LENGTH_TOLERANCE = 0.25;

/** §14.6 — "pairwise similarity between module objectives < 0.85". */
export const REDUNDANCY_THRESHOLD = 0.85;

/** §14.6 — "no >2-level jumps" on the difficulty ramp. */
export const MAX_LEVEL_JUMP = 2;

/** §14.6 — "every project module has a rubric with ≥4 criteria". */
export const MIN_RUBRIC_CRITERIA = 4;

const LEVEL_RANK: Record<SkillLevel, number> = {
  foundational: 0,
  core: 1,
  advanced: 2,
  specialist: 3,
};

export interface CitedResource {
  url: string;
  /** ISO-8601 publication date, or null when the source does not state one. */
  publishedAt: string | null;
  /** Whether the URL currently resolves. Checked by the caller, not here. */
  reachable: boolean;
}

export interface ValidationInput {
  draft: CurriculumDraft;
  graph: EngineSkillGraph;
  mastery: MasteryState[];
  /** ISO-8601. Injected, never read from the clock. */
  now: string;
  constraints: { weeklyHours: number; deadline: string | null };
  /** Criterion count per rubric id, from the pack. */
  rubricCriteria: Map<string, number>;
  /** Resources the curriculum cites. Empty until the Resource Researcher runs. */
  resources?: CitedResource[];
}

function check(
  name: CheckName,
  passed: boolean,
  severity: ValidatorCheck["severity"],
  detail: string,
  repair: unknown = null,
): ValidatorCheck {
  return { name, passed, severity, detail, repair };
}

/* ── 1. Prerequisite completeness ──────────────────────────────────────── */

function prereqCompleteness(
  input: ValidationInput,
  effective: Map<string, number>,
): ValidatorCheck {
  const index = buildIndex(input.graph);
  const ordered = [...input.draft.modules].sort((a, b) => a.order - b.order);

  const covered = new Set<string>();
  const missing: Array<{ order: number; skillId: string; needs: string }> = [];

  for (const mod of ordered) {
    // A module's own skills count as covered for that module. §14.4 lets a
    // module target up to three skills, and bundling a skill with its
    // prerequisite is the most natural use of that — teaching them together is
    // what the bundle means. The strict reading (only *earlier* modules count)
    // would reject that and quietly push the architect towards one skill per
    // module, which is not what the contract says.
    for (const skillId of mod.targetSkillIds) covered.add(skillId);

    for (const skillId of mod.targetSkillIds) {
      for (const edge of prerequisitesOf(index, skillId, "hard")) {
        const met =
          covered.has(edge.fromSkillId) ||
          (effective.get(edge.fromSkillId) ?? 0) >= HARD_PREREQ_THRESHOLD;
        if (!met) {
          missing.push({
            order: mod.order,
            skillId,
            needs: edge.fromSkillId,
          });
        }
      }
    }
  }

  return check(
    "prereq_completeness",
    missing.length === 0,
    "blocking",
    missing.length === 0
      ? "Every module's hard prerequisites are earlier in the path or already held."
      : `${missing.length} module skill(s) start before a hard prerequisite: ${missing
          .map((m) => `${m.skillId} needs ${m.needs}`)
          .join("; ")}`,
    // §14.6's fail action is "insert the missing prerequisite", which is
    // mechanical — the graph says exactly which skill and where.
    missing.length === 0 ? null : { insert: missing },
  );
}

/* ── 2. No hallucinated skills ─────────────────────────────────────────── */

function noHallucinatedSkills(
  input: ValidationInput,
  skills: Map<string, EngineSkill>,
): ValidatorCheck {
  const unknown: string[] = [];
  for (const mod of input.draft.modules) {
    for (const skillId of mod.targetSkillIds) {
      if (!skills.has(skillId)) unknown.push(skillId);
    }
  }

  return check(
    "no_hallucinated_skills",
    unknown.length === 0,
    "blocking",
    unknown.length === 0
      ? "Every targeted skill exists in the pack graph."
      : `Curriculum names ${unknown.length} skill(s) that do not exist: ${[...new Set(unknown)].join(", ")}`,
    // No repair: §14.6's fail action is "regenerate". A skill the model
    // invented cannot be patched into existence.
    null,
  );
}

/* ── 3. No redundancy ──────────────────────────────────────────────────── */

/**
 * **Deviation from §14.6, flagged rather than hidden.** The plan specifies
 * "pairwise embedding similarity between module objectives < 0.85". There is no
 * embedding provider wired into this product, and adding one to compare at most
 * 40 short strings would be a dependency bought for a rounding error.
 *
 * This is lexical cosine over token frequencies instead. It catches what the
 * check exists to catch — the same module emitted twice under two titles, which
 * is §24 E6's own acceptance case ("duplicate modules") — and it will miss two
 * genuinely paraphrased objectives that share no vocabulary. When embeddings
 * arrive for the resource work, this is the first caller to switch over.
 */
export function lexicalSimilarity(a: string, b: string): number {
  const vector = (text: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const token of text.toLowerCase().split(/[^a-z0-9]+/i)) {
      if (token.length === 0) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return counts;
  };

  const va = vector(a);
  const vb = vector(b);

  let dot = 0;
  for (const [token, count] of va) dot += count * (vb.get(token) ?? 0);
  if (dot === 0) return 0;

  const norm = (v: Map<string, number>) =>
    Math.sqrt([...v.values()].reduce((sum, c) => sum + c * c, 0));

  // Clamped: cosine of a vector with itself is 1 in algebra and 1.0000000000000002
  // in floating point, and a "similarity" above 1 would be nonsense on a report
  // someone reads.
  return Math.min(dot / (norm(va) * norm(vb)), 1);
}

function objectiveOf(mod: CurriculumDraft["modules"][number]): string {
  return [mod.title, ...mod.acceptanceCriteria].join(" ");
}

function noRedundancy(input: ValidationInput): ValidatorCheck {
  const modules = input.draft.modules;
  const pairs: Array<{ a: number; b: number; similarity: number }> = [];

  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const similarity = lexicalSimilarity(
        objectiveOf(modules[i]!),
        objectiveOf(modules[j]!),
      );
      if (similarity >= REDUNDANCY_THRESHOLD) {
        pairs.push({ a: modules[i]!.order, b: modules[j]!.order, similarity });
      }
    }
  }

  return check(
    "no_redundancy",
    pairs.length === 0,
    "warning",
    pairs.length === 0
      ? "No two modules cover the same ground."
      : `${pairs.length} module pair(s) are near-duplicates: ${pairs
          .map((p) => `${p.a}↔${p.b} (${p.similarity.toFixed(2)})`)
          .join(", ")}`,
    pairs.length === 0 ? null : { merge: pairs },
  );
}

/* ── 4. Length sanity ──────────────────────────────────────────────────── */

function lengthSanity(input: ValidationInput): ValidatorCheck {
  const { deadline, weeklyHours } = input.constraints;

  if (!deadline) {
    // Without a deadline there is no budget to be within ±25% of. Reported as
    // passing with the reason, rather than silently skipped — §24 E6 requires
    // all nine checks to appear in the report.
    return check(
      "length_sanity",
      true,
      "warning",
      "No deadline set, so there is no hours budget to check against.",
    );
  }

  const weeks =
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(input.now)) /
    (7 * 86_400_000);
  const available = Math.max(weeks, 0) * weeklyHours;
  const total = input.draft.totalHours;

  const withinBudget =
    available > 0 &&
    total >= available * (1 - LENGTH_TOLERANCE) &&
    total <= available * (1 + LENGTH_TOLERANCE);

  return check(
    "length_sanity",
    withinBudget,
    "warning",
    withinBudget
      ? `${total}h fits the ${available.toFixed(1)}h available before ${deadline}.`
      : `${total}h against ${available.toFixed(1)}h available before ${deadline} — outside the ±25% band.`,
    // §14.6: "rescope; tell the user honestly". The number they need told is
    // what actually fits, so the repair carries it.
    withinBudget ? null : { targetHours: Math.round(available * 10) / 10 },
  );
}

/* ── 5. Difficulty ramp ────────────────────────────────────────────────── */

function difficultyRamp(
  input: ValidationInput,
  skills: Map<string, EngineSkill>,
): ValidatorCheck {
  const ordered = [...input.draft.modules].sort((a, b) => a.order - b.order);

  const rankOf = (mod: (typeof ordered)[number]): number =>
    mod.targetSkillIds.reduce((max, id) => {
      const skill = skills.get(id);
      return skill ? Math.max(max, LEVEL_RANK[skill.level]) : max;
    }, 0);

  const problems: string[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = rankOf(ordered[i - 1]!);
    const current = rankOf(ordered[i]!);

    if (current < previous) {
      problems.push(
        `module ${ordered[i]!.order} steps back down from ${previous} to ${current}`,
      );
    } else if (current - previous > MAX_LEVEL_JUMP) {
      problems.push(
        `module ${ordered[i]!.order} jumps ${current - previous} levels`,
      );
    }
  }

  return check(
    "difficulty_ramp",
    problems.length === 0,
    "warning",
    problems.length === 0
      ? "Difficulty rises without stepping back or jumping more than two levels."
      : problems.join("; "),
    problems.length === 0
      ? null
      : { reorder: ordered.map((m) => m.order) },
  );
}

/* ── 6. Nothing already mastered ───────────────────────────────────────── */

function noAlreadyMastered(
  input: ValidationInput,
  effective: Map<string, number>,
): ValidatorCheck {
  const wasted: Array<{ order: number; skillId: string; mastery: number }> = [];

  for (const mod of input.draft.modules) {
    for (const skillId of mod.targetSkillIds) {
      const value = effective.get(skillId);
      if (value !== undefined && value > CURRICULUM_MASTERED_THRESHOLD) {
        wasted.push({ order: mod.order, skillId, mastery: value });
      }
    }
  }

  return check(
    "no_already_mastered",
    wasted.length === 0,
    // Blocking, though §14.6 does not assign severities. "Don't waste my time
    // learning what I already know" is §8's stated promise and the reason the
    // diagnostic exists; a curriculum that breaks it is not a warning.
    "blocking",
    wasted.length === 0
      ? "No module teaches something the learner has already demonstrated."
      : `${wasted.length} module skill(s) are already held: ${wasted
          .map((w) => `${w.skillId} (${w.mastery.toFixed(2)})`)
          .join(", ")}`,
    // §14.6: "drop it, and *show* the user it was dropped" — so the repair
    // carries what to drop, and the drop is surfaced, never silent.
    wasted.length === 0 ? null : { drop: wasted },
  );
}

/* ── 7. Resource freshness ─────────────────────────────────────────────── */

/** §14.6 — "published within 24 months" for fast-moving domains. */
export const RESOURCE_MAX_AGE_MONTHS = 24;

function resourceFreshness(input: ValidationInput): ValidatorCheck {
  const resources = input.resources ?? [];

  if (resources.length === 0) {
    return check(
      "resource_freshness",
      true,
      "warning",
      "No resources cited yet — the Resource Researcher has not run.",
    );
  }

  const cutoff =
    Date.parse(input.now) - RESOURCE_MAX_AGE_MONTHS * 30.44 * 86_400_000;

  const stale = resources.filter(
    (r) =>
      !r.reachable ||
      (r.publishedAt !== null && Date.parse(r.publishedAt) < cutoff),
  );

  return check(
    "resource_freshness",
    stale.length === 0,
    "warning",
    stale.length === 0
      ? `All ${resources.length} cited resources resolve and are current.`
      : `${stale.length} of ${resources.length} cited resources are unreachable or over ${RESOURCE_MAX_AGE_MONTHS} months old.`,
    stale.length === 0 ? null : { replace: stale.map((r) => r.url) },
  );
}

/* ── 8. Rubric coverage ────────────────────────────────────────────────── */

function rubricCoverage(input: ValidationInput): ValidatorCheck {
  const uncovered: Array<{ order: number; reason: string }> = [];

  for (const mod of input.draft.modules) {
    if (mod.outputArtifact !== "project") continue;

    if (mod.rubricId === null) {
      uncovered.push({ order: mod.order, reason: "no rubric" });
      continue;
    }

    const criteria = input.rubricCriteria.get(mod.rubricId);
    if (criteria === undefined) {
      uncovered.push({ order: mod.order, reason: "rubric does not exist" });
    } else if (criteria < MIN_RUBRIC_CRITERIA) {
      uncovered.push({
        order: mod.order,
        reason: `rubric has ${criteria} criteria, needs ${MIN_RUBRIC_CRITERIA}`,
      });
    }
  }

  return check(
    "rubric_coverage",
    uncovered.length === 0,
    // Blocking: §4.2 law 2 is that the bar is published before the work starts.
    // A project module with no rubric asks for work nobody can grade.
    "blocking",
    uncovered.length === 0
      ? "Every project module has a rubric with at least four criteria."
      : uncovered.map((u) => `module ${u.order}: ${u.reason}`).join("; "),
    uncovered.length === 0 ? null : { generateRubricFor: uncovered },
  );
}

/* ── The report ────────────────────────────────────────────────────────── */

/** The ninth check needs a model; it is injected so the other eight stay pure. */
export type SpotChecker = (
  input: ValidationInput,
) => Promise<Pick<ValidatorCheck, "passed" | "detail">>;

/**
 * The eight deterministic checks. Pure, instant, free, and identical on every
 * run — which is what lets them gate a model's output rather than the reverse.
 */
export function validateDeterministic(
  input: ValidationInput,
): ValidatorCheck[] {
  const skills = new Map(input.graph.skills.map((s) => [s.id, s]));
  const effective = new Map(
    input.mastery.map((m) => [m.skillId, effectiveMastery(m, input.now)]),
  );

  return [
    prereqCompleteness(input, effective),
    noHallucinatedSkills(input, skills),
    noRedundancy(input),
    lengthSanity(input),
    difficultyRamp(input, skills),
    noAlreadyMastered(input, effective),
    resourceFreshness(input),
    rubricCoverage(input),
  ];
}

/**
 * The full nine-check report.
 *
 * The order of the returned checks is `ALL_CHECKS`, always — a caller reading
 * the report should not have to care which checks happened to run, and the
 * assembly below makes a missing one impossible rather than unlikely.
 */
export async function runValidator(
  input: ValidationInput,
  spotCheck: SpotChecker,
): Promise<ValidatorReport> {
  const spot = await spotCheck(input);

  const byName = new Map<CheckName, ValidatorCheck>(
    [
      ...validateDeterministic(input),
      // §14.6's fail action is the human review queue, not a repair: a factual
      // error is exactly the thing a model should not be trusted to fix on the
      // second attempt after missing it on the first.
      check("factual_spotcheck", spot.passed, "warning", spot.detail),
    ].map((c) => [c.name, c]),
  );

  const checks = ALL_CHECKS.map((name) => byName.get(name)!);

  return {
    passed: checks.every((c) => c.passed || c.severity === "warning"),
    checks,
  };
}
