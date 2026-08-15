import { inboundLinks, siblings } from "./links";
import { loadAllAudiences } from "./loader";
import { audiencePath, type AudiencePath } from "./path";
import { resolveAudience } from "./references";
import {
  isAudienceIndexable,
  scoreAudience,
  type QualityReport,
} from "./quality";
import type { Audience } from "./types";

export type { Audience } from "./types";

/**
 * The public face of §10 C.
 *
 * Everything comes back already resolved against the pack and already scored,
 * for `guides/index.ts`'s reason: a route that could ask for one without the
 * other is a route that can publish a page which never passed the gate.
 */

let cache: Audience[] | undefined;

export function allAudiences(): Audience[] {
  cache ??= loadAllAudiences();
  return cache;
}

/** Test seam, matching `resetContentCache` and `resetGuideCache`. */
export function resetAudienceCache(): void {
  cache = undefined;
}

export interface AudienceDetail {
  path: AudiencePath;
  report: QualityReport;
  indexable: boolean;
  inbound: ReturnType<typeof inboundLinks>;
  /** The other cuts of this subject, for the rail at the foot of the page. */
  siblings: Audience[];
}

export function audienceDetail(slug: string): AudienceDetail | undefined {
  const corpus = allAudiences();
  const audience = corpus.find((a) => a.slug === slug);
  if (!audience) return undefined;

  const path = audiencePath(audience);
  // Scored against the *unresolved* prose, for `guideDetail`'s reason: the
  // references are what dimension 7 counts, and resolving first would count
  // them as ordinary words and score every page as though it quoted nothing.
  const report = scoreAudience(path, corpus);

  return {
    path: resolveAudience(path),
    report,
    indexable: isAudienceIndexable(path, report),
    inbound: inboundLinks(audience, corpus),
    siblings: siblings(audience, corpus),
  };
}

export interface AudienceSummary {
  slug: string;
  topic: string;
  title: string;
  h1: string;
  audience: string;
  /** How many of the subject's skills this reader is credited with. */
  credited: number;
  skillCount: number;
  indexable: boolean;
  /** Who read it — a different question from whether it is indexed. */
  review: Audience["review"]["reviewKind"];
}

function summarise(audience: Audience, corpus: Audience[]): AudienceSummary {
  const path = audiencePath(audience);
  const report = scoreAudience(path, corpus);

  return {
    slug: audience.slug,
    topic: audience.topic,
    title: audience.title,
    h1: audience.h1,
    audience: audience.audience,
    credited: path.known.length + path.transfers.length,
    skillCount: path.skills.length,
    indexable: isAudienceIndexable(path, report),
    review: audience.review.reviewKind,
  };
}

export function allAudienceSummaries(): AudienceSummary[] {
  const corpus = allAudiences();
  return corpus
    .map((audience) => summarise(audience, corpus))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The cuts of one subject, for `/learn/{topic}` to render.
 *
 * Drafts are included deliberately. The subject page is where an audience page
 * gets one of its two required inbound links, and a list that quietly dropped
 * the unpublished ones would make `inboundLinks` count a link the page does not
 * draw — a metric measuring itself. It is also how the guides hub treats a
 * draft: shown, and labelled as one.
 */
export function audiencesForTopic(topicSlug: string): AudienceSummary[] {
  const corpus = allAudiences();
  // Filtered before the paths are resolved, not after. `summarise` throws when
  // a page names a subject that no longer exists — which is what should happen
  // to a build — but it should not be a subject page's problem that some other
  // subject's audience page is broken.
  return corpus
    .filter((audience) => audience.topic === topicSlug)
    .map((audience) => summarise(audience, corpus))
    .sort((a, b) => a.title.localeCompare(b.title));
}
