import {
  citations,
  fiveGrams,
  overlap,
  QUALITY_THRESHOLD,
  type Dimension,
  type QualityReport,
} from "@/lib/guides/quality";
import { inboundLinks, outboundPaths, sitePaths } from "./links";
import { audiencePath, type AudiencePath } from "./path";
import { pathReferences } from "./references";
import { audienceProse, wordCount, type Audience } from "./types";

/**
 * §12.2 for §10 C.
 *
 * The guides' version of this file opens by saying it does not score what it
 * cannot measure, and that rule is why this is a second implementation rather
 * than a shared one with a flag. Six of the ten dimensions ask a different
 * question of an audience page than they ask of a guide, and the two that
 * matter most invert completely:
 *
 *   - **Originality** is not "does it quote our figures". Every figure on this
 *     page comes from the pack, unavoidably. What is scarce is *how much of the
 *     graph the page actually re-cuts* — a page that classifies three of
 *     twenty-six skills has taken a subject page and put a headline on it.
 *   - **Uniqueness** is not mainly about prose. Two audience pages on one pack
 *     can be written in entirely different words and still be the same page,
 *     because what a reader gets from either is the classification. So the
 *     duplicate check runs over the (skill, verdict) pairs as well as the
 *     sentences, and it is the stricter of the two.
 *
 * That second one is the check this page type most needed. §12's whole warning
 * is about publishing near-duplicates at scale, and "the same course, filtered
 * for a different job title" is the single most obvious way to turn one pack
 * into fifty pages. The gate makes that impossible to do quietly.
 */

/** Two pages agreeing on more than half their claims are one page. */
export const CLAIM_OVERLAP_LIMIT = 0.5;

/** The guides' 5-gram limit, applied to the authored prose here too. */
export const PROSE_OVERLAP_LIMIT = 0.15;

/** Full marks for classifying a quarter of the graph. */
const COVERAGE_TARGET = 0.25;

export type { Dimension, QualityReport } from "@/lib/guides/quality";

function ratio(actual: number, target: number): number {
  return Math.min(1, actual / target);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function hostOf(source: { url: string }): string {
  return new URL(source.url).hostname.replace(/^www\./, "");
}

/**
 * The (skill, verdict) pairs a page asserts. `new` is excluded: it is the
 * absence of a claim, and two pages agreeing about what they did not talk about
 * is not agreement.
 */
export function claimPairs(path: AudiencePath): Set<string> {
  return new Set(
    path.skills
      .filter((s) => s.verdict !== "new")
      .map((s) => `${s.slug}:${s.verdict}`),
  );
}

/** Jaccard: of everything either page claims, how much do both claim alike. */
export function claimOverlap(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const pair of a) if (b.has(pair)) shared++;
  return shared / union.size;
}

export function scoreAudience(
  path: AudiencePath,
  corpus: Audience[],
): QualityReport {
  const { audience } = path;
  const text = audienceProse(audience);
  const paths = sitePaths(corpus);
  const outbound = outboundPaths(path, corpus);
  const inbound = inboundLinks(audience, corpus);
  const problems: string[] = [];

  // ── 1. Factual validation ────────────────────────────────────────────────
  const cited = new Set(citations(text));
  const declared = new Set(audience.sources.map((s) => s.id));
  const dangling = [...cited].filter((id) => !declared.has(id));
  const unused = [...declared].filter((id) => !cited.has(id));
  if (dangling.length > 0) {
    problems.push(`cites undeclared sources: ${dangling.join(", ")}`);
  }
  const factual: Dimension = {
    id: 1,
    name: "Factual validation",
    weight: 15,
    measured: true,
    earned:
      dangling.length > 0 || declared.size === 0
        ? 0
        : (declared.size - unused.length) / declared.size,
    note:
      dangling.length > 0
        ? "a citation points at no declared source"
        : `${cited.size} of ${declared.size} declared sources are actually cited`,
  };

  // ── 2. Uniqueness ────────────────────────────────────────────────────────
  // Prose first, then the classification, and the classification is the one
  // that catches "same course, different job title".
  const mine = fiveGrams(text);
  const myPairs = claimPairs(path);
  let worstProse = 0;
  let worstClaims = 0;
  let against = "";

  for (const other of corpus) {
    if (other.slug === audience.slug) continue;
    worstProse = Math.max(worstProse, overlap(mine, fiveGrams(audienceProse(other))));
    if (other.topic !== audience.topic) continue;
    // Resolving a sibling can throw, and it is left able to: a page that names
    // a skill the pack no longer teaches should stop the build rather than be
    // quietly skipped here — skipping it would weaken the duplicate check at
    // the exact moment the corpus is in a state nobody has looked at.
    const share = claimOverlap(myPairs, claimPairs(audiencePath(other)));
    if (share > worstClaims) {
      worstClaims = share;
      against = other.slug;
    }
  }

  if (worstProse >= PROSE_OVERLAP_LIMIT) {
    problems.push(`reads like another audience page (${pct(worstProse)} shared)`);
  }
  if (worstClaims >= CLAIM_OVERLAP_LIMIT) {
    problems.push(
      `credits ${against}'s reader with the same skills (${pct(worstClaims)} of the claims agree)`,
    );
  }

  const uniqueness: Dimension = {
    id: 2,
    name: "Uniqueness",
    weight: 15,
    measured: true,
    earned:
      worstProse >= PROSE_OVERLAP_LIMIT || worstClaims >= CLAIM_OVERLAP_LIMIT
        ? 0
        : 1,
    note:
      against === ""
        ? `${pct(worstProse)} prose overlap; no other page cuts this subject yet`
        : `${pct(worstProse)} prose overlap, ${pct(worstClaims)} of claims shared with ${against}`,
  };

  // ── 3. Search-intent match ───────────────────────────────────────────────
  const intent: Dimension = {
    id: 3,
    name: "Search-intent match",
    weight: 10,
    measured: false,
    earned: 0,
    note: "needs a SERP API to classify what the results page rewards",
  };

  // ── 4. Topical completeness ──────────────────────────────────────────────
  // "What transfers" is a third of what this page type promises, so a page
  // made only of things to skip is incomplete rather than merely short.
  const parts = [
    audience.claims.length >= 3,
    audience.faqs.length >= 3,
    audience.sources.length >= 1,
    path.transfers.length >= 1,
  ];
  const completeness: Dimension = {
    id: 4,
    name: "Topical completeness",
    weight: 10,
    measured: true,
    earned: parts.filter(Boolean).length / parts.length,
    note: `${audience.claims.length} claims, ${audience.faqs.length} FAQs, ${path.transfers.length} transferring`,
  };

  // ── 5. Useful examples ───────────────────────────────────────────────────
  const examples: Dimension = {
    id: 5,
    name: "Useful examples",
    weight: 10,
    measured: true,
    earned: path.projects.length > 0 ? 1 : 0,
    note:
      path.projects.length > 0
        ? `${plural(path.projects.length, "brief", "briefs")} this reader cannot already hand in, rubrics published`
        : "every brief in the pack is one this reader could hand in today",
  };

  // ── 6. Source quality ────────────────────────────────────────────────────
  const domains = new Set(audience.sources.map(hostOf));
  const sources: Dimension = {
    id: 6,
    name: "Source quality",
    weight: 10,
    measured: true,
    earned: ratio(domains.size, 3),
    note: `${audience.sources.length} sources across ${domains.size} domains; reachability is checked by \`pnpm guides:sources\``,
  };

  // ── 7. Originality / experience ──────────────────────────────────────────
  // Two halves, because there are two ways this page can be about nothing: it
  // can decline to classify the graph, and it can decline to quote what its own
  // classification produced. Neither is recoverable by writing more adjectives.
  const claimed = path.known.length + path.transfers.length;
  const coverage = claimed / path.skills.length;
  const quoted = new Set(pathReferences(text)).size;
  const originality: Dimension = {
    id: 7,
    name: "Originality",
    weight: 10,
    measured: true,
    earned: (ratio(coverage, COVERAGE_TARGET) + ratio(quoted, 3)) / 2,
    note: `${claimed} of ${path.skills.length} skills classified (${pct(coverage)} of the graph); ${plural(quoted, "figure", "figures")} quoted from it`,
  };

  // ── 8. Internal linking ──────────────────────────────────────────────────
  const targets = new Set(outbound);
  const broken = [...targets].filter((to) => !paths.has(to));
  if (broken.length > 0) {
    problems.push(`links to pages that do not exist: ${broken.join(", ")}`);
  }
  if (targets.size < 4) problems.push(`${targets.size} outbound links, needs 4`);
  if (inbound.length < 2) {
    problems.push(
      `${inbound.length} contextual inbound links, needs 2 — this subject has no second audience page`,
    );
  }
  const linking: Dimension = {
    id: 8,
    name: "Internal linking",
    weight: 8,
    measured: true,
    earned:
      broken.length > 0
        ? 0
        : (ratio(targets.size, 4) + ratio(inbound.length, 2)) / 2,
    // Said out loud because the outbound half is structural here and taking
    // credit for it silently would flatter the number.
    note: `${targets.size} out (derived, not authored), ${inbound.length} in`,
  };

  // ── 9. Conversion quality ────────────────────────────────────────────────
  // Every claim on this page is a hypothesis about the reader, and the check is
  // what settles it. A claim over a skill with no item bank is one the page
  // cannot offer to test, which makes its call to action untrue for that skill.
  const settleable = path.skills.filter(
    (s) => s.verdict !== "new" && s.itemCount > 0,
  ).length;
  const subjectCheck = paths.has(`/check/${path.topic.slug}`);
  const conversion: Dimension = {
    id: 9,
    name: "Conversion quality",
    weight: 7,
    measured: true,
    earned:
      (subjectCheck ? 0.5 : 0) +
      (claimed > 0 ? 0.5 * (settleable / claimed) : 0),
    note:
      settleable === claimed
        ? `every claim can be settled by a check the reader can take now`
        : `${claimed - settleable} of ${claimed} claimed skills have no questions behind them`,
  };

  // ── 10. Readability & structure ──────────────────────────────────────────
  // A claim that runs to a paragraph is not a claim, and an admission test
  // nobody can skim is one nobody checks themselves against.
  const longestClaim = Math.max(
    ...audience.claims.map(
      (c) =>
        wordCount(c.claim) +
        (c.verdict === "transfers" ? wordCount(c.note) : 0),
    ),
  );
  const longestCondition = Math.max(...audience.ifYou.map(wordCount));
  const readability: Dimension = {
    id: 10,
    name: "Readability",
    weight: 5,
    measured: true,
    earned: (longestClaim <= 120 ? 0.6 : 0) + (longestCondition <= 30 ? 0.4 : 0),
    note: `longest claim ${longestClaim} words, longest condition ${longestCondition}`,
  };

  const dimensions = [
    factual,
    uniqueness,
    intent,
    completeness,
    examples,
    sources,
    originality,
    linking,
    conversion,
    readability,
  ];

  const measured = dimensions.filter((d) => d.measured);
  const available = measured.reduce((n, d) => n + d.weight, 0);
  const earned = measured.reduce((n, d) => n + d.weight * d.earned, 0);

  // §12.1 rule 3, enforced against the graph rather than against a reader's
  // patience. Not a score: a page in this state is incoherent, not weak.
  if (path.assumed.length > 0) {
    problems.push(
      `credits skills that rest on ${path.assumed
        .map((s) => s.slug)
        .join(", ")}, which no claim covers`,
    );
  }

  return {
    slug: audience.slug,
    score: Math.round((earned / available) * 100),
    dimensions,
    problems,
  };
}

/**
 * §12.1 rule 4, with one condition the guides' version does not need.
 *
 * **The subject has to be indexable too.** An audience page is a re-cut of one
 * pack's curriculum, so asking Google to rank it while the pack behind it is
 * still a draft would be publishing through the back door — the same reason a
 * project brief is indexable only when it is public *and* its topic is.
 */
export function isAudienceIndexable(
  path: AudiencePath,
  report: QualityReport,
): boolean {
  return (
    path.topic.indexable &&
    report.score >= QUALITY_THRESHOLD &&
    report.problems.length === 0 &&
    path.audience.review.reviewKind !== null
  );
}
