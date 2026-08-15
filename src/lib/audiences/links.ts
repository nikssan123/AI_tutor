import { allGuides } from "@/lib/guides";
import { sitePaths as guideSitePaths } from "@/lib/guides/links";
import { ROADMAP_TOOL_PATH } from "@/lib/roadmap/plan";
import type { AudiencePath } from "./path";
import type { Audience } from "./types";

/**
 * §13.3's internal-link rule for §10 C, where both halves are *derived*.
 *
 * A guide authors its outbound links because prose is a judgement about which
 * sentence earns which link. An audience page has no such freedom: it links to
 * the subject it re-cuts, to the check that settles its claims, to the check for
 * each individual skill it credits you with, and to the briefs that still have
 * teeth. Those are not editorial choices, they are the page's structure, so
 * there is no `links:` field in the schema and no way to author a link dump.
 *
 * Which means the ≥4-out half of the rule is satisfied by construction and the
 * gate says so rather than claiming credit for it. **The half that can fail is
 * inbound**, and it is left able to fail on purpose: the only pages that link
 * here are the subject page and the *other* audience pages on the same subject,
 * so a lone audience page for a subject has one inbound link and stays out of
 * the index until it has a sibling. Two ways to read that, and both are why it
 * is written this way — a single "for people who already know Y" page is a page
 * with nobody to compare itself against, and a subject worth cutting one way is
 * a subject worth cutting two.
 */

export const AUDIENCE_PARENT = "/learn";

export function audienceHref(slug: string): string {
  return `${AUDIENCE_PARENT}/${slug}`;
}

/** Every path the site serves, including the audience pages themselves. */
export function sitePaths(corpus: Audience[]): Set<string> {
  const paths = guideSitePaths(allGuides());
  for (const audience of corpus) paths.add(audienceHref(audience.slug));
  return paths;
}

/** The other audience pages cut from the same subject. */
export function siblings(audience: Audience, corpus: Audience[]): Audience[] {
  return corpus
    .filter((a) => a.topic === audience.topic && a.slug !== audience.slug)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Everything the page links to, in the order it renders them.
 *
 * Deliberately excludes the roadmap tool, which the page also links with a
 * `?subject=` on it. That URL is `noindex` and canonicals to the bare tool
 * (§13.3's faceted-nav rule), and counting a link we are asking Google not to
 * rank towards a rule about the internal link graph would be measuring nothing.
 */
export function outboundPaths(
  path: AudiencePath,
  corpus: Audience[],
): string[] {
  const topic = path.topic.slug;

  return [
    `/learn/${topic}`,
    `/check/${topic}`,
    ...path.known.map((s) => `/check/${topic}/${s.slug}`),
    ...path.frontier.map((s) => `/check/${topic}/${s.slug}`),
    ...path.projects.map((p) => `/projects/${p.slug}`),
    ...siblings(path.audience, corpus).map((a) => audienceHref(a.slug)),
  ];
}

/** The parameterised link the page carries alongside the countable ones. */
export function roadmapHref(topicSlug: string): string {
  return `${ROADMAP_TOOL_PATH}?subject=${topicSlug}`;
}

export interface Inbound {
  from: string;
  anchor: string;
}

/**
 * Contextual links in.
 *
 * The subject page always counts: an audience page re-cuts that exact pack, so
 * `/learn/{topic}` renders a link to it for the same reason it renders the
 * guides that quote its figures — the relevance is a fact about the content,
 * not an assertion by whoever wrote it. Siblings count for the same reason and
 * are the half that has to be earned.
 */
export function inboundLinks(audience: Audience, corpus: Audience[]): Inbound[] {
  return [
    { from: `/learn/${audience.topic}`, anchor: audience.title },
    ...siblings(audience, corpus).map((sibling) => ({
      from: audienceHref(sibling.slug),
      anchor: sibling.title,
    })),
  ];
}
