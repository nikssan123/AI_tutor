import { ImageResponse } from "next/og";
import { allAudiences, audienceDetail } from "@/lib/audiences";
import { guideClaim } from "@/lib/claims";
import { allPacks, findPack, topicSummary } from "@/lib/content";
import { OgCardImage } from "@/lib/seo/og-card";
import { OG_FONTS } from "@/lib/seo/og-fonts";
import { audienceCard, brandCard, OG_SIZE, subjectCard } from "@/lib/seo/og";

/**
 * The subject card — the link people actually paste.
 *
 * It carries §7.1's maturity badge, which is the whole argument for generating
 * these rather than shipping one flat image: a share card is where a product
 * describes itself to strangers, and this one says "Experimental" out loud when
 * that is what the subject is.
 */
export const alt = "A subject on MeritKeep: what it covers, and how it was written";
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
  return [
    ...allPacks().map((pack) => ({ topic: pack.slug })),
    ...allAudiences().map((audience) => ({ topic: audience.slug })),
  ];
}

export default async function Image({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;

  // §10 C shares this segment, and its card is a different claim: not what a
  // subject covers, but how much of it somebody arriving from a particular job
  // does not have to start from scratch on.
  const audience = audienceDetail(topic);
  const pack = findPack(topic);

  // The page 404s for an unknown slug, so the last branch is only reachable
  // when something has gone wrong upstream. Falling back to the brand card
  // keeps a broken share looking like the product rather than a stack trace.
  const card = audience
    ? audienceCard({
        h1: audience.path.audience.h1,
        topicName: audience.path.topic.name,
        known: audience.path.known.length,
        transfers: audience.path.transfers.length,
        low: audience.path.hours.low,
        high: audience.path.hours.high,
        badge: guideClaim(audience.path.audience.review.reviewKind),
      })
    : pack
      ? subjectCard(topicSummary(pack))
      : brandCard();

  return new ImageResponse(<OgCardImage card={card} />, {
    ...size,
    fonts: [...OG_FONTS],
  });
}
