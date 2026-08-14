import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Prose, SectionLinks, Sources } from "@/components/guide-body";
import { ChecklistIcon, GridIcon, StepsIcon } from "@/components/icons";
import {
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import { ButtonLink, LinkCard, Meta, revealAt } from "@/components/ui";
import { allGuides, guideDetail } from "@/lib/guides";
import { breadcrumbs, faqPage } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * §10 D — `/guides/{question}`, the question-intent page type.
 *
 * This is the one page on the site that is mostly prose, and it is therefore
 * the one page §12 was written about. Three things carry the defence, and all
 * three are upstream of this file rather than in it:
 *
 *   - the prose is hand-written and reviewed in a diff (`content/guides/`);
 *   - every figure in it resolves from a real pack at build, so a page cannot
 *     drift away from the product it describes;
 *   - it is `noindex` until it clears §12.2's bar *and* somebody has recorded
 *     that they read it.
 *
 * What this file adds is §11's ordering: the direct answer first, the working
 * tool above the fold, then the argument, then the sources, then the questions
 * — because the reader who bounces after eight seconds should still leave with
 * the answer, and the one who stays should be able to check us.
 */
export const revalidate = 86_400;

export function generateStaticParams() {
  return allGuides().map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = guideDetail(slug);
  if (!detail) return {};

  return marketingMetadata({
    title: detail.guide.title,
    description: detail.guide.description,
    path: `/guides/${slug}`,
    indexable: detail.indexable,
  });
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = guideDetail(slug);
  if (!detail) notFound();

  const { guide } = detail;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Guides", path: "/guides" },
    { name: guide.title, path: `/guides/${guide.slug}` },
  ];

  const anchor = (heading: string) =>
    heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const related = allGuides().filter((g) => g.slug !== guide.slug);

  return (
    <>
      <JsonLdScript
        blocks={[
          breadcrumbs(crumbs),
          // §13.3 — FAQPage "where a real FAQ exists". The same array renders
          // below, so the markup cannot describe a question the page hides.
          ...(guide.faqs.length > 0 ? [faqPage(guide.faqs)] : []),
        ]}
      />

      <PageFrame crumbs={crumbs}>
        {/* §11 item 1 — the direct answer *is* the lead. A guide that opens
            with throat-clearing has lost the snippet and the reader. */}
        <PageIntro
          title={guide.h1}
          lead={guide.answer}
          facts={
            <>
              <Meta>{guide.sections.length} sections</Meta>
              <Meta>{guide.sources.length} sources, all cited</Meta>
              <Meta>No signup</Meta>
            </>
          }
        />

        {/* ── The tool, above the fold ─────────────────────────────────────
            §12.1 rule 2: "every indexable page contains a working tool or
            unique data". For a guide the tool is the reason the page is
            allowed to be prose at all, so it goes before the argument rather
            than after it — a reader who wants the answer applied to their own
            case should never have to scroll past our reasoning to get it. */}
        <section className="-mx-6 flex flex-col gap-5 bg-accent-weak px-6 py-10 sm:rounded-[var(--radius-card)] sm:px-10">
          <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
            Try it on your own case
          </span>
          <p className="max-w-[var(--measure)] text-[length:var(--text-lead-size)] leading-[var(--text-lead-line)] text-ink">
            {guide.tool.pitch}
          </p>
          <ButtonLink href={guide.tool.path}>{guide.tool.label}</ButtonLink>
        </section>

        {/* §8.5.7 — "sticky contents on desktop" for the long page types. Two
            columns at lg and one below it, so a phone reads straight down. */}
        <div className="flex flex-col gap-16 lg:grid lg:grid-cols-[180px_1fr] lg:items-start lg:gap-x-12">
          <nav
            aria-label="On this page"
            className="hidden lg:sticky lg:top-16 lg:block"
          >
            <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
              On this page
            </span>
            <ul className="mt-4 flex list-none flex-col gap-3 p-0">
              {guide.sections.map((section) => (
                <li key={section.heading}>
                  <Link
                    href={`#${anchor(section.heading)}`}
                    className="text-[length:var(--text-meta-size)] text-ink-muted hover:text-accent"
                  >
                    {section.heading}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-col gap-16">
            {guide.sections.map((section, i) => (
              <section
                key={section.heading}
                id={anchor(section.heading)}
                className="flex scroll-mt-16 flex-col gap-6"
              >
                <SectionHead
                  step={String(i + 1).padStart(2, "0")}
                  label="Guide"
                  title={section.heading}
                  icon={<StepsIcon />}
                />
                <Prose text={section.body} sources={guide.sources} />
                {section.list.length > 0 ? (
                  <ul className="flex max-w-[var(--measure)] list-none flex-col gap-3 p-0 m-0">
                    {section.list.map((entry, j) => (
                      <li
                        key={entry}
                        className="reveal flex items-start gap-3"
                        style={revealAt(j)}
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2.5 inline-block size-2 shrink-0 rounded-full bg-accent"
                        />
                        <span className="text-[length:var(--text-label-size)] text-ink">
                          {entry}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <SectionLinks section={section} />
              </section>
            ))}
          </div>
        </div>

        {/* ── Sources ──────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-8">
          <SectionHead
            step={String(guide.sections.length + 1).padStart(2, "0")}
            label="Where this comes from"
            title="Sources, and what each is worth"
            icon={<ChecklistIcon />}
          />
          <Sources sources={guide.sources} />
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        {guide.faqs.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step={String(guide.sections.length + 2).padStart(2, "0")}
              label="Also asked"
              title="Questions that come with this one"
              icon={<GridIcon />}
            />
            <div className="flex flex-col gap-8">
              {guide.faqs.map((faq) => (
                <div
                  key={faq.question}
                  className="flex max-w-[var(--measure)] flex-col gap-2"
                >
                  <h3 className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {faq.question}
                  </h3>
                  <Prose text={faq.answer} sources={guide.sources} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Read next ────────────────────────────────────────────────────── */}
        {related.length > 0 ? (
          <section className="flex flex-col gap-6">
            <Meta>Next question</Meta>
            <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2">
              {related.map((other, i) => (
                <li key={other.slug} className="reveal" style={revealAt(i)}>
                  <LinkCard href={`/guides/${other.slug}`}>
                    <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                      {other.h1}
                    </span>
                  </LinkCard>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!detail.indexable ? (
          <Meta>
            Nobody has read this page end to end yet, so treat it as a first
            draft.
          </Meta>
        ) : null}
      </PageFrame>
    </>
  );
}
