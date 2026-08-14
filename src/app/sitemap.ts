import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { seoPage } from "@/db/schema";
import { allProjects, allTopics, findPack, skillDetails } from "@/lib/content";
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
    // The bare tool only. Every `?subject=…&hours=…` view of it is `noindex`
    // and canonicals here, which is the same faceted-nav rule `/learn?q=`
    // follows — and the reason there is no page per subject per pace.
    {
      url: canonical(ROADMAP_TOOL_PATH),
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ];

  const base = [...hubs, ...packPages()];

  try {
    return [...base, ...(await indexablePages())];
  } catch {
    // A sitemap that 500s is worse than a partial one: Google retries a 200 far
    // more readily than an error.
    return base;
  }
}
