import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { seoPage } from "@/db/schema";
import { canonical } from "@/lib/site";

/**
 * §13.3 — "Only `indexable: true` pages included. This is the single most
 * important crawl-budget control."
 *
 * The filter is in the query rather than applied afterwards, so there is no
 * code path that can accidentally emit a non-indexable page.
 */
export async function indexablePages(): Promise<MetadataRoute.Sitemap> {
  const rows = await getDb()
    .select({
      slug: seoPage.slug,
      updatedAt: seoPage.updatedAt,
    })
    .from(seoPage)
    .where(eq(seoPage.indexable, true));

  return rows.map((row) => ({
    url: canonical(row.slug),
    lastModified: row.updatedAt,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The root is always indexable; everything else has to earn it (§12.1).
  const home: MetadataRoute.Sitemap = [
    { url: canonical("/"), lastModified: new Date() },
  ];

  try {
    return [...home, ...(await indexablePages())];
  } catch {
    // A sitemap that 500s is worse than a sitemap listing only the homepage:
    // Google retries a 200 far more readily than an error.
    return home;
  }
}
