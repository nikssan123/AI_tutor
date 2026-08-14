import type { Metadata } from "next";
import { JsonLdScript, PageFrame, PageIntro } from "@/components/marketing";
import { LinkCard, Meta, Status, revealAt } from "@/components/ui";
import { guideClaim } from "@/lib/claims";
import { allGuideSummaries } from "@/lib/guides";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * The guides hub.
 *
 * It links to every guide including the drafts, which is deliberate and is why
 * it does not count towards §13.3's "≥2 inbound" rule in `links.ts`. An index
 * linking to its own contents is navigation, not an endorsement — the links
 * that count are the ones a page earned by being relevant to another page.
 */
export const revalidate = 86_400;

export function generateMetadata(): Metadata {
  return marketingMetadata({
    title: "Guides",
    description:
      "Straight answers to the questions people ask before they start: how long it takes, why it does not stick, and how to tell whether you are improving.",
    path: "/guides",
  });
}

export default function GuidesPage() {
  const guides = allGuideSummaries();
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Guides", path: "/guides" },
  ];

  return (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs)]} />

      <PageFrame crumbs={crumbs}>
        <PageIntro
          title="Guides"
          lead="The questions that come before a course does. Each one answers in the first paragraph, shows its working, and cites what it is standing on."
        />

        <ul className="flex list-none flex-col gap-5 p-0 m-0">
          {guides.map((guide, i) => (
            <li key={guide.slug} className="reveal" style={revealAt(i)}>
              <LinkCard href={`/guides/${guide.slug}`} className="gap-3 p-7">
                <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                  {guide.question}
                </span>
                <span className="max-w-[var(--measure)] text-[length:var(--text-label-size)] text-ink-muted">
                  {guide.answer}
                </span>
                {/* Who read it, always — not only when the answer is
                    unflattering. A badge that appears solely on drafts reads as
                    a warning; one that is always there reads as provenance,
                    which is what it is. Same argument as `MaturityBadge`. */}
                <Status tone={guideClaim(guide.review).tone}>
                  {guideClaim(guide.review).label}
                </Status>
              </LinkCard>
            </li>
          ))}
        </ul>

        {guides.length === 0 ? (
          <Meta>No guides yet.</Meta>
        ) : (
          <Meta>
            Every figure on these pages is read from the courses themselves, so
            they cannot drift out of date while the courses change.
          </Meta>
        )}
      </PageFrame>
    </>
  );
}
