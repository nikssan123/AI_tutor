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
 *   - pack-derived pages (topics, their skill checks, project briefs), gated on
 *     their own `indexable` flag, which requires a Curated *and* human-reviewed
 *     pack;
 *   - authored `SeoPage` rows, filtered in the query itself.
 *
 * `/check/{topic}` is here now. It was excluded on the grounds that the
 * assessment behind it did not exist — true when this was written, and untrue
 * since E4 — so it is gated on exactly what the subject page is gated on. Its
 * `/check/{topic}/{skill}` children stay out: that page still offers a check
 * for one skill that nobody has built (`SKILL_CHECKS_ARE_NEVER_INDEXED`).
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
    // §2.6 — the skill-assessment SERP is "the crack in the wall", and this is
    // the only page in the product that answers one of those queries with a
    // working tool rather than an article about one.
    entries.push({
      url: canonical(`/check/${topic.slug}`),
      changeFrequency: "monthly",
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
