import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { seoPage } from "@/db/schema";
import { allAudienceSummaries } from "@/lib/audiences";
import { allProjects, allTopics, findPack, skillDetails } from "@/lib/content";
import { allGuideSummaries } from "@/lib/guides";
import { GUIDES_PATH } from "@/lib/guides/links";
import { ROADMAP_TOOL_PATH } from "@/lib/roadmap/plan";
import { canonical } from "@/lib/site";

/**
 * §13.3 — "Only `indexable: true` pages included. This is the single most
 * important crawl-budget control."
 *
 * Two sources feed it, and both filter on the same rule:
 *   - pack-derived pages (topics, their skill checks, project briefs), gated on
 *     their own `indexable` flag, which requires a Curated *and* human-reviewed
 *     pack;
 *   - authored `SeoPage` rows, filtered in the query itself.
 *
 * Both check pages are here now, on the same gate. Each was excluded in turn on
 * the grounds that the assessment behind it did not exist — true of the subject
 * check until E4, and of the per-skill check until it was built. §2.6 calls the
 * skill-assessment SERP "the crack in the wall", and these are the pages that
 * answer those queries with a working tool rather than an article about one.
 */
export function packPages(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const topic of allTopics()) {
    if (!topic.indexable) continue;
    entries.push({
      url: canonical(`/learn/${topic.slug}`),
      changeFrequency: "weekly",
      priority: 0.8,
    });
    entries.push({
      url: canonical(`/check/${topic.slug}`),
      changeFrequency: "monthly",
      priority: 0.8,
    });

    /*
     * One page per skill, each a check that can actually settle that skill —
     * which is the difference between this and the combinatorial pages §12
     * rules out. The subject check locates a learner across the whole graph and
     * proves nothing; these prove one thing each, and they say so.
     */
    for (const skill of skillDetails(findPack(topic.slug)!)) {
      entries.push({
        url: canonical(`/check/${topic.slug}/${skill.slug}`),
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  for (const project of allProjects()) {
    if (!project.indexable) continue;
    entries.push({
      url: canonical(`/projects/${project.slug}`),
      changeFrequency: "monthly",
      priority: 0.7,
    });
  }

  return entries;
}

/**
 * §10 D — the authored guides, on the same rule as everything else here.
 *
 * A guide is indexable only once it scores ≥75 on §12.2 with no outstanding
 * problems *and* somebody has recorded that they read it, so a draft sitting in
 * the repository is invisible to a crawler by construction rather than by
 * anyone remembering to keep it out.
 *
 * The `/guides` hub follows its contents: a hub whose every child is a draft is
 * a page listing things we are not asking anyone to rank, and submitting it
 * would be submitting a thin page. It joins the moment the first guide does.
 */
export function guidePages(): MetadataRoute.Sitemap {
  const published = allGuideSummaries().filter((g) => g.indexable);
  if (published.length === 0) return [];

  return [
    { url: canonical(GUIDES_PATH), changeFrequency: "weekly", priority: 0.8 },
    ...published.map((guide) => ({
      url: canonical(`${GUIDES_PATH}/${guide.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}

/**
 * §10 C — the audience pages, on the same gate as everything else here.
 *
 * A page is included once it clears §12.2 with no outstanding problems, somebody
 * has recorded a read, *and* the pack it re-cuts is itself indexable. That last
 * condition is the one specific to this page type: an audience page is a
 * shorter route through one subject's curriculum, so submitting it while the
 * subject is still a draft would be asking Google to rank a draft by the back
 * door. There is no hub to include — these live under `/learn/{slug}` and the
 * subject page is their index.
 */
export function audiencePages(): MetadataRoute.Sitemap {
  return allAudienceSummaries()
    .filter((audience) => audience.indexable)
    .map((audience) => ({
      url: canonical(`/learn/${audience.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));
}

export async function indexablePages(): Promise<MetadataRoute.Sitemap> {
  const rows = await getDb()
    .select({ slug: seoPage.slug, updatedAt: seoPage.updatedAt })
    .from(seoPage)
    .where(eq(seoPage.indexable, true));

  return rows.map((row) => ({
    url: canonical(row.slug),
    lastModified: row.updatedAt,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Hub pages: always indexable, and the top of the internal link graph.
  const hubs: MetadataRoute.Sitemap = [
    { url: canonical("/"), changeFrequency: "weekly", priority: 1 },
    { url: canonical("/learn"), changeFrequency: "weekly", priority: 0.9 },
    { url: canonical("/projects"), changeFrequency: "weekly", priority: 0.9 },
    // What it costs is a question people search for by name, and the page
    // answers it in full rather than asking for an email first.
    { url: canonical("/pricing"), changeFrequency: "monthly", priority: 0.8 },
    // The bare tool only. Every `?subject=…&hours=…` view of it is `noindex`
    // and canonicals here, which is the same faceted-nav rule `/learn?q=`
    // follows — and the reason there is no page per subject per pace.
    {
      url: canonical(ROADMAP_TOOL_PATH),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    // Legal pages are not content marketing and §12.1's gate does not apply to
    // them — they are pages a person may reasonably search for by name. Low
    // priority, rarely changed, and linked from every page's footer.
    { url: canonical("/terms"), changeFrequency: "yearly", priority: 0.2 },
    { url: canonical("/privacy"), changeFrequency: "yearly", priority: 0.2 },
  ];

  const base = [...hubs, ...packPages(), ...audiencePages(), ...guidePages()];

  try {
    return [...base, ...(await indexablePages())];
  } catch {
    // A sitemap that 500s is worse than a partial one: Google retries a 200 far
    // more readily than an error.
    return base;
  }
}
