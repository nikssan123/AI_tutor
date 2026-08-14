import { loadAllGuides } from "./loader";
import { resolveData } from "./data";
import { inboundLinks, outboundLinks } from "./links";
import { isGuideIndexable, scoreGuide, type QualityReport } from "./quality";
import type { Guide } from "./types";

export type { Guide } from "./types";

/**
 * The public face of §10 D.
 *
 * Everything a route needs comes back already resolved and already scored,
 * because both are things a page must not be able to forget. A route that
 * rendered `guide.answer` straight from the file would print `{{topic:…}}` to a
 * reader; one that rendered without asking for the score would publish a page
 * that never passed the gate. Neither mistake is possible through this module.
 */

let cache: Guide[] | undefined;

export function allGuides(): Guide[] {
  cache ??= loadAllGuides();
  return cache;
}

/** Test seam, matching `resetContentCache`. */
export function resetGuideCache(): void {
  cache = undefined;
}

/** A guide with every own-data reference substituted for the real figure. */
export function resolveGuide(guide: Guide): Guide {
  // `title` and `description` are absent by design: the schema forbids a
  // reference in either, so resolving them would be a no-op that implied
  // otherwise.
  return {
    ...guide,
    h1: resolveData(guide.h1),
    answer: resolveData(guide.answer),
    tool: { ...guide.tool, pitch: resolveData(guide.tool.pitch) },
    sections: guide.sections.map((section) => ({
      ...section,
      heading: resolveData(section.heading),
      body: resolveData(section.body),
      list: section.list.map(resolveData),
    })),
    faqs: guide.faqs.map((faq) => ({
      question: resolveData(faq.question),
      answer: resolveData(faq.answer),
    })),
  };
}

export interface GuideDetail {
  guide: Guide;
  report: QualityReport;
  indexable: boolean;
  /** Contextual links in, for the "read next" rail and for the audit. */
  inbound: ReturnType<typeof inboundLinks>;
}

export function guideDetail(slug: string): GuideDetail | undefined {
  const corpus = allGuides();
  const guide = corpus.find((g) => g.slug === slug);
  if (!guide) return undefined;

  // Scored against the *unresolved* text on purpose: the data references are
  // what dimension 7 counts, and resolving them first would count the figures
  // as ordinary prose and score every guide as though it had none.
  const report = scoreGuide(guide, corpus);

  return {
    guide: resolveGuide(guide),
    report,
    indexable: isGuideIndexable(guide, report),
    inbound: inboundLinks(guide, corpus),
  };
}

export interface GuideSummary {
  slug: string;
  title: string;
  question: string;
  answer: string;
  indexable: boolean;
  outboundCount: number;
}

export function allGuideSummaries(): GuideSummary[] {
  const corpus = allGuides();

  return corpus
    .map((guide) => {
      const report = scoreGuide(guide, corpus);
      const resolved = resolveGuide(guide);
      return {
        slug: guide.slug,
        title: resolved.title,
        question: resolved.h1,
        answer: resolved.answer,
        indexable: isGuideIndexable(guide, report),
        outboundCount: new Set(outboundLinks(guide).map((l) => l.to)).size,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
