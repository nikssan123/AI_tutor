import {
  findPack,
  projectDetails,
  skillDetails,
  topicSummary,
  type ProjectDetail,
  type SkillDetail,
  type TopicSummary,
} from "@/lib/content";
import type { Audience, AudienceClaim, AudienceVerdict } from "./types";

/**
 * §10 C's arithmetic — the part of an audience page nobody writes.
 *
 * The claims in the YAML are prose about a reader. Everything below is read off
 * the pack's skill graph, and the split is the point: a person says "you
 * already pivot", and the graph says which four of twenty-six skills that
 * covers, what those unlock, what it takes off the estimate, and which project
 * still has teeth. No number on this page type can be typed in, because there
 * is no field to type one into.
 *
 * That is a stronger version of what `guides/data.ts` does with `{{…}}`
 * references. A guide may quote a figure; this page cannot quote anything else.
 */

export class AudienceContentError extends Error {
  constructor(slug: string, detail: string) {
    super(`Audience page "${slug}": ${detail}`);
    this.name = "AudienceContentError";
  }
}

/** The three states a skill can be in for this reader. */
export type SkillVerdict = AudienceVerdict | "new";

export interface ClassifiedSkill extends SkillDetail {
  verdict: SkillVerdict;
}

export interface AudienceHours {
  /** The whole subject, for somebody arriving with nothing. */
  total: number;
  /** Comes off the estimate — but only if the check agrees. */
  known: number;
  /** Stays on the path; the range below is what it is worth. */
  transfers: number;
  fresh: number;
  /** If everything that transfers really does. */
  low: number;
  /** If none of it does. */
  high: number;
}

export interface AudiencePath {
  audience: Audience;
  topic: TopicSummary;
  /** Every skill in the pack, in pack order, with its verdict. */
  skills: ClassifiedSkill[];
  known: ClassifiedSkill[];
  transfers: ClassifiedSkill[];
  /** Genuinely new: no claim covers it. */
  fresh: ClassifiedSkill[];
  /**
   * Where the reader actually starts — every skill not credited to them
   * *outright* whose hard prerequisites are all in the `known` set. For
   * somebody arriving with nothing this is the graph's roots, which is the
   * correct answer to "where do I start" for them too.
   *
   * A `transfers` skill can appear here and in the transfers section both, and
   * that is right rather than redundant: the two answer different questions.
   * One is what you bring; this is what you can begin. A skill you half-know
   * with nothing in front of it is precisely where somebody should begin.
   */
  frontier: ClassifiedSkill[];
  /**
   * Hard prerequisites of a `known` skill that no claim covers.
   *
   * The graph says you cannot do the first without the second, so a page in
   * this state is claiming something incoherent about its own reader. It is
   * never rendered — §12.2's gate reads it and refuses to publish. This is the
   * one check on an audience page that a proof-reader genuinely cannot perform:
   * it needs the transitive shape of a 42-edge graph in your head.
   */
  assumed: ClassifiedSkill[];
  hours: AudienceHours;
  /**
   * Graded work that still has teeth — every brief with at least one target
   * skill the reader is not being credited with. A brief made entirely of
   * `known` skills is one this reader could hand in today, and putting it on
   * the page as something to work towards would be the lead-gen shell §11's
   * quality bar rules out.
   */
  projects: ProjectDetail[];
}

function sumHours(skills: SkillDetail[]): number {
  return skills.reduce((n, s) => n + s.estimatedHours, 0);
}

export interface ClaimGroup<C extends AudienceClaim = AudienceClaim> {
  claim: C;
  skills: ClassifiedSkill[];
}

/** The claim shape one verdict carries — `transfers` brings its caveat along. */
export type ClaimOf<V extends AudienceVerdict> = Extract<
  AudienceClaim,
  { verdict: V }
>;

/**
 * The claims of one verdict, each with the skills it covers.
 *
 * The page renders in this direction — a sentence, then the skills it accounts
 * for — while everything else here works skill-first. Both views come off the
 * same `covers` array, so a claim cannot appear on the page next to a skill the
 * arithmetic counted somewhere else.
 */
export function claimGroups<V extends AudienceVerdict>(
  path: AudiencePath,
  verdict: V,
): Array<ClaimGroup<ClaimOf<V>>> {
  return path.audience.claims
    .filter((claim): claim is ClaimOf<V> => claim.verdict === verdict)
    .map((claim) => ({
      claim,
      skills: path.skills.filter((s) => claim.covers.includes(s.slug)),
    }));
}

/**
 * Resolves one audience page against the pack it re-cuts.
 *
 * Throws rather than degrades, for `resolveData`'s reason: this runs at build
 * and in the validator, and a page describing a shortcut through a skill the
 * pack no longer teaches should stop a deploy rather than render a claim about
 * something that does not exist.
 */
export function audiencePath(audience: Audience): AudiencePath {
  const pack = findPack(audience.topic);
  if (!pack) {
    throw new AudienceContentError(
      audience.slug,
      `no subject "${audience.topic}"`,
    );
  }

  // Both page types live under `/learn/{slug}` and the route resolves an
  // audience first, so a page that took a pack's slug would not collide with
  // the subject page — it would silently replace it. The `-for-` rule in the
  // schema makes this all but unreachable; it is checked anyway because the
  // failure it prevents is a subject disappearing from the site with no error
  // anywhere.
  if (findPack(audience.slug)) {
    throw new AudienceContentError(
      audience.slug,
      "a subject already serves that URL",
    );
  }

  const details = skillDetails(pack);
  const byClaim = new Map<string, AudienceClaim>();

  for (const claim of audience.claims) {
    for (const slug of claim.covers) {
      if (!details.some((s) => s.slug === slug)) {
        throw new AudienceContentError(
          audience.slug,
          `no skill "${slug}" in ${audience.topic}`,
        );
      }
      // Two claims over one skill is not a conflict to resolve, it is a page
      // that has not decided what it thinks. The classification has to be a
      // function of the skill or none of the arithmetic below means anything.
      if (byClaim.has(slug)) {
        throw new AudienceContentError(
          audience.slug,
          `two claims both cover "${slug}"`,
        );
      }
      byClaim.set(slug, claim);
    }
  }

  const skills: ClassifiedSkill[] = details.map((skill) => ({
    ...skill,
    verdict: byClaim.get(skill.slug)?.verdict ?? "new",
  }));

  const of = (verdict: SkillVerdict) =>
    skills.filter((s) => s.verdict === verdict);
  const known = of("known");
  const transfers = of("transfers");
  const fresh = of("new");

  const knownSlugs = new Set(known.map((s) => s.slug));
  const frontier = skills.filter(
    (skill) =>
      skill.verdict !== "known" &&
      skill.hardPrerequisites.every((p) => knownSlugs.has(p)),
  );

  // Direct edges are enough: if every known skill's own hard prerequisites are
  // known, the set is closed under them transitively.
  const assumedSlugs = new Set(
    known.flatMap((s) => s.hardPrerequisites).filter((p) => !knownSlugs.has(p)),
  );
  const assumed = skills.filter((s) => assumedSlugs.has(s.slug));

  const round = (n: number) => Math.round(n);
  const freshHours = sumHours(fresh);
  const transferHours = sumHours(transfers);

  return {
    audience,
    topic: topicSummary(pack),
    skills,
    known,
    transfers,
    fresh,
    frontier,
    assumed,
    hours: {
      total: round(sumHours(skills)),
      known: round(sumHours(known)),
      transfers: round(transferHours),
      fresh: round(freshHours),
      low: round(freshHours),
      high: round(freshHours + transferHours),
    },
    projects: projectDetails(pack).filter((project) =>
      project.skills.some((s) => !knownSlugs.has(s.slug)),
    ),
  };
}
