import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { seoPage } from "@/db/schema";
import { allProjects, allTopics } from "@/lib/content";
import { canonical } from "@/lib/site";

/**
 * §13.3 — "Only `indexable: true` pages included. This is the single most
 * important crawl-budget control."
 *
 * Two sources feed it, and both filter on the same rule:
 *   - pack-derived pages (topics, project briefs), gated on their own
 *     `indexable` flag, which requires a Curated *and* human-reviewed pack;
 *   - authored `SeoPage` rows, filtered in the query itself.
 *
 * `/check/*` is absent by design: the assessment behind it is not built, and a
 * page promising a tool it does not have is what §12 exists to prevent.
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
