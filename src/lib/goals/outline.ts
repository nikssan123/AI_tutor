import { effectiveMastery } from "@/lib/engine/bkt";
import { buildIndex, prerequisitesOf } from "@/lib/engine/graph";
import { HARD_PREREQ_THRESHOLD, remainingHoursFor } from "@/lib/engine/scoring";
import { topologicalOrder } from "@/lib/curriculum/canonical";
import type { CurriculumModule } from "@/lib/contracts/curriculum";
import type { SkillProjection } from "@/lib/contracts/goal";
import type { EngineSkill, EngineSkillGraph, MasteryState } from "@/lib/engine";
import { lowerFirst } from "./projection";

/**
 * The whole course as a list you can read top to bottom — §8 screen 5's
 * "mastered / in progress / locked / skipped-because-you-know-it", finally in
 * the form a learner can actually use.
 *
 * The path screen had the four states already; it drew them as three fills on a
 * DAG. A graph answers "what is the shape of this subject", which is a question
 * nobody arrives with. The question people arrive with is the one every course
 * catalogue on the internet answers — *what is in this thing, where am I in it,
 * and why can't I do that yet* — and a coloured rectangle at (3, 2) with no
 * words on it answers none of the three. Worse, the one state the graph never
 * showed at all was **locked**: an untouched skill and an unreachable one drew
 * identically, so the screen could not say the single most useful thing it
 * knows, which is *what has to happen first*.
 *
 * So this is the outline, and the locked row names its blocker. Nothing here is
 * new information — every state is read off the same graph, the same mastery
 * and the same projection the planner uses — which is the point: §16.1 already
 * decided all of it, and the learner was simply never shown the decision.
 *
 * Pure, and `now` is injected, for the reason everything else in this directory
 * is: the same inputs must produce the same screen twice.
 */

/** §16.1's eligibility filter, as a word. */
export type SkillState = "proved" | "open" | "locked" | "optional";

/** A section takes the state of the most actionable thing in it. */
export type SectionState = SkillState;

export interface OutlineSkill {
  skillId: string;
  name: string;
  state: SkillState;
  /**
   * Hours still owed, priced against what the learner already has — the same
   * `remainingHoursFor` the header totals, so the rows add up to the number at
   * the top of the page rather than to a brochure figure.
   */
  hours: number;
  /**
   * One sentence saying why the row reads the way it does. Never empty: §8.5.5
   * bans a tooltip that explains an icon, so a lock that cannot say what it is
   * waiting for has no business being drawn.
   */
  note: string;
}

export interface OutlineSection {
  key: string;
  title: string;
  state: SectionState;
  skills: OutlineSkill[];
  /** The section's skills' hours, so the header can be read without expanding. */
  hours: number;
  /** The graded hand-in this section ends with, when it has one. */
  handIn: string | null;
  /** The first section with something open — the one that arrives expanded. */
  current: boolean;
}

export interface Outline {
  sections: OutlineSection[];
  /** How many skills are in each state, for the legend above the list. */
  counts: Record<SkillState, number>;
}

export interface OutlineInput {
  graph: EngineSkillGraph;
  mastery: MasteryState[];
  /** ISO-8601. */
  now: string;
  /** The same projection the page header is priced from. */
  projection: SkillProjection;
  /** The stored curriculum's modules, when one has been built. */
  modules?: CurriculumModule[] | undefined;
}

/** One decimal: the input is an expert's estimate, not a measurement. */
function round1(hours: number): number {
  return Math.round(hours * 10) / 10;
}

/** "Metering" · "Metering and Focus" · "Metering, Focus and White balance". */
function andList(names: string[]): string {
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}

/** "money-over-time" → "Money over time". A pack authors areas in slug case. */
function areaTitle(area: string): string {
  const words = area.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * State precedence, and the order is an argument rather than an accident.
 *
 * **Optional outranks locked.** A specialist skill whose prerequisite is
 * unmet is locked *and* out of scope, and answering "why is this greyed out"
 * with "you need X first" would be answering the wrong question: the reason it
 * is not in their list is the depth they chose, which is a dial they can move.
 * The lock is downstream of a decision they never made.
 */
function skillStateOf(
  skillId: string,
  proved: Set<string>,
  optional: Set<string>,
  blockers: string[],
): SkillState {
  if (proved.has(skillId)) return "proved";
  if (optional.has(skillId)) return "optional";
  return blockers.length > 0 ? "locked" : "open";
}

/**
 * The sentence under the row, which is the whole reason this screen replaces a
 * coloured rectangle. A state without a sentence is a lock with no keyhole.
 */
function noteFor(
  skill: EngineSkill,
  state: SkillState,
  blockers: string[],
): string {
  if (state === "proved") {
    return `You already showed you can ${lowerFirst(skill.canDoStatement)}.`;
  }
  if (state === "optional") {
    return "Not in your course at this depth — still yours to take on.";
  }
  if (state === "locked") {
    return `Unlocks once you've done ${andList(blockers)}.`;
  }
  return `Open to you now — you'll be able to ${lowerFirst(skill.canDoStatement)}.`;
}

/** A section takes the state of the most actionable thing in it. */
function sectionStateOf(skills: OutlineSkill[]): SectionState {
  const has = (state: SkillState) =>
    skills.some((skill) => skill.state === state);

  if (has("open")) return "open";
  if (has("locked")) return "locked";
  return has("proved") ? "proved" : "optional";
}

/** A section before it knows its state — the one shape both groupings emit. */
interface GroupedSection {
  key: string;
  title: string;
  skills: OutlineSkill[];
  handIn: string | null;
}

/**
 * Where the sections come from when no curriculum has been generated.
 *
 * Generation is a model call the learner has to ask for, so "no curriculum yet"
 * is the state most goals are in most of the time — and the screen used to
 * answer it with a button and nothing else. It never needed to: the pack ships
 * the areas and the graph ships the order, so the whole subject can be laid out
 * for free, in a shape the generated modules will slot straight into.
 */
function areaSections(
  graph: EngineSkillGraph,
  toOutlineSkill: (skill: EngineSkill) => OutlineSkill,
): GroupedSection[] {
  const byId = new Map(graph.skills.map((s) => [s.id, s]));
  const ordered = topologicalOrder(
    graph,
    graph.skills.map((s) => s.id),
  );

  // Insertion order is first topological appearance, so the areas run in the
  // order a learner would meet them rather than in pack-file order.
  const byArea = new Map<string, OutlineSkill[]>();
  for (const id of ordered) {
    const skill = byId.get(id)!;
    const group = byArea.get(skill.area) ?? [];
    group.push(toOutlineSkill(skill));
    byArea.set(skill.area, group);
  }

  return [...byArea].map(([area, skills]) => ({
    key: `area-${area}`,
    title: areaTitle(area),
    skills,
    handIn: null,
  }));
}

/**
 * A module ends in a hand-in worth naming, or it does not.
 *
 * Only `project` earns the line, which is the same bar the old module list
 * used for its "Graded" tag. §2.2 says the product is differentiated on graded
 * work; naming an `exercise` a hand-in would spend that word on something the
 * learner does inside a session and never submits.
 */
function handInFor(mod: CurriculumModule): string | null {
  return mod.outputArtifact === "project"
    ? "Ends with a project you hand in, and we mark it"
    : null;
}

/** Skills no section claimed, bucketed by what they are — module path only. */
const TRAILING: Array<{
  key: string;
  title: string;
  states: SkillState[];
}> = [
  {
    key: "trailing-proved",
    title: "Already yours",
    states: ["proved"],
  },
  {
    key: "trailing-rest",
    title: "Also on your path",
    states: ["open", "locked"],
  },
  {
    key: "trailing-optional",
    title: "Not in your course",
    states: ["optional"],
  },
];

export function buildOutline(input: OutlineInput): Outline {
  const index = buildIndex(input.graph);
  const skills = new Map(input.graph.skills.map((s) => [s.id, s]));
  const effective = new Map(
    input.mastery.map((m) => [m.skillId, effectiveMastery(m, input.now)]),
  );
  const masteryOf = (id: string): number => effective.get(id) ?? 0;

  const proved = new Set(input.projection.excludedSkillIds);
  const optional = new Set(input.projection.optionalSkillIds);

  const toOutlineSkill = (skill: EngineSkill): OutlineSkill => {
    // Total by construction: the pack validator rejects an edge naming a skill
    // that does not exist, so every prerequisite id is in the graph.
    const blockers = prerequisitesOf(index, skill.id, "hard")
      .filter((edge) => masteryOf(edge.fromSkillId) < HARD_PREREQ_THRESHOLD)
      .map((edge) => skills.get(edge.fromSkillId)!.name);

    const state = skillStateOf(skill.id, proved, optional, blockers);

    return {
      skillId: skill.id,
      name: skill.name,
      state,
      // A proved skill is owed nothing, and `remainingHoursFor` already says so;
      // rounding is what keeps "0.04h" off the screen.
      hours: round1(remainingHoursFor(skill, masteryOf(skill.id))),
      note: noteFor(skill, state, blockers),
    };
  };

  const grouped: GroupedSection[] =
    input.modules === undefined
      ? areaSections(input.graph, toOutlineSkill)
      : [...input.modules]
          .sort((a, b) => a.order - b.order)
          .map((mod) => ({
            key: `module-${mod.order}`,
            title: mod.title,
            // A stored curriculum outlives the pack it was written against, so
            // a skill that has since left the graph is dropped rather than
            // rendered as a raw id.
            skills: mod.targetSkillIds
              .map((id) => skills.get(id))
              .filter((skill) => skill !== undefined)
              .map(toOutlineSkill),
            handIn: handInFor(mod),
          }))
          .filter((section) => section.skills.length > 0);

  // Everything the modules did not claim. The generated curriculum only covers
  // what is left to do, so without this the outline would silently lose every
  // skill the learner has already proved — which is the half of the screen §8
  // is most insistent about.
  const claimed = new Set(
    grouped.flatMap((section) => section.skills.map((s) => s.skillId)),
  );
  const leftover = input.graph.skills
    .filter((skill) => !claimed.has(skill.id))
    .map(toOutlineSkill);

  const trailing: GroupedSection[] = TRAILING.map((bucket) => ({
    key: bucket.key,
    title: bucket.title,
    skills: leftover.filter((skill) => bucket.states.includes(skill.state)),
    handIn: null,
  })).filter((section) => section.skills.length > 0);

  const sections: OutlineSection[] = [...grouped, ...trailing].map(
    (section) => ({
      ...section,
      state: sectionStateOf(section.skills),
      hours: round1(
        section.skills.reduce((total, skill) => total + skill.hours, 0),
      ),
      current: false,
    }),
  );

  // Exactly one section arrives expanded, and it is the one with work in it.
  // A finished course expands nothing, which is the correct amount of noise to
  // make at someone who is done.
  const current = sections.find((section) => section.state === "open");
  if (current) current.current = true;

  const counts: Record<SkillState, number> = {
    proved: 0,
    open: 0,
    locked: 0,
    optional: 0,
  };
  for (const section of sections) {
    for (const skill of section.skills) counts[skill.state] += 1;
  }

  return { sections, counts };
}
