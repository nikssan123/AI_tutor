import { loadAllPacks } from "@/lib/packs/loader";
import { buildIndex, prerequisitesOf } from "@/lib/engine/graph";
import { toEngineGraph } from "@/lib/packs/validate";
import { tierFor } from "@/lib/evaluation/tier";
import type { DomainPack, PackProject, PackRubric, PackSkill } from "@/lib/packs/types";

/**
 * The marketing content model.
 *
 * Every public page is derived from a Domain Pack rather than hand-written, for
 * the reason §15 gives: "everything indexable is DB-driven and statically
 * rendered — SEO pages must be deterministic, diffable, reviewable and
 * cacheable." It also means a page cannot describe a skill the product does not
 * actually teach, which is the failure mode §12 is guarding against.
 *
 * §12.1's structural defence in one line: a page is only `indexable` when the
 * thing it describes genuinely exists and works. Nothing here defaults to true.
 *
 * **Every `evalTier` below is the tier the product can honour, not the tier the
 * pack declares.** They are not the same number: the SQL pack declares tier 1
 * and nothing in this build executes a learner's work, so `tierFor` caps it at
 * 2. This module is the boundary where that has to happen, because it is what
 * every public surface reads — the subject page, the brief, the check, and the
 * share cards. A page reaching past it to `pack.evalTier` is a page promising
 * execution that will not happen (§4.2 law 3). The admin console deliberately
 * still shows the declared tier: that is a fact about the pack, and it is the
 * one screen whose job is to show what the pack claims for itself.
 */

export interface TopicSummary {
  slug: string;
  name: string;
  /** curated | standard | generated — shown honestly (§7.1). */
  maturity: DomainPack["maturity"];
  /**
   * Who checked it, which the badge needs alongside `maturity` to avoid
   * claiming a hand-check nobody performed. `null` is "nobody yet".
   */
  reviewKind: DomainPack["quality"]["reviewKind"];
  /** §7.1's taxonomy branch; drives the subject icon without a lookup table. */
  taxonomyParent: string | null;
  evalTier: number;
  skillCount: number;
  projectCount: number;
  totalHours: number;
  /** Areas the topic covers, in graph order. */
  areas: string[];
  indexable: boolean;
}

export interface SkillDetail {
  slug: string;
  name: string;
  description: string;
  canDoStatement: string;
  level: PackSkill["level"];
  area: string;
  evalTier: number;
  estimatedHours: number;
  /** Slugs a learner needs first. */
  hardPrerequisites: string[];
  /** Slugs that make it easier but are not required. */
  softPrerequisites: string[];
  /** Skills this one unlocks. */
  unlocks: string[];
  itemCount: number;
}

export interface ProjectDetail extends PackProject {
  topicSlug: string;
  topicName: string;
  /**
   * The tier the *submission* is graded at, which is a property of the pack's
   * evaluatorConfig, not of the project. Carried explicitly because a brief
   * that states a stronger claim than its evaluator can honour is precisely
   * the overclaiming §4.2 law 3 rules out.
   *
   * That was the intent from the start and the code did not keep it: it copied
   * `pack.evalTier` through unchanged, so the SQL briefs promised tier 1's "we
   * run your work" while the evaluator capped them at 2. It goes through
   * `tierFor` now.
   */
  evalTier: number;
  rubricDetail: PackRubric;
  /** Resolved from `targetSkills`. */
  skills: Array<{ slug: string; name: string; canDoStatement: string }>;
  indexable: boolean;
}

let cache: DomainPack[] | undefined;

/** Packs are read from disk once per process; they never change at runtime. */
export function allPacks(): DomainPack[] {
  cache ??= loadAllPacks();
  return cache;
}

/** Test seam. */
export function resetContentCache(): void {
  cache = undefined;
}

export function findPack(slug: string): DomainPack | undefined {
  return allPacks().find((p) => p.slug === slug);
}

function totalHours(pack: DomainPack): number {
  return Math.round(pack.skills.reduce((sum, s) => sum + s.estimatedHours, 0));
}

/**
 * §12.1 — a topic page is indexable only when the pack behind it is Curated and
 * somebody has recorded a review of it. A Generated pack ships as a real page
 * the product can serve, but not as one we ask Google to rank.
 *
 * **This used to fail open.** The test was `reviewedBy !== "unreviewed"`, and
 * `reviewedBy` defaults to `null` — so a pack that never declared a `quality`
 * block at all cleared the gate, because `null` is not that particular string.
 * Only a pack that explicitly opted *out* was held back. Asking for a positive
 * `reviewKind` inverts it: the default is now the closed position, and there is
 * no spelling of "reviewed" that the enum will accept by accident.
 *
 * A model review opens the gate, as it does today for the three packs signed
 * that way. What it no longer does is borrow the badge a human review earns —
 * see `maturityClaim`.
 */
export function isTopicIndexable(pack: DomainPack): boolean {
  return pack.maturity === "curated" && pack.quality.reviewKind !== null;
}

export function topicSummary(pack: DomainPack): TopicSummary {
  const areas: string[] = [];
  for (const skill of pack.skills) {
    if (!areas.includes(skill.area)) areas.push(skill.area);
  }

  return {
    slug: pack.slug,
    name: pack.name,
    maturity: pack.maturity,
    reviewKind: pack.quality.reviewKind,
    taxonomyParent: pack.taxonomyParent,
    evalTier: tierFor(pack.evalTier),
    skillCount: pack.skills.length,
    projectCount: pack.projects.length,
    totalHours: totalHours(pack),
    areas,
    indexable: isTopicIndexable(pack),
  };
}

export function allTopics(): TopicSummary[] {
  return allPacks()
    .map(topicSummary)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function skillDetails(pack: DomainPack): SkillDetail[] {
  const index = buildIndex(toEngineGraph(pack));
  const itemsBySkill = new Map<string, number>();
  for (const item of pack.items) {
    itemsBySkill.set(item.skill, (itemsBySkill.get(item.skill) ?? 0) + 1);
  }

  return pack.skills.map((skill) => ({
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    canDoStatement: skill.canDoStatement,
    level: skill.level,
    area: skill.area,
    evalTier: tierFor(skill.evalTier),
    estimatedHours: skill.estimatedHours,
    hardPrerequisites: prerequisitesOf(index, skill.slug, "hard").map(
      (e) => e.fromSkillId,
    ),
    softPrerequisites: prerequisitesOf(index, skill.slug, "soft").map(
      (e) => e.fromSkillId,
    ),
    // Both lookups are total: buildIndex seeds `dependents` for every skill,
    // and the validator rejects any pack with a skill below MIN_ITEMS_PER_SKILL.
    unlocks: [...index.dependents.get(skill.slug)!]
      .map((e) => e.toSkillId)
      .sort(),
    itemCount: itemsBySkill.get(skill.slug)!,
  }));
}

export function findSkill(
  topicSlug: string,
  skillSlug: string,
): { pack: DomainPack; skill: SkillDetail } | undefined {
  const pack = findPack(topicSlug);
  if (!pack) return undefined;
  const skill = skillDetails(pack).find((s) => s.slug === skillSlug);
  return skill ? { pack, skill } : undefined;
}

/**
 * §10 B — graded project briefs with public rubrics. These are the strongest
 * marketing asset the product has right now, because they are genuinely unique
 * data rather than an article: the rubric a submission will actually be graded
 * against, published before the work is done (§4.2 law 2).
 */
export function projectDetails(pack: DomainPack): ProjectDetail[] {
  const byName = new Map(pack.skills.map((s) => [s.slug, s]));

  return pack.projects.map((project) => {
    const rubricDetail = pack.rubrics.find((r) => r.slug === project.rubric);
    // The validator guarantees this resolves; packs cannot reach production
    // with a project pointing at a rubric that does not exist.
    if (!rubricDetail) {
      throw new Error(
        `Project "${project.slug}" references missing rubric "${project.rubric}"`,
      );
    }

    return {
      ...project,
      topicSlug: pack.slug,
      topicName: pack.name,
      /*
       * The tier *this brief* can honour, not the pack's.
       *
       * §7.2 tier 3 is media review, and a brief that asks for nothing but a
       * write-up will not be doing any — so a media pack's prose-only project
       * would otherwise print "We check the technical side" over a page whose
       * hand-in contains nothing to look at. The pack-level claims a few lines
       * up cannot ask this question, because a pack is not one hand-in.
       */
      evalTier: tierFor(pack.evalTier, project.evidence.image !== "none"),
      rubricDetail,
      skills: project.targetSkills.flatMap((slug) => {
        const skill = byName.get(slug);
        return skill
          ? [
              {
                slug: skill.slug,
                name: skill.name,
                canDoStatement: skill.canDoStatement,
              },
            ]
          : [];
      }),
      // §12.1 — a brief is indexable when it is public *and* its topic is.
      indexable: project.isPublic && isTopicIndexable(pack),
    };
  });
}

export function allProjects(): ProjectDetail[] {
  return allPacks()
    .flatMap(projectDetails)
    .sort((a, b) => a.difficulty - b.difficulty);
}

/**
 * The brief the landing page shows a full worked example of.
 *
 * Deliberately a writing task rather than the lowest-difficulty one: a visitor
 * who has never written SQL still understands "tell them the deadline is
 * slipping", and the landing page's job is to be legible to someone who has
 * not yet decided what to learn. Falls back to the easiest public brief so the
 * page still works if that pack is ever removed.
 */
export function featuredProject(): ProjectDetail {
  const projects = allProjects();
  return projects.find((p) => p.slug === "the-slip-message") ?? projects[0]!;
}

export function findProject(slug: string): ProjectDetail | undefined {
  return allProjects().find((p) => p.slug === slug);
}

export interface SearchHit {
  kind: "topic" | "skill" | "project";
  title: string;
  href: string;
  detail: string;
}

/**
 * Search across real pack content. Deliberately a plain substring match: the
 * corpus is one pack, and a relevance model over 26 skills would be theatre.
 */
export function search(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const hits: SearchHit[] = [];

  for (const pack of allPacks()) {
    if (pack.name.toLowerCase().includes(q) || pack.slug.includes(q)) {
      hits.push({
        kind: "topic",
        title: pack.name,
        href: `/learn/${pack.slug}`,
        detail: `${pack.skills.length} skills · ${pack.projects.length} graded projects`,
      });
    }

    for (const skill of pack.skills) {
      if (
        skill.name.toLowerCase().includes(q) ||
        skill.canDoStatement.toLowerCase().includes(q) ||
        skill.area.includes(q)
      ) {
        hits.push({
          kind: "skill",
          title: skill.name,
          href: `/check/${pack.slug}/${skill.slug}`,
          detail: skill.canDoStatement,
        });
      }
    }

    for (const project of pack.projects) {
      if (
        project.title.toLowerCase().includes(q) ||
        project.brief.toLowerCase().includes(q)
      ) {
        hits.push({
          kind: "project",
          title: project.title,
          href: `/projects/${project.slug}`,
          detail: `Graded project · ${project.estimatedMinutes} min`,
        });
      }
    }
  }

  return hits;
}
