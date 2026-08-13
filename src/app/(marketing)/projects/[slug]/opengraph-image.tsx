import { ImageResponse } from "next/og";
import { allProjects, findProject } from "@/lib/content";
import { OgCardImage } from "@/lib/seo/og-card";
import { OG_FONTS } from "@/lib/seo/og-fonts";
import { brandCard, OG_SIZE, projectCard } from "@/lib/seo/og";

/**
 * The project card.
 *
 * §4.2 law 2 — "every rubric is public before the work is done" — is why the
 * brief is the strongest page the product has, and the card says the two things
 * that make it so: how many published criteria the work is marked against, and
 * what marking means at this project's tier.
 */
export const alt =
  "A graded project on online_uni: what you build, and what it is marked against";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 86_400;

/** Prerendered for the same reason the subject card is. */
export function generateStaticParams() {
  return allProjects().map((project) => ({ slug: project.slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = findProject(slug);
  const card = project ? projectCard(project) : brandCard();

  return new ImageResponse(<OgCardImage card={card} />, {
    ...size,
    fonts: [...OG_FONTS],
  });
}
