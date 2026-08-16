import { detectCycle } from "@/lib/engine/graph";
import { gradingModeFor } from "@/lib/engine/diagnostic";
import type { EngineItem, EngineSkillGraph } from "@/lib/engine/types";
import { expectedFor } from "@/lib/session/prove";
import { PRODUCTION_ITEM_TYPES, type DomainPack } from "./types";

/**
 * §24 E2 — the pack validator. This is the gate that makes "horizontal" mean
 * *declared depth* rather than *faked depth* (§7).
 *
 * It fails closed and it fails loudly: a cycle in the skill graph is a build
 * failure, not a warning, because the planner's eligibility filter would loop
 * or silently exclude everything downstream of it.
 */

export type Severity = "blocking" | "warning";

export interface ValidationIssue {
  check: string;
  severity: Severity;
  message: string;
}

export interface ValidationReport {
  packSlug: string;
  passed: boolean;
  issues: ValidationIssue[];
  stats: {
    skills: number;
    dependencies: number;
    items: number;
    productionItems: number;
    mcqItems: number;
    rubrics: number;
    projects: number;
    skillsWithoutItems: number;
    resources: number;
  };
}

/** §16.4 — production items must outnumber recognition items at least 2:1. */
export const MIN_PRODUCTION_TO_MCQ_RATIO = 2;

/** A pack with fewer items than this cannot support an adaptive diagnostic. */
export const MIN_ITEMS_PER_PACK = 20;

/** Below this, the diagnostic cannot place a learner on the skill at all. */
export const MIN_ITEMS_PER_SKILL = 1;

/**
 * The largest share of a pack's multiple-choice answers allowed to sit in any
 * one option position.
 *
 * **The defect this exists for.** Across the seven packs, the correct option
 * was never once in position A, and was in position B 76% of the time — 6 of 6
 * in both home cooking and personal finance. A learner who always picked B
 * scored 76% catalogue-wide knowing nothing, and 100% on two packs. Nothing
 * caught it: every item was individually correct, the options were plausible,
 * and position is not a property any single item has. It only exists in the
 * aggregate, which is exactly what a validator can see and a reviewer reading
 * items one at a time cannot.
 *
 * It matters more here than in an ordinary quiz because these scores are not
 * scores — they feed BKT, which feeds the planner and the mastery ledger. A
 * guesser being handed 76% is a guesser being credited with knowledge.
 *
 * Half is deliberately loose. With four to seven MCQs per pack, an even split
 * is not always reachable and demanding one would fail honest packs; the point
 * is to bound what a fixed-position guess is worth, not to enforce a shuffle.
 */
export const MAX_MCQ_ANSWER_POSITION_SHARE = 0.5;

/** Below this many MCQs, position share is noise rather than signal. */
export const MIN_MCQS_FOR_POSITION_CHECK = 4;

function issue(
  check: string,
  severity: Severity,
  message: string,
): ValidationIssue {
  return { check, severity, message };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

/** Converts a pack's skills and dependencies into the engine's graph shape. */
export function toEngineGraph(pack: DomainPack): EngineSkillGraph {
  return {
    skills: pack.skills.map((s) => ({
      id: s.slug,
      slug: s.slug,
      name: s.name,
      level: s.level,
      evalTier: s.evalTier,
      estimatedHours: s.estimatedHours,
      bktPriors: s.bktPriors,
      canDoStatement: s.canDoStatement,
      area: s.area,
    })),
    dependencies: pack.dependencies.map((d) => ({
      fromSkillId: d.from,
      toSkillId: d.to,
      type: d.type,
      strength: d.strength,
    })),
  };
}

/**
 * The pack's item bank, flattened for the planner.
 *
 * The engine is pure and knows nothing about packs, so `expected` is resolved
 * here — by `expectedFor`, which is the function the prove-it offer already
 * used to turn an item's `concepts` into something a grader can mark against.
 * Items whose skill is not in the graph are dropped rather than served against
 * a skill that does not exist; the validator rejects such a pack, so this is a
 * guard for a hand-edited one.
 */
export function toEngineItems(pack: DomainPack): EngineItem[] {
  const canDoBySlug = new Map(
    pack.skills.map((s) => [s.slug, s.canDoStatement]),
  );

  return pack.items.flatMap((item) => {
    const canDo = canDoBySlug.get(item.skill);
    return canDo === undefined
      ? []
      : [
          {
            itemId: item.slug,
            skillId: item.skill,
            type: item.type,
            prompt: item.prompt,
            expected: expectedFor(item, canDo),
            answerFormat: item.answerFormat,
            difficulty: item.difficulty,
          },
        ];
  });
}

export function validatePack(pack: DomainPack): ValidationReport {
  const issues: ValidationIssue[] = [];
  const skillSlugs = new Set(pack.skills.map((s) => s.slug));

  // --- Uniqueness ----------------------------------------------------------
  for (const [label, values] of [
    ["skill", pack.skills.map((s) => s.slug)],
    ["item", pack.items.map((i) => i.slug)],
    ["rubric", pack.rubrics.map((r) => r.slug)],
    ["project", pack.projects.map((p) => p.slug)],
    ["resource", pack.resources.map((r) => r.slug)],
  ] as const) {
    for (const duplicate of findDuplicates([...values])) {
      issues.push(
        issue(
          "unique_slugs",
          "blocking",
          `duplicate ${label} slug "${duplicate}"`,
        ),
      );
    }
  }

  // --- Dependency integrity ------------------------------------------------
  for (const dep of pack.dependencies) {
    if (!skillSlugs.has(dep.from)) {
      issues.push(
        issue(
          "no_hallucinated_skills",
          "blocking",
          `dependency references unknown prerequisite skill "${dep.from}"`,
        ),
      );
    }
    if (!skillSlugs.has(dep.to)) {
      issues.push(
        issue(
          "no_hallucinated_skills",
          "blocking",
          `dependency references unknown dependent skill "${dep.to}"`,
        ),
      );
    }
    if (dep.from === dep.to) {
      issues.push(
        issue(
          "no_self_dependency",
          "blocking",
          `skill "${dep.from}" depends on itself`,
        ),
      );
    }
  }

  const duplicateEdges = findDuplicates(
    pack.dependencies.map((d) => `${d.from}->${d.to}`),
  );
  for (const edge of duplicateEdges) {
    issues.push(
      issue("unique_edges", "blocking", `duplicate dependency edge ${edge}`),
    );
  }

  // --- Acyclicity ----------------------------------------------------------
  // §14.4: "A DAG, cycle-checked at pack build time; a cycle is a build failure."
  const cycle = detectCycle(toEngineGraph(pack));
  if (cycle.hasCycle) {
    issues.push(
      issue(
        "dag_acyclic",
        "blocking",
        `skill graph contains a cycle: ${cycle.cycle.join(" -> ")}`,
      ),
    );
  }

  // --- Item bank -----------------------------------------------------------
  const itemsBySkill = new Map<string, number>();
  for (const item of pack.items) {
    if (!skillSlugs.has(item.skill)) {
      issues.push(
        issue(
          "no_hallucinated_skills",
          "blocking",
          `item "${item.slug}" references unknown skill "${item.skill}"`,
        ),
      );
      continue;
    }
    // Only items the diagnostic can actually serve count towards coverage.
    // `micro_artifact` is `excluded` by `gradingModeFor` — it is work you hand
    // in, not a question you answer in ten minutes — so a skill whose entire
    // bank is micro_artifacts has items and is still unassessable, which is the
    // exact harm the message below describes. Counting every item made this
    // rule pass while its own sentence stayed true: four skills across the
    // shipped packs came back `not-assessed` for every learner, forever.
    if (gradingModeFor(item.type) !== "excluded") {
      itemsBySkill.set(item.skill, (itemsBySkill.get(item.skill) ?? 0) + 1);
    }

    if (item.type === "mcq" && (item.options?.length ?? 0) < 2) {
      issues.push(
        issue(
          "mcq_needs_options",
          "blocking",
          `multiple-choice item "${item.slug}" has fewer than two options`,
        ),
      );
    }
    if (item.type !== "mcq" && item.options !== undefined) {
      issues.push(
        issue(
          "options_only_on_mcq",
          "warning",
          `item "${item.slug}" is type "${item.type}" but carries options`,
        ),
      );
    }
  }

  const skillsWithoutItems = pack.skills
    .filter((s) => (itemsBySkill.get(s.slug) ?? 0) < MIN_ITEMS_PER_SKILL)
    .map((s) => s.slug);

  for (const slug of skillsWithoutItems) {
    // Not blocking: a Standard or Generated pack legitimately ships with gaps,
    // and §7.1 says depth is declared rather than faked. But a Curated pack
    // claiming "Deeply supported" with unassessable skills is a lie, so the
    // severity is raised below.
    issues.push(
      issue(
        "item_coverage",
        pack.maturity === "curated" ? "blocking" : "warning",
        `skill "${slug}" has no items the diagnostic can serve, so it cannot place a learner on it`,
      ),
    );
  }

  if (pack.items.length < MIN_ITEMS_PER_PACK) {
    issues.push(
      issue(
        "item_minimum",
        pack.maturity === "curated" ? "blocking" : "warning",
        `pack has ${pack.items.length} items; an adaptive diagnostic needs at least ${MIN_ITEMS_PER_PACK}`,
      ),
    );
  }

  // §16.4 — active recall over recognition, enforced at pack build time.
  const productionItems = pack.items.filter((i) =>
    PRODUCTION_ITEM_TYPES.includes(i.type),
  ).length;
  const mcqItems = pack.items.length - productionItems;
  if (mcqItems > 0 && productionItems / mcqItems < MIN_PRODUCTION_TO_MCQ_RATIO) {
    issues.push(
      issue(
        "recall_over_recognition",
        "blocking",
        `${productionItems} production items to ${mcqItems} multiple-choice; §16.4 requires at least ${MIN_PRODUCTION_TO_MCQ_RATIO}:1`,
      ),
    );
  }

  // §16.4 again, from the other side: recognition items must not be gameable by
  // position. See MAX_MCQ_ANSWER_POSITION_SHARE for what this caught.
  const scored = pack.items
    .filter((i) => i.type === "mcq")
    // An MCQ with no answer key at all is caught by its own check; here it is
    // simply not a position, rather than a crash.
    .map((i) => ({
      correct: (i.answerKey as { correct?: unknown } | undefined)?.correct,
      options: i.options?.length ?? 0,
    }))
    .filter((i): i is { correct: number; options: number } =>
      typeof i.correct === "number",
    );

  if (scored.length >= MIN_MCQS_FOR_POSITION_CHECK) {
    const perPosition = new Map<number, number>();
    for (const { correct } of scored) {
      perPosition.set(correct, (perPosition.get(correct) ?? 0) + 1);
    }
    const [topPosition, topCount] = [...perPosition].reduce((a, b) =>
      b[1] > a[1] ? b : a,
    );
    const share = topCount / scored.length;

    /*
     * The limit, or the best any arrangement could possibly do — whichever is
     * looser. **The flat half was sometimes arithmetically unsatisfiable.**
     *
     * Spreading `n` answers over `k` positions cannot get the busiest one below
     * `ceil(n / k) / n`. With three or more options that is always at or under
     * a half, so this changes nothing for any ordinary bank. With two — a
     * true/false item, which the schema permits — and an odd count, the floor
     * is above a half: five of them can only ever be 3–2, which is 60%. The old
     * rule failed that pack, and would have failed every rewrite of it, because
     * no arrangement of five two-way answers exists that satisfies it. A gate
     * nothing can pass is a gate that only spends money.
     *
     * So the rule is unchanged wherever it is achievable, and where it is not,
     * it asks for the best there is. `balanceAnswerPositions` produces exactly
     * that, which is what lets `meetsQualityFloor` keep claiming assembly
     * satisfies every blocking rule.
     */
    const widest = Math.max(...scored.map((i) => i.options), 1);
    const achievable = Math.ceil(scored.length / widest) / scored.length;
    const limit = Math.max(MAX_MCQ_ANSWER_POSITION_SHARE, achievable);

    if (share > limit) {
      issues.push(
        issue(
          "mcq_answer_position",
          "blocking",
          `${topCount} of ${scored.length} multiple-choice answers sit in option ${topPosition + 1} (${Math.round(share * 100)}%); always guessing it would score that much. Limit is ${Math.round(limit * 100)}%`,
        ),
      );
    }
  }

  // --- Rubrics -------------------------------------------------------------
  const rubricSlugs = new Set(pack.rubrics.map((r) => r.slug));
  for (const rubric of pack.rubrics) {
    const duplicateCriteria = findDuplicates(rubric.criteria.map((c) => c.id));
    for (const id of duplicateCriteria) {
      issues.push(
        issue(
          "unique_criteria",
          "blocking",
          `rubric "${rubric.slug}" has duplicate criterion id "${id}"`,
        ),
      );
    }

    const weight = rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
    if (Math.abs(weight - 1) > 0.001) {
      issues.push(
        issue(
          "rubric_weights",
          "blocking",
          `rubric "${rubric.slug}" criterion weights sum to ${weight.toFixed(3)}, not 1`,
        ),
      );
    }
  }

  // --- Projects ------------------------------------------------------------
  for (const project of pack.projects) {
    if (!rubricSlugs.has(project.rubric)) {
      issues.push(
        issue(
          "rubric_coverage",
          "blocking",
          `project "${project.slug}" references unknown rubric "${project.rubric}"`,
        ),
      );
    }
    for (const skill of project.targetSkills) {
      if (!skillSlugs.has(skill)) {
        issues.push(
          issue(
            "no_hallucinated_skills",
            "blocking",
            `project "${project.slug}" targets unknown skill "${skill}"`,
          ),
        );
      }
    }
  }

  // --- Resources -----------------------------------------------------------
  for (const resource of pack.resources) {
    for (const covered of resource.skills) {
      if (!skillSlugs.has(covered)) {
        issues.push(
          issue(
            "no_hallucinated_skills",
            "blocking",
            `resource "${resource.slug}" covers unknown skill "${covered}"`,
          ),
        );
      }
    }

    /*
     * A warning, not a block. The checker's finding is that the link did not
     * resolve *when it looked*, which is a reason to stop recommending the page
     * and not a reason to refuse to load the pack — the rest of it still
     * teaches. Assembly drops these before a generated pack is ever written, so
     * a warning here means a link died after authoring, which is exactly the
     * thing a re-check is supposed to surface rather than fail on.
     */
    if (!resource.reachable) {
      issues.push(
        issue(
          "resource_reachable",
          "warning",
          `resource "${resource.slug}" did not resolve when last checked${
            resource.checkedAt ? ` (${resource.checkedAt.slice(0, 10)})` : ""
          }`,
        ),
      );
    }
  }

  for (const url of findDuplicates(pack.resources.map((r) => r.url))) {
    issues.push(
      issue("unique_resources", "warning", `two resources cite ${url}`),
    );
  }

  // §7.2 — a pack whose tier claims machine verification needs something to
  // machine-verify against.
  if (pack.evalTier === 1 && pack.projects.length === 0) {
    issues.push(
      issue(
        "tier_1_needs_projects",
        "warning",
        "pack declares Tier 1 (machine-verifiable) but ships no projects to verify",
      ),
    );
  }

  return {
    packSlug: pack.slug,
    passed: issues.every((i) => i.severity !== "blocking"),
    issues,
    stats: {
      skills: pack.skills.length,
      dependencies: pack.dependencies.length,
      items: pack.items.length,
      productionItems,
      mcqItems,
      rubrics: pack.rubrics.length,
      projects: pack.projects.length,
      skillsWithoutItems: skillsWithoutItems.length,
      resources: pack.resources.length,
    },
  };
}

export class PackValidationError extends Error {
  constructor(public readonly report: ValidationReport) {
    const blocking = report.issues.filter((i) => i.severity === "blocking");
    super(
      `Pack "${report.packSlug}" failed validation with ${blocking.length} blocking issue(s):\n` +
        blocking.map((i) => `  [${i.check}] ${i.message}`).join("\n"),
    );
    this.name = "PackValidationError";
  }
}

/** Throws unless the pack passes. Used by the seeder and the CI gate. */
export function assertValid(pack: DomainPack): ValidationReport {
  const report = validatePack(pack);
  if (!report.passed) throw new PackValidationError(report);
  return report;
}
