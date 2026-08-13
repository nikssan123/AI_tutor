import { canonical, siteUrl } from "@/lib/site";
import type { ProjectDetail, SkillDetail, TopicSummary } from "@/lib/content";

/**
 * §13.3 — JSON-LD.
 *
 * The rule that matters most is the last line of that row: **"Never mark up
 * content that isn't visibly on the page."** Every builder below takes the same
 * data the page renders, so the markup and the page cannot drift apart — which
 * is how sites end up with structured-data penalties.
 */

export const ORGANISATION_NAME = "online_uni";

export type JsonLd = Record<string, unknown>;

export function organisation(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: ORGANISATION_NAME,
    url: siteUrl(),
    description:
      "Learn any skill — one written by hand or one written on request — and get the work you produce marked against a published checklist, so you end up with proof rather than a completion certificate.",
  };
}

/** §13.3 — `WebSite` + `SearchAction` on the root only. */
export function website(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: ORGANISATION_NAME,
    url: siteUrl(),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl()}/learn?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export interface Crumb {
  name: string;
  path: string;
}

/** §13.3 — visible breadcrumbs *and* the markup. Both, never just the markup. */
export function breadcrumbs(crumbs: Crumb[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: canonical(crumb.path),
    })),
  };
}

/**
 * §13.3 — `Course` on `/learn`, "only where a real structured curriculum
 * exists". A pack with a validated skill graph is exactly that; a Generated
 * pack with no items is not, so the caller gates on `topic.indexable`.
 */
export function course(topic: TopicSummary, skills: SkillDetail[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: topic.name,
    description: `A ${topic.skillCount}-skill path with ${topic.projectCount} graded projects, roughly ${topic.totalHours} hours of work.`,
    url: canonical(`/learn/${topic.slug}`),
    provider: { "@type": "Organization", name: ORGANISATION_NAME },
    teaches: skills.map((s) => s.canDoStatement),
    timeRequired: `PT${topic.totalHours}H`,
  };
}

/**
 * §13.3 — `HowTo` on `/projects`. The steps are the acceptance criteria the
 * page already lists, so the markup describes visible content exactly.
 */
export function howTo(project: ProjectDetail): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: project.title,
    description: project.brief,
    url: canonical(`/projects/${project.slug}`),
    totalTime: `PT${project.estimatedMinutes}M`,
    step: project.acceptanceCriteria.map((criterion, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      text: criterion,
    })),
  };
}

/** Serialises for a `<script type="application/ld+json">` tag. */
export function serialise(...blocks: JsonLd[]): string {
  return JSON.stringify(blocks.length === 1 ? blocks[0] : blocks);
}
