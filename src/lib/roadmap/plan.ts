import { canonicalCurriculum } from "@/lib/curriculum/canonical";
import { projectSkills } from "@/lib/goals/projection";
import { toEngineGraph } from "@/lib/packs/validate";
import { MAX_WEEKLY_HOURS, MIN_WEEKLY_HOURS } from "@/lib/contracts/goal";
import type { DomainPack } from "@/lib/packs/types";
import type { MasteryState } from "@/lib/engine";

/**
 * §19.1's Roadmap Generator — and the thing building it changed about §19.2.
 *
 * The plan costs this tool as an LLM call, and then spends a whole section
 * avoiding the bill: precompute roadmaps for "the top ~2,000 (goal × level ×
 * weekly-hours) combinations", store them in Postgres, human-spot-check them,
 * and serve a database read. That design is right about the economics and wrong
 * about the mechanism, because by the time this was reachable the product had
 * built the pieces that make the model unnecessary:
 *
 * - the **skill graph** is in the pack (§7.1), authored or generated once;
 * - **`topologicalOrder`** already puts it in a teachable order, deterministically
 *   and with a stable tiebreak (`curriculum/canonical.ts`);
 * - **`projectSkills`** already decides what a learner does and does not have to
 *   do, and says why (`goals/projection.ts`);
 * - hours are pack data.
 *
 * So a roadmap for a subject we have is *arithmetic*, not generation: zero
 * marginal cost, no cache to invalidate, no quality gate to run, and identical
 * every time — which is a stronger claim than a spot-checked cache, because
 * there is nothing left to spot-check. There is no `roadmap_cache` table in
 * this build and there should not be one. §19.2's abuse controls follow the
 * same way: a tool with no AI spend behind it cannot be abused into a bill.
 *
 * A subject nobody has written still costs $0.61 to author (§24 E7.5) and still
 * needs an account and three minutes. That path is unchanged and this tool
 * points at it rather than pretending to answer for it.
 *
 * **The part that is not arithmetic is what makes it ours.** Every competitor's
 * roadmap tool asks for a self-declared level and shortens the plan on the
 * strength of it. §4.2 law 1 says self-report is never evidence, and
 * `projection.ts` refuses to read the stated level for exactly that reason. So
 * this tool has no level field, and the plan it draws is the same for everyone
 * until something is *proved* — which is the product's argument stated as a
 * feature rather than an apology.
 *
 * **It does not read the Skill Check either, and that took measuring.** The
 * first cut built the plan on the check cookie, so an anonymous visitor's
 * answers would drop skills out of it. They cannot: `projectSkills` excludes a
 * skill at `MASTERY_TARGET` (0.85), the BKT needs three correct observations on
 * one skill to get there, and a nine-question check across a 26-skill subject
 * never gives any single skill three. A perfect check tops out around 0.6.
 *
 * That is not a bug in the check — it is §4.2 law 1 holding: one right answer is
 * not proof. It does mean §24 E4's "an expert-level tester is correctly placed
 * at high mastery on ≥80% of skills they actually know" is not met by today's
 * item banks, and until it is, a band on this page saying "your check took these
 * out" would be a band nobody could ever see. So the page says the true thing
 * instead, and points at the check for what the check is actually for.
 */

/** §5's persona has 3–8 hours a week; the middle of it, when nobody says. */
export const DEFAULT_WEEKLY_HOURS = 4;

/**
 * Written down once, because three places need it and one of them is the
 * sitemap — a route whose path is retyped in the sitemap is a route that gets
 * submitted to Google as a 404 the first time it moves.
 */
export const ROADMAP_TOOL_PATH = "/tools/learning-roadmap-generator";

/**
 * One entry of the plan: a module, and the weeks it runs across.
 *
 * `week` and `through` are the same number for anything that fits inside one
 * week's budget, which is most of them. A 10-hour project at 4 hours a week is
 * `weeks 3–5`, and saying so is the honest form — a single week number for a
 * fortnight's work is the flattering rounding §4.2 law 3 rules out.
 */
export interface RoadmapEntry {
  /** 1-based week this piece of work starts in. */
  week: number;
  /** Last week it runs into; equal to `week` when it fits in one. */
  through: number;
  title: string;
  hours: number;
  /** §4.2 law 2 — ends in something marked against a published rubric. */
  graded: boolean;
  /** What finishing it lets you do, from the pack's own statement. */
  canDo: string;
  /**
   * The brief's slug, for a graded entry; `null` for a skill.
   *
   * Carried because the alternative is what the first cut printed: a project
   * module's acceptance criterion is `Submit {title} for grading.`, which under
   * a heading that is already the title reads as the title said twice in a
   * stilted sentence. A link to the published checklist is the better half of
   * that sentence anyway — §4.2 law 2 is the argument, and it is one click away
   * rather than paraphrased.
   */
  brief: string | null;
}

export interface Roadmap {
  weeklyHours: number;
  /** The sum of what is on the page, in hours. */
  totalHours: number;
  /** The specialist tail the pack declares and the plan deliberately omits. */
  optionalHours: number;
  weeks: number;
  /** Weeks if the specialist skills are taken too. Equal to `weeks` when none. */
  weeksWithOptional: number;
  entries: RoadmapEntry[];
  /** How many of the entries end in marked work. */
  gradedCount: number;
}

/**
 * Parses the `hours` parameter off a URL.
 *
 * Bounds are `contracts/goal`'s, not new ones — the same 0.5–40 the goal form
 * accepts. A tool that would plan 100 hours a week and a product that refuses
 * to record one is the sort of disagreement nobody notices until a learner
 * carries a number across.
 *
 * Anything unparseable is the default rather than an error: this is a URL a
 * stranger can edit, and the failure mode of a free tool is "here is the plan
 * anyway", never a validation message.
 */
export function weeklyHoursFrom(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WEEKLY_HOURS;
  return Math.min(Math.max(parsed, MIN_WEEKLY_HOURS), MAX_WEEKLY_HOURS);
}

/** One decimal, for the reason `projection.ts` gives: these are estimates. */
function round(hours: number): number {
  return Math.round(hours * 10) / 10;
}

export interface RoadmapInput {
  pack: DomainPack;
  /**
   * What the visitor has already proved, which for a public tool is nothing —
   * it is on the input rather than assumed empty because it is the parameter
   * that *would* change this plan, and the tests exercise it as the definition
   * of what does. See the note at the top of this file for why a Skill Check
   * cannot currently reach the bar that moves it.
   */
  mastery: MasteryState[];
  weeklyHours: number;
  /** ISO-8601, injected so a roadmap is reproducible. */
  now: string;
}

/**
 * Three, or this page has nothing to draw.
 *
 * The floor used to live in `canonicalCurriculum` and applied to every caller,
 * which is why it came out: a *course* two modules long is two modules long,
 * and refusing to draw it does not make it bigger. Here it is about something
 * real. This is a public page whose whole offer is "here is your roadmap", and
 * a roadmap with two rows on it is a screenshot nobody shares and a promise the
 * page did not keep. Saying there is nothing to lay out is the better answer,
 * and the page already has the words for it.
 */
export const MIN_ROADMAP_ENTRIES = 3;

/**
 * Returns `null` when there is no plan left to draw — fewer than
 * `MIN_ROADMAP_ENTRIES` entries, which means either a subject too small to lay
 * out or a learner who has proved nearly all of it. Both are real answers and
 * the page gives them; padding back up to a respectable length would mean
 * inventing work.
 */
export function buildRoadmap(input: RoadmapInput): Roadmap | null {
  const graph = toEngineGraph(input.pack);
  const projection = projectSkills({
    graph,
    mastery: input.mastery,
    now: input.now,
  });

  const draft = canonicalCurriculum({
    /*
     * One entry per skill, unlike a course.
     *
     * A course groups its modules by area, because a module is a piece of the
     * subject with a name. A roadmap entry is a week and a single thing you
     * will be able to do at the end of it — grouping would blur precisely what
     * this page exists to show, and would leave `canDo` below quoting the first
     * of several statements as though it were the whole module.
     */
    grouping: "skill",
    graph,
    requiredSkillIds: projection.requiredSkillIds,
    mastery: input.mastery,
    now: input.now,
    rubricCriteria: new Map(
      input.pack.rubrics.map((r) => [r.slug, r.criteria.length]),
    ),
    projects: input.pack.projects.map((p) => ({
      rubricId: p.rubric,
      title: p.title,
      targetSkillIds: p.targetSkills,
      estimatedMinutes: p.estimatedMinutes,
    })),
  });

  if (!draft || draft.modules.length < MIN_ROADMAP_ENTRIES) return null;

  const byId = new Map(graph.skills.map((s) => [s.id, s]));

  /*
   * Weeks are assigned by cumulative hours rather than by counting modules,
   * which is what makes a 30-minute exercise and a 6-hour project land in
   * honest places. A module starts in the week its running total falls in and
   * ends in the week its total is reached.
   */
  // Modules echo the project's title, which is what a brief is findable by
  // here: `CurriculumModule` carries the rubric it is marked against, and a
  // rubric can serve more than one brief.
  const briefs = new Map(input.pack.projects.map((p) => [p.title, p.slug]));

  let cumulative = 0;
  const entries: RoadmapEntry[] = draft.modules.map((mod) => {
    const week = Math.floor(cumulative / input.weeklyHours) + 1;
    cumulative += mod.estimatedHours;
    const graded = mod.outputArtifact === "project";
    return {
      week,
      through: Math.max(week, Math.ceil(cumulative / input.weeklyHours)),
      title: mod.title,
      hours: round(mod.estimatedHours),
      graded,
      // Both assertions rather than fallbacks, because both are guaranteed by
      // the function that just produced these modules: `canonicalCurriculum`
      // writes exactly one acceptance criterion per module, and a module with
      // `outputArtifact: "project"` is only ever built from an entry of the
      // list passed in above. A `??` here would be an unreachable branch
      // dressed up as caution.
      canDo: mod.acceptanceCriteria[0]!,
      brief: graded ? briefs.get(mod.title)! : null,
    };
  });

  /*
   * The upper end of the range, and the one number here that is not in the
   * plan. `projectSkills` leaves the specialist skills out of the estimate on
   * purpose — "promising someone the specialist tail is how a 20-hour goal
   * becomes a 60-hour one" — so quoting the tail separately is how the page
   * gets §11's "explicit range with stated assumptions" without inventing a
   * margin of error nobody measured.
   */
  const optionalHours = projection.optionalSkillIds.reduce(
    // `optionalSkillIds` is a subset of the graph `byId` was built from.
    (sum, id) => sum + byId.get(id)!.estimatedHours,
    0,
  );

  return {
    weeklyHours: input.weeklyHours,
    totalHours: round(draft.totalHours),
    optionalHours: round(optionalHours),
    weeks: Math.ceil(draft.totalHours / input.weeklyHours),
    weeksWithOptional: Math.ceil(
      (draft.totalHours + optionalHours) / input.weeklyHours,
    ),
    entries,
    gradedCount: entries.filter((e) => e.graded).length,
  };
}

/**
 * The plan as weeks, for a page that shows one.
 *
 * Grouped by the week a piece of work *starts*, so a module that spans a
 * fortnight is listed once rather than repeated under every week it touches —
 * it carries its own `through` and says so. Weeks in which nothing new starts
 * are not emitted at all: an empty row headed "Week 4" reads as a week off, and
 * what it actually means is that week 3's work is still running.
 */
export interface RoadmapWeekGroup {
  week: number;
  hours: number;
  entries: RoadmapEntry[];
}

export function groupByWeek(entries: readonly RoadmapEntry[]): RoadmapWeekGroup[] {
  const groups: RoadmapWeekGroup[] = [];

  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last?.week === entry.week) {
      last.entries.push(entry);
      last.hours = round(last.hours + entry.hours);
      continue;
    }
    groups.push({ week: entry.week, hours: entry.hours, entries: [entry] });
  }

  return groups;
}

/**
 * Which subject the bare URL plans, before anyone has chosen.
 *
 * The tool's own page is the indexable one (§13.3 — every parameterised view is
 * `noindex`), so what it renders unasked is what gets ranked, and it should be
 * the deepest subject we publicly stand behind: the most skills, among the packs
 * that clear §12.1's review gate, with the slug as a tiebreak so it cannot
 * change from one deploy to the next.
 *
 * Falls back to the first subject in the catalogue when nothing is reviewed yet
 * — which is every environment before a pack is signed off, and was every
 * environment until three passes ago.
 */
export function defaultSubject<T extends { slug: string; skillCount: number; indexable: boolean }>(
  topics: readonly T[],
): T | undefined {
  const reviewed = topics.filter((t) => t.indexable);
  return [...(reviewed.length > 0 ? reviewed : topics)].sort(
    (a, b) => b.skillCount - a.skillCount || a.slug.localeCompare(b.slug),
  )[0];
}
