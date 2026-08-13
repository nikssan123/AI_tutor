import { ImageResponse } from "next/og";
import { allPacks, findPack, topicSummary } from "@/lib/content";
import { OgCardImage } from "@/lib/seo/og-card";
import { OG_FONTS } from "@/lib/seo/og-fonts";
import { brandCard, OG_SIZE, subjectCard } from "@/lib/seo/og";

/**
 * The subject card — the link people actually paste.
 *
 * It carries §7.1's maturity badge, which is the whole argument for generating
 * these rather than shipping one flat image: a share card is where a product
 * describes itself to strangers, and this one says "Experimental" out loud when
 * that is what the subject is.
 */
export const alt = "A subject on online_uni: what it covers, and how it was written";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 86_400;

/**
 * Without this the route builds as `ƒ (Dynamic)` and satori re-renders the PNG
 * on every request — which for a share card means on every crawl by every
 * network that unfurls the link, for an image that changes about as often as
 * the pack does. An image route does not inherit the page segment's params, so
 * the list has to be repeated here.
 */
export function generateStaticParams() {
  return allPacks().map((pack) => ({ topic: pack.slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const pack = findPack(topic);

  // The page 404s for an unknown slug, so this is only reachable when something
  // has gone wrong upstream. Falling back to the brand card keeps a broken
  // share looking like the product rather than like a stack trace.
  const card = pack ? subjectCard(topicSummary(pack)) : brandCard();

  return new ImageResponse(<OgCardImage card={card} />, {
    ...size,
    fonts: [...OG_FONTS],
  });
}
