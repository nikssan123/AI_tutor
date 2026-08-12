import { detectCycle } from "@/lib/engine/graph";
import type { EngineSkillGraph } from "@/lib/engine/types";
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
  };
}

/** §16.4 — production items must outnumber recognition items at least 2:1. */
export const MIN_PRODUCTION_TO_MCQ_RATIO = 2;

/** A pack with fewer items than this cannot support an adaptive diagnostic. */
export const MIN_ITEMS_PER_PACK = 20;

/** Below this, the diagnostic cannot place a learner on the skill at all. */
export const MIN_ITEMS_PER_SKILL = 1;

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

export function validatePack(pack: DomainPack): ValidationReport {
  const issues: ValidationIssue[] = [];
  const skillSlugs = new Set(pack.skills.map((s) => s.slug));

  // --- Uniqueness ----------------------------------------------------------
  for (const [label, values] of [
    ["skill", pack.skills.map((s) => s.slug)],
    ["item", pack.items.map((i) => i.slug)],
    ["rubric", pack.rubrics.map((r) => r.slug)],
    ["project", pack.projects.map((p) => p.slug)],
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
    itemsBySkill.set(item.skill, (itemsBySkill.get(item.skill) ?? 0) + 1);

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
        `skill "${slug}" has no assessment items, so the diagnostic cannot place a learner on it`,
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
