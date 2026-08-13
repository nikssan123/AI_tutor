import type { Metadata } from "next";
import { ORGANISATION_NAME } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

/**
 * §13.3's metadata row, as one function.
 *
 * Every marketing route was assembling this by hand, and the parts drifted in
 * exactly the way you would expect: the canonical was set everywhere (it is in
 * the checklist), `openGraph` on the landing page alone, and `twitter` nowhere
 * at all — so five of the six page types were shared as a bare URL with no
 * title, no description and no card.
 *
 * Making it one call also means the social title cannot quietly disagree with
 * the `<title>`: both come from the same argument unless a page says otherwise,
 * and a page that says otherwise has to write the sentence down.
 */
export interface MarketingMetadata {
  /** ≤60 characters — §13.3. */
  title: string;
  /** 140–160 characters — §13.3. */
  description: string;
  /** Path only; the origin comes from `siteUrl` so it cannot be typed wrong. */
  path: string;
  /**
   * §12.1 — a page earns indexing, it is never granted by default. `follow`
   * stays on either way: a page we do not want ranked is still a page whose
   * outbound links we want crawled.
   */
  indexable?: boolean;
  /**
   * Where the best line for a feed is not the best line for a result page. A
   * SERP description is read by someone already searching for the thing; a card
   * is read by someone who was not looking for it at all.
   */
  social?: { title?: string; description?: string };
}

export function marketingMetadata({
  title,
  description,
  path,
  indexable = true,
  social,
}: MarketingMetadata): Metadata {
  const url = canonical(path);

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: {
      title: social?.title ?? title,
      description: social?.description ?? description,
      url,
      siteName: ORGANISATION_NAME,
      type: "website",
      locale: "en_GB",
    },
    // The card type has to be declared even though the image itself comes from
    // the `opengraph-image` convention: without it X renders the small square
    // card and crops a 1200×630 image to nothing.
    twitter: {
      card: "summary_large_image",
      title: social?.title ?? title,
      description: social?.description ?? description,
    },
  };
}
