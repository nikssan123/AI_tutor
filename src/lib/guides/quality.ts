import { allProjects } from "@/lib/content";
import { dataReferences } from "./data";
import { GUIDES_PATH, outboundLinks, inboundLinks, sitePaths } from "./links";
import { guideProse, wordCount, type Guide } from "./types";

/**
 * §12.2 — the Content Quality Score, "computed at generation, blocks
 * publication below threshold".
 *
 * Two things about this implementation are worth stating plainly, because both
 * are places it would have been easy to publish a number that means nothing.
 *
 * **It does not score what it cannot measure.** §12.2 lists ten dimensions and
 * two of them need services this build does not have — a SERP API to classify
 * search intent, and an embedding model to compare against the ranking pages.
 * Awarding those points by default would inflate every score by up to 25 and
 * make the 75 threshold meaningless; awarding zero would fail every page for a
 * missing API key. Neither is honest. Instead an unmeasured dimension is
 * excluded from the denominator and *named in the report*, so the number is a
 * percentage of what was actually checked and the reader can see what was not.
 * This is §4.2 law 3 applied to our own instrumentation.
 *
 * **It scores structure, not quality.** Nothing here can tell whether a
 * paragraph is any good; §12.1 rule 5 ("no page ships without a human read")
 * is the control for that and this does not replace it. What a score ≥75 buys
 * is that the page cites what it claims, links where it should, quotes real
 * figures, and carries a working tool — the mechanical preconditions a human
 * read should not have to spend its attention on.
 */

/** §12.2 — "indexable requires ≥75 AND human approval". */
export const QUALITY_THRESHOLD = 75;

/** §12.2's standing rule: a live page below this is pulled and re-reviewed. */
export const QUALITY_FLOOR = 70;

export interface Dimension {
  id: number;
  name: string;
  weight: number;
  /** 0–1 of the weight. */
  earned: number;
  measured: boolean;
  note: string;
}

export interface QualityReport {
  slug: string;
  /** 0–100 over the measured dimensions only. */
  score: number;
  dimensions: Dimension[];
  /** The reasons a page cannot be published, in the order to fix them. */
  problems: string[];
}

const HUBS = new Set(["/", "/learn", "/projects", GUIDES_PATH]);

/** All the prose on the page, which is what most dimensions read. */
export { guideProse as prose } from "./types";

function citations(text: string): string[] {
  return [...text.matchAll(/\[\^([a-z0-9-]+)\]/g)].map((m) => m[1]!);
}

/** Lowercased word 5-grams, for the near-duplicate check. */
export function fiveGrams(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const grams = new Set<string>();
  for (let i = 0; i + 5 <= words.length; i++) {
    grams.add(words.slice(i, i + 5).join(" "));
  }
  return grams;
}

/** The share of this page's 5-grams that also appear on another page. */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return shared / a.size;
}

function ratio(actual: number, target: number): number {
  return Math.min(1, actual / target);
}

export function scoreGuide(guide: Guide, corpus: Guide[]): QualityReport {
  const text = guideProse(guide);
  const paths = sitePaths(corpus);
  const outbound = outboundLinks(guide);
  const inbound = inboundLinks(guide, corpus);
  const problems: string[] = [];

  // ── 1. Factual validation ────────────────────────────────────────────────
  const cited = new Set(citations(text));
  const declared = new Set(guide.sources.map((s) => s.id));
  const dangling = [...cited].filter((id) => !declared.has(id));
  const unused = [...declared].filter((id) => !cited.has(id));
  if (dangling.length > 0) {
    problems.push(`cites undeclared sources: ${dangling.join(", ")}`);
  }
  // A source nobody cites is a bibliography, and a bibliography is what a page
  // grows instead of an argument. Not fatal, but it costs.
  const factual: Dimension = {
    id: 1,
    name: "Factual validation",
    weight: 15,
    measured: true,
    earned:
      dangling.length > 0
        ? 0
        : declared.size === 0
          ? 0
          : (declared.size - unused.length) / declared.size,
    note:
      dangling.length > 0
        ? "a citation points at no declared source"
        : `${cited.size} of ${declared.size} declared sources are actually cited`,
  };

  // ── 2. Uniqueness ────────────────────────────────────────────────────────
  const mine = fiveGrams(text);
  let worst = 0;
  let worstAgainst = "";
  for (const other of corpus) {
    if (other.slug === guide.slug) continue;
    const share = overlap(mine, fiveGrams(guideProse(other)));
    if (share > worst) {
      worst = share;
      worstAgainst = other.slug;
    }
  }
  if (worst >= 0.15) {
    problems.push(`reads too much like ${worstAgainst} (${pct(worst)} shared)`);
  }
  const uniqueness: Dimension = {
    id: 2,
    name: "Uniqueness",
    weight: 15,
    measured: true,
    earned: worst >= 0.15 ? 0 : 1,
    note:
      worstAgainst === ""
        ? "nothing else on the site reads like it; SERP overlap needs an API we do not have"
        : `${pct(worst)} 5-gram overlap with ${worstAgainst}; SERP overlap not measured`,
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
  const parts = [
    guide.sections.length >= 3,
    guide.faqs.length >= 3,
    guide.sources.length >= 1,
    guide.sections.every((s) => s.body.trim().length > 0),
  ];
  const completeness: Dimension = {
    id: 4,
    name: "Topical completeness",
    weight: 10,
    measured: true,
    earned: parts.filter(Boolean).length / parts.length,
    note: `${guide.sections.length} sections, ${guide.faqs.length} FAQs`,
  };

  // ── 5. Useful examples ───────────────────────────────────────────────────
  // §12.2 asks for "≥1 real project brief with a rubric". We have those, and a
  // guide pointing at one is pointing at a published grading standard rather
  // than describing one — which is the whole difference between this site and
  // an article about learning.
  const briefs = new Set(allProjects().map((p) => `/projects/${p.slug}`));
  const linkedBriefs = outbound.filter((l) => briefs.has(l.to)).length;
  const examples: Dimension = {
    id: 5,
    name: "Useful examples",
    weight: 10,
    measured: true,
    earned: linkedBriefs > 0 ? 1 : 0,
    note:
      linkedBriefs > 0
        ? `${plural(linkedBriefs, "linked project brief", "linked project briefs")}, rubric published`
        : "no linked project brief",
  };

  // ── 6. Source quality ────────────────────────────────────────────────────
  const domains = new Set(guide.sources.map(hostOf));
  const sources: Dimension = {
    id: 6,
    name: "Source quality",
    weight: 10,
    measured: true,
    earned: ratio(domains.size, 3),
    // Reachability is deliberately not scored here. It needs the network, and
    // a gate that runs in `verify` has to give the same answer offline on a
    // train as it does in CI. `pnpm guides:sources` is the online half.
    note: `${guide.sources.length} sources across ${domains.size} domains; reachability is checked by \`pnpm guides:sources\``,
  };

  // ── 7. Originality / experience ──────────────────────────────────────────
  const own = new Set(dataReferences(text));
  const originality: Dimension = {
    id: 7,
    name: "Originality",
    weight: 10,
    measured: true,
    earned: ratio(own.size, 3),
    note: `${plural(own.size, "figure", "figures")} resolved from our own packs`,
  };

  // ── 8. Internal linking ──────────────────────────────────────────────────
  const targets = new Set(outbound.map((l) => l.to));
  const broken = [...targets].filter((to) => !paths.has(to));
  if (broken.length > 0) {
    problems.push(`links to pages that do not exist: ${broken.join(", ")}`);
  }
  if (targets.size < 4) problems.push(`${targets.size} outbound links, needs 4`);
  if (inbound.length < 2) {
    problems.push(`${inbound.length} contextual inbound links, needs 2`);
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
    note: `${targets.size} out, ${inbound.length} in`,
  };

  // ── 9. Conversion quality ────────────────────────────────────────────────
  const toolExists = paths.has(guide.tool.path);
  const toolSpecific = toolExists && !HUBS.has(guide.tool.path);
  if (!toolExists) problems.push(`the tool ${guide.tool.path} does not exist`);
  const conversion: Dimension = {
    id: 9,
    name: "Conversion quality",
    weight: 7,
    measured: true,
    earned: (toolExists ? 0.5 : 0) + (toolSpecific ? 0.5 : 0),
    note: toolSpecific
      ? `${guide.tool.path} answers this question directly`
      : toolExists
        ? "the tool is a hub page, not an answer to this question"
        : "no working tool",
  };

  // ── 10. Readability & structure ──────────────────────────────────────────
  const longest = Math.max(...guide.sections.map((s) => wordCount(s.body)));
  const scannable = guide.sections.some((s) => s.list.length > 0);
  const readability: Dimension = {
    id: 10,
    name: "Readability",
    weight: 5,
    measured: true,
    earned: (longest <= 400 ? 0.6 : 0) + (scannable ? 0.4 : 0),
    note: `longest section ${longest} words${scannable ? "" : "; no list anywhere"}`,
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
  const score = Math.round((earned / available) * 100);

  // The score is deliberately *not* pushed onto `problems`. They answer two
  // different questions — "is anything broken" and "is it good enough" — and a
  // page can fail either alone: a thin but structurally perfect guide scores
  // under 75 with no problems, and a rich one missing an inbound link has a
  // problem while scoring well above it.
  return { slug: guide.slug, score, dimensions, problems };
}

function hostOf(source: { url: string }): string {
  return new URL(source.url).hostname.replace(/^www\./, "");
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The report is read by whoever is about to publish a page, and "1 figures" in
 * a line about writing quality undermines the line.
 */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * §12.1 rule 4 — "a page is `index,follow` only after passing the gate *and*
 * receiving explicit human approval".
 *
 * Derived rather than declared, which is the one place this departs from the
 * letter of §12.1's "a boolean you flip". Pass 28 found the pack version of
 * this gate failing open because it tested for the absence of a sentinel; a
 * boolean in a YAML file has the same shape of problem one level up — it can be
 * true while the thing it asserts is false. Asking for the score *and* a
 * recorded reviewer means the flip is the review, and there is no way to set
 * the flag without doing the thing the flag claims.
 */
export function isGuideIndexable(guide: Guide, report: QualityReport): boolean {
  return (
    report.score >= QUALITY_THRESHOLD &&
    report.problems.length === 0 &&
    guide.review.reviewKind !== null
  );
}
