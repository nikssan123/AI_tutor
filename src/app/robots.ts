import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * §13.3 — allow marketing, disallow the app segment and the API.
 *
 * Belt and braces with the layout-level `noindex` in (app)/layout.tsx: robots
 * stops the crawl, the meta tag stops the index. Either alone has a gap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/today",
        "/session",
        "/goals",
        "/settings",
        "/submission",
        "/mastery",
        "/admin",
        "/design",
        // §13.3 — every faceted or parameterised URL is noindex; keeping them
        // out of the crawl entirely is the #1 index-bloat control.
        "/search",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
