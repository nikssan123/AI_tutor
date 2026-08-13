import type { EngineSkillGraph } from "@/lib/engine";
import type {
  CurriculumDraft,
  CurriculumModule,
  ValidatorReport,
} from "@/lib/contracts/curriculum";

/**
 * §14.6's fail actions, applied.
 *
 * Only the mechanical ones. "Insert the missing prerequisite" and "drop it" are
 * decisions the graph and the mastery state have already made — there is
 * nothing left to judge, so a model would only add latency and a chance to get
 * it wrong. "Regenerate", "rescope" and the human review queue are the other
 * kind, and they stay with the caller.
 *
 * Every repair is a pure function of (draft, report, graph), so the same failed
 * curriculum always repairs the same way.
 */

export interface RepairOutcome {
  draft: CurriculumDraft;
  /** What was changed, in the learner's language — §14.6 wants drops *shown*. */
  applied: string[];
}

type Missing = { order: number; skillId: string; needs: string };
type Wasted = { order: number; skillId: string; mastery: number };
type Merge = { a: number; b: number };

function repairPayload<T>(report: ValidatorReport, name: string, key: string): T[] {
  const check = report.checks.find((c) => c.name === name);
  if (!check || check.passed || check.repair === null) return [];
  const payload = (check.repair as Record<string, unknown>)[key];
  return Array.isArray(payload) ? (payload as T[]) : [];
}

/** Renumber from zero and recompute the total, so the draft stays coherent. */
function renumber(modules: CurriculumModule[]): CurriculumDraft["modules"] {
  return modules.map((m, i) => ({ ...m, order: i }));
}

export function applyRepairs(
  draft: CurriculumDraft,
  report: ValidatorReport,
  graph: EngineSkillGraph,
): RepairOutcome {
  const skills = new Map(graph.skills.map((s) => [s.id, s]));
  const applied: string[] = [];

  let modules = [...draft.modules].sort((a, b) => a.order - b.order);

  /* ── Drop what the learner already demonstrated ──────────────────────── */
  const wasted = repairPayload<Wasted>(report, "no_already_mastered", "drop");
  if (wasted.length > 0) {
    const drop = new Set(wasted.map((w) => w.skillId));
    modules = modules
      .map((m) => ({
        ...m,
        targetSkillIds: m.targetSkillIds.filter((id) => !drop.has(id)),
      }))
      // A module with nothing left to teach is not a shorter module.
      .filter((m) => m.targetSkillIds.length > 0);

    for (const w of wasted) {
      const name = skills.get(w.skillId)?.name ?? w.skillId;
      // §14.6: "drop it, and *show* the user it was dropped."
      applied.push(`Skipped ${name} — you already showed you can do it.`);
    }
  }

  /* ── Merge near-duplicate modules ────────────────────────────────────── */
  const merges = repairPayload<Merge>(report, "no_redundancy", "merge");
  if (merges.length > 0) {
    // Drop the later of each pair; the earlier one already covers the ground.
    const drop = new Set(merges.map((m) => Math.max(m.a, m.b)));
    const before = modules.length;
    modules = modules.filter((m) => !drop.has(m.order));
    if (modules.length < before) {
      applied.push(
        `Merged ${before - modules.length} duplicate module${before - modules.length === 1 ? "" : "s"}.`,
      );
    }
  }

  /* ── Insert missing prerequisites ────────────────────────────────────── */
  const missing = repairPayload<Missing>(report, "prereq_completeness", "insert");
  if (missing.length > 0) {
    const inserted = new Set<string>();

    for (const gap of missing) {
      const skill = skills.get(gap.needs);
      // A prerequisite that is not in the graph is not something we can insert;
      // that is `no_hallucinated_skills`' problem, and it regenerates instead.
      if (!skill || inserted.has(gap.needs)) continue;

      const at = modules.findIndex((m) => m.targetSkillIds.includes(gap.skillId));
      if (at === -1) continue;

      modules.splice(at, 0, {
        order: -1,
        title: skill.name,
        targetSkillIds: [skill.id],
        estimatedHours: skill.estimatedHours,
        outputArtifact: "exercise",
        acceptanceCriteria: [skill.canDoStatement],
        rubricId: null,
      });
      inserted.add(gap.needs);
      applied.push(
        `Added ${skill.name} before ${skills.get(gap.skillId)?.name ?? gap.skillId} — it needs it first.`,
      );
    }
  }

  const renumbered = renumber(modules);

  return {
    draft: {
      ...draft,
      modules: renumbered,
      totalHours:
        Math.round(
          renumbered.reduce((sum, m) => sum + m.estimatedHours, 0) * 10,
        ) / 10,
    },
    applied,
  };
}

/**
 * Whether the report has anything mechanically repairable in it.
 *
 * A report whose only failures are `no_hallucinated_skills` or the factual
 * spot-check cannot be patched — repairing would loop without changing
 * anything, so the caller regenerates or falls back instead.
 */
export function isRepairable(report: ValidatorReport): boolean {
  return report.checks.some(
    (c) =>
      !c.passed &&
      c.repair !== null &&
      ["no_already_mastered", "no_redundancy", "prereq_completeness"].includes(
        c.name,
      ),
  );
}
