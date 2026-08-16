import { effectiveMastery } from "@/lib/engine/bkt";
import { buildIndex, prerequisitesOf } from "@/lib/engine/graph";
import type { EngineSkill, EngineSkillGraph, MasteryState } from "@/lib/engine";
import type {
  CurriculumDraft,
  CurriculumModule,
} from "@/lib/contracts/curriculum";
import { CURRICULUM_MASTERED_THRESHOLD, MIN_RUBRIC_CRITERIA } from "./validate";

/**
 * §14.9.5 — "curriculum validator fails twice → fall back to the pack's
 * canonical path."
 *
 * The fallback is pure code, and that is the whole point: it is what the
 * learner gets when the model could not produce something that passes, so it
 * cannot itself depend on a model. It is duller than a generated path — the
 * pack's own areas, in the pack's own order — and it is always valid, which at
 * that moment is worth more.
 *
 * It is built to satisfy every *blocking* check by construction rather than by
 * luck: prerequisites come first because the ordering is topological, no skill
 * is hallucinated because every skill comes from the graph, nothing already
 * demonstrated is included because it is filtered out, and a project module is
 * only emitted when a rubric that qualifies actually exists.
 */

/**
 * "money-over-time" → "Money over time". A pack authors areas in slug case.
 *
 * Here rather than in `outline.ts` because that module already imports
 * `topologicalOrder` from this one, and both need it — the outline groups by
 * area when there is no curriculum, and the canonical curriculum groups by area
 * when there is. One transform, so the two cannot disagree about an area's name.
 */
export function areaTitle(area: string): string {
  const words = area.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const LEVEL_RANK = {
  foundational: 0,
  core: 1,
  advanced: 2,
  specialist: 3,
} as const;

export interface CanonicalProject {
  /** Pack rubric slug. */
  rubricId: string;
  title: string;
  targetSkillIds: string[];
  estimatedMinutes: number;
}

/**
 * How finely the path is cut.
 *
 * A course wants `area`: a module is a piece of the subject with a name, and
 * one module per skill is what made a fifteen-skill course arrive as fifteen
 * modules of one item each. The marketing roadmap wants `skill`, and it is not
 * the same artefact — an entry there is a week and a single thing you will be
 * able to do, so grouping would blur exactly what it exists to show.
 */
export type CanonicalGrouping = "area" | "skill";

export interface CanonicalInput {
  graph: EngineSkillGraph;
  requiredSkillIds: string[];
  mastery: MasteryState[];
  now: string;
  rubricCriteria: Map<string, number>;
  projects?: CanonicalProject[];
  /** Defaults to `area`; see `CanonicalGrouping`. */
  grouping?: CanonicalGrouping;
}

/**
 * Kahn's algorithm, with ties broken by (area continuity, level, slug).
 *
 * The tiebreak is what makes the result both deterministic and gently ramped.
 * Two runs on the same graph always produce the same path, which matters
 * because this is the output a learner sees after something already went wrong.
 *
 * **Area continuity comes first, and it has to.** Modules are consecutive runs
 * of this order, so the order decides how many there are. Level first looks
 * like the gentler ramp — every foundational skill, then every core one — but
 * it walks across the areas once per level, and a real pack comes out as
 * "Exposure, Framing, Light, Optics, Exposure, Post, Exposure…": thirteen
 * modules from fifteen skills, with the same area named three times. Finishing
 * an area before starting another gives one module per area, which is the shape
 * the outline already used when no curriculum existed.
 *
 * Nothing correct is given up for it. Kahn only ever offers skills whose hard
 * prerequisites are already met, so an area cannot be entered early; level
 * still orders *within* an area, which is where a ramp is felt; and a skill
 * another area needs is still emitted before it, because that is not a tie.
 */
export function topologicalOrder(
  graph: EngineSkillGraph,
  skillIds: string[],
): string[] {
  const index = buildIndex(graph);
  const wanted = new Set(skillIds);
  const skills = new Map(graph.skills.map((s) => [s.id, s]));

  const blocking = new Map<string, Set<string>>();
  for (const id of wanted) {
    blocking.set(
      id,
      new Set(
        prerequisitesOf(index, id, "hard")
          .map((e) => e.fromSkillId)
          .filter((from) => wanted.has(from)),
      ),
    );
  }

  const rankOf = (id: string): number => {
    const skill = skills.get(id);
    return skill ? LEVEL_RANK[skill.level] : 0;
  };
  const areaOf = (id: string): string => skills.get(id)?.area ?? "";

  const ordered: string[] = [];
  /*
   * Undefined until something has been emitted, and that is not the same as
   * the empty string: `areaOf` answers `""` for a skill the graph does not
   * hold, so seeding this with `""` made a *ghost* skill the one thing that
   * matched the current area, and it won the first pick outright. Nothing has
   * been started yet, so on the first pass everything is equally away.
   */
  let current: string | undefined;
  while (blocking.size > 0) {
    // 0 for the area already in hand, 1 for anything else — so it only ever
    // separates skills the level rank had already called equal.
    const away = (id: string): number =>
      current !== undefined && areaOf(id) === current ? 0 : 1;

    const ready = [...blocking.entries()]
      .filter(([, needs]) => needs.size === 0)
      .map(([id]) => id)
      .sort(
        (a, b) =>
          away(a) - away(b) || rankOf(a) - rankOf(b) || a.localeCompare(b),
      );

    // A cycle would leave nothing ready. Packs are cycle-checked at build time
    // (§14.4), so this can only fire on a graph that never passed validation —
    // emitting the remainder in a stable order beats looping forever.
    if (ready.length === 0) {
      ordered.push(...[...blocking.keys()].sort());
      break;
    }

    const next = ready[0]!;
    current = areaOf(next);
    ordered.push(next);
    blocking.delete(next);
    for (const needs of blocking.values()) needs.delete(next);
  }

  return ordered;
}

/**
 * One module per run of same-area skills, in the order they are taught.
 *
 * It used to be one module per *skill*, which nobody saw until goals started
 * building their paths automatically — and then everybody saw it: a fifteen
 * skill course arrived as fifteen modules of one item each. The outline had
 * been quietly hiding it, because with no curriculum stored it falls back to
 * grouping by the pack's own areas, which is exactly what this now does.
 *
 * Consecutive runs rather than "all the skills in area X", and the distinction
 * is load-bearing: a module is a *slice* of a valid topological order, so
 * everything a module needs was taught in an earlier one, by construction.
 * Gathering an area's skills from wherever they fell would break that the first
 * time one area depended on the middle of another.
 */
function moduleFor(
  order: number,
  skills: EngineSkill[],
  title: string,
): CurriculumModule {
  return {
    order,
    title,
    targetSkillIds: skills.map((s) => s.id),
    estimatedHours:
      Math.round(skills.reduce((sum, s) => sum + s.estimatedHours, 0) * 10) / 10,
    outputArtifact: "exercise",
    acceptanceCriteria: skills.map((s) => s.canDoStatement),
    rubricId: null,
  };
}

/** Consecutive skills that share an area, in the order they will be taught. */
function runsByArea(ordered: EngineSkill[]): EngineSkill[][] {
  const runs: EngineSkill[][] = [];

  for (const skill of ordered) {
    const last = runs.at(-1);
    if (last && last[0]!.area === skill.area) last.push(skill);
    else runs.push([skill]);
  }

  return runs;
}

/**
 * A name per run, and a different one when an area comes back round.
 *
 * An area splits when something in another area sits in the middle of it — a
 * dependency, not an accident of ordering — so the second run is genuinely
 * *more of that area, after the thing it needed*. Two modules called the same
 * thing would read as a bug and would trip the validator's redundancy check,
 * which compares titles.
 */
function titlesFor(runs: EngineSkill[][]): string[] {
  const seen = new Map<string, number>();

  return runs.map((run) => {
    const area = run[0]!.area;
    const n = (seen.get(area) ?? 0) + 1;
    seen.set(area, n);
    const title = areaTitle(area);
    return n === 1 ? title : `${title}, continued (${n - 1})`;
  });
}

/**
 * Returns `null` only when there is nothing left to teach.
 *
 * There is no module floor. There was one — three, from §14.9.2 — and it was
 * the wrong shape of rule: it counted modules when what it was really asking
 * was whether there was any course here, and grouping by area changed the count
 * without changing the answer. A subject that is genuinely two modules long is
 * two modules long, and refusing to draw it does not make it bigger.
 */
export function canonicalCurriculum(
  input: CanonicalInput,
): CurriculumDraft | null {
  const skills = new Map(input.graph.skills.map((s) => [s.id, s]));
  const effective = new Map(
    input.mastery.map((m) => [m.skillId, effectiveMastery(m, input.now)]),
  );

  const toTeach = input.requiredSkillIds.filter(
    (id) =>
      skills.has(id) &&
      (effective.get(id) ?? 0) <= CURRICULUM_MASTERED_THRESHOLD,
  );

  const ordered = topologicalOrder(input.graph, toTeach).map(
    (id) => skills.get(id)!,
  );
  const runs =
    (input.grouping ?? "area") === "area"
      ? runsByArea(ordered)
      : ordered.map((skill) => [skill]);
  const titles =
    (input.grouping ?? "area") === "area"
      ? titlesFor(runs)
      : ordered.map((skill) => skill.name);

  const modules = runs.map((run, i) => moduleFor(i, run, titles[i]!));

  const covered = new Set(toTeach);
  for (const project of input.projects ?? []) {
    const criteria = input.rubricCriteria.get(project.rubricId);
    // Only a project the learner is actually equipped for, and only one whose
    // rubric would survive the validator's own coverage check.
    if (criteria === undefined || criteria < MIN_RUBRIC_CRITERIA) continue;
    if (!project.targetSkillIds.every((id) => covered.has(id))) continue;

    modules.push({
      order: modules.length,
      title: project.title,
      targetSkillIds: project.targetSkillIds.slice(0, 3),
      estimatedHours: project.estimatedMinutes / 60,
      outputArtifact: "project",
      acceptanceCriteria: [`Submit ${project.title} for grading.`],
      rubricId: project.rubricId,
    });
  }

  if (modules.length === 0) return null;

  return {
    modules: modules.slice(0, 40),
    totalHours:
      Math.round(
        modules.slice(0, 40).reduce((sum, m) => sum + m.estimatedHours, 0) * 10,
      ) / 10,
    rationale:
      "The pack's own path, grouped into the areas it authors and ordered so nothing arrives before what it needs. Deliberately plain: every skill you still need, in an order that works.",
  };
}
