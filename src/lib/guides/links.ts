import { allProjects, allTopics, findPack, skillDetails } from "@/lib/content";
import { ROADMAP_TOOL_PATH } from "@/lib/roadmap/plan";
import { dataReferences } from "./data";
import type { Guide, GuideLink } from "./types";

/**
 * §13.3's internal-link row, which E10 left unbuilt because it had nothing to
 * operate on: "typed edges, rendered contextually, not as a footer link dump.
 * Rule: every page has ≥4 out and ≥2 in."
 *
 * Two halves, and the second is the one that is easy to fake.
 *
 * **Outbound** is authored. A guide declares its links inside the section that
 * earns them, so the renderer has nowhere to put a link dump even if someone
 * wanted one — there is no page-level link array to fill.
 *
 * **Inbound** is derived, and deliberately does not count the `/guides` index.
 * An index links to everything it holds; counting that would make the ≥2 rule
 * self-satisfying and measure nothing. What counts is a link from a page whose
 * own subject made it relevant:
 *
 *   - another guide, which linked here on purpose;
 *   - a subject page, when the guide quotes that subject's real numbers
 *     (`{{topic:…}}`). That reference is the evidence the guide is genuinely
 *     about the subject, so the subject page carries the link back — which is
 *     how `/learn/{topic}` gets its "questions people ask" section without
 *     anyone authoring a link table.
 *
 * The second rule means a guide earns its inbound links by being specific about
 * a subject we actually teach. A guide about learning in the abstract earns
 * none, which is the correct outcome: it is also the guide that would have
 * ranked for nothing.
 */

export const GUIDES_PATH = "/guides";

export function guidePath(slug: string): string {
  return `${GUIDES_PATH}/${slug}`;
}

/** Every path the site actually serves, for resolving authored links. */
export function sitePaths(guides: Guide[]): Set<string> {
  const paths = new Set<string>([
    "/",
    "/learn",
    "/projects",
    GUIDES_PATH,
    ROADMAP_TOOL_PATH,
  ]);

  for (const topic of allTopics()) {
    paths.add(`/learn/${topic.slug}`);
    paths.add(`/check/${topic.slug}`);
    for (const skill of skillDetails(findPack(topic.slug)!)) {
      paths.add(`/check/${topic.slug}/${skill.slug}`);
    }
  }
  for (const project of allProjects()) paths.add(`/projects/${project.slug}`);
  for (const guide of guides) paths.add(guidePath(guide.slug));

  return paths;
}

/** Authored outbound edges, flattened out of the sections that carry them. */
export function outboundLinks(guide: Guide): GuideLink[] {
  return guide.sections.flatMap((section) => section.links);
}

/**
 * The subjects a guide quotes real figures about. This is what earns it a link
 * back from `/learn/{topic}`, and it is read off the prose rather than declared
 * so the two cannot disagree.
 */
export function subjectsCited(guide: Guide): string[] {
  const prose = [
    guide.answer,
    ...guide.sections.flatMap((s) => [s.heading, s.body, ...s.list]),
    ...guide.faqs.flatMap((f) => [f.question, f.answer]),
  ].join("\n");

  const slugs = new Set<string>();
  for (const reference of dataReferences(prose)) {
    const match = /^\{\{topic:([a-z0-9-]+)\./.exec(reference);
    if (match) slugs.add(match[1]!);
  }
  return [...slugs].sort();
}

export interface Inbound {
  /** The path the link comes from. */
  from: string;
  anchor: string;
}

/** Contextual inbound links to one guide. Excludes the `/guides` index. */
export function inboundLinks(guide: Guide, all: Guide[]): Inbound[] {
  const here = guidePath(guide.slug);
  const inbound: Inbound[] = [];

  for (const other of all) {
    if (other.slug === guide.slug) continue;
    for (const link of outboundLinks(other)) {
      if (link.to === here) {
        inbound.push({ from: guidePath(other.slug), anchor: link.anchor });
      }
    }
  }

  for (const subject of subjectsCited(guide)) {
    inbound.push({ from: `/learn/${subject}`, anchor: guide.title });
  }

  return inbound;
}

/**
 * The guides a subject page should link to, which is the render side of the
 * same rule. Sorted by slug so the section is stable between builds.
 */
export function guidesForSubject(topicSlug: string, all: Guide[]): Guide[] {
  return all
    .filter((guide) => subjectsCited(guide).includes(topicSlug))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
