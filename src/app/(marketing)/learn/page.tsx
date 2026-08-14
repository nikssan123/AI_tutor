import type { Metadata } from "next";
import Link from "next/link";
import { ChecklistIcon, GridIcon, PenIcon } from "@/components/icons";
import {
  CustomPathOffer,
  GoalSearch,
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
  SubjectCard,
} from "@/components/marketing";
import { Card, Lead, LinkCard, Meta, revealAt } from "@/components/ui";
import { allProjects, allTopics, search } from "@/lib/content";
import { CUSTOM_PATH_HREF } from "@/lib/goals/custom-path";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { groupByCategory } from "@/lib/content/categories";
import { marketingMetadata } from "@/lib/seo/metadata";
import { canonical } from "@/lib/site";

/**
 * The `/learn` hub, and the destination of the landing page's goal input.
 *
 * §13.3 — "Site search is `noindex,follow`." A results page is not content, but
 * its links are worth crawling, so links are followed and the page is not
 * indexed. The unfiltered hub *is* indexable: it is the top of the internal
 * link graph.
 *
 * **This page was two pages.** Under the catalogue sat every graded brief in
 * the product — twenty-two cards, each one a bare title and `4 criteria · 75
 * min`, in no order a reader could name, with no subject attached and no
 * indication of what any of them were. It was `/projects` reproduced without
 * the things that make `/projects` legible, on a page whose job is subjects.
 * That is the whole of what "unstructured" meant here: a visitor scrolled past
 * seven subjects into a wall of unlabelled work and could not tell whether they
 * were still on the same page.
 *
 * It is one page again. The briefs are named once, as a count and a link, and
 * the section that used to list them now says what they *are* — which is the
 * thing the wall never managed to.
 *
 * The other repair is the card. `SubjectCard` is shared with nothing else now
 * that the landing page shows a row list, but it was previously copied verbatim
 * between the two, and it carried four facts in a line that wrapped to three
 * rows at a third of the grid width. Three facts, one component.
 */
export const revalidate = 86_400;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;

  if (q) {
    return {
      title: `Search: ${q}`,
      // §13.3 — a parameterised view is never indexed, and canonicals to the
      // bare URL. This is the #1 source of index bloat.
      robots: { index: false, follow: true },
      alternates: { canonical: canonical("/learn") },
    };
  }

  return marketingMetadata({
    title: "What you can learn — and prove",
    description:
      "Every subject here has a full list of skills, real questions written for it, and work we can mark. Ask for one that isn’t — we write it in three minutes.",
    path: "/learn",
  });
}

/** The one link style used in running text on this page. */
const INLINE_LINK =
  "font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent";

export default async function LearnIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const topics = allTopics();
  const projects = allProjects();
  const suggestions = [
    ...topics.map((t) => ({ label: t.name, href: `/learn/${t.slug}` })),
    ...projects.map((p) => ({
      label: p.title,
      href: `/projects/${p.slug}`,
    })),
  ];

  const hits = q ? search(q) : [];
  const subjectCount = new Set(projects.map((p) => p.topicSlug)).size;

  return (
    <>
      <JsonLdScript
        blocks={[
          breadcrumbs([
            { name: "Home", path: "/" },
            { name: "Learn", path: "/learn" },
          ]),
        ]}
      />

      <PageFrame
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
        ]}
      >
        <PageIntro
          title={q ? `Results for “${q}”` : "What you can learn — and prove"}
          lead="A subject appears here only once it has a full list of skills, real questions written for it, and at least one project we can mark."
          facts={
            <>
              <Meta>{topics.length} subjects</Meta>
              <Meta>{projects.length} graded projects</Meta>
              <Meta>Every checklist published first</Meta>
            </>
          }
          /*
           * The search box, then the offer that catches whatever it misses.
           *
           * "Not here? Ask for it" used to sit in the facts row *above* the
           * input, where it read as a caveat on a page nobody had searched yet.
           * Under the box it is what it actually is: what to do when the box
           * does not have your answer.
           */
          action={
            <div className="flex flex-col gap-3">
              <GoalSearch suggestions={suggestions} defaultValue={q ?? ""} />
              <Meta>
                Not here?{" "}
                <Link href={CUSTOM_PATH_HREF} className={INLINE_LINK}>
                  Ask for it
                </Link>{" "}
                and we write it, in about three minutes.
              </Meta>
            </div>
          }
        />

        {q ? (
          hits.length > 0 ? (
            <section className="flex flex-col gap-8">
              <SectionHead
                step="01"
                label="Search"
                title={`${hits.length} matches`}
                icon={<GridIcon />}
              />
              <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2">
                {hits.map((hit, i) => (
                  <li key={hit.href} className="reveal" style={revealAt(i)}>
                    <LinkCard href={hit.href}>
                      <Meta>{hit.kind}</Meta>
                      <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                        {hit.title}
                      </span>
                      <span className="text-[length:var(--text-label-size)] text-ink-muted">
                        {hit.detail}
                      </span>
                    </LinkCard>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <CustomPathOffer topic={q} />
          )
        ) : null}

        {/* ── The catalogue ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-10">
          <SectionHead
            step={q ? "02" : "01"}
            label="Subjects"
            title="Every subject we cover"
            icon={<GridIcon />}
          />
          {/*
           * Grouped by §7.1's branch. The catalogue is the one marketing screen
           * whose *shape* is part of what it communicates: "is there anything
           * here for me" is answered by the headings, before a single card is
           * read. Ungrouped, seven subjects read as a list and sixty would read
           * as a wall.
           *
           * The group heading carries its own count. Three of the five branches
           * hold one subject, so their row was a card and two-thirds of nothing
           * — which reads as a layout that broke rather than as a branch that
           * is small. A count says it was meant.
           */}
          {groupByCategory(topics).map(({ category, topics: inGroup }) => (
            <section key={category.slug} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1 border-t border-hairline pt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <h3 className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {category.name}
                  </h3>
                  <Meta>
                    {inGroup.length} subject{inGroup.length === 1 ? "" : "s"}
                  </Meta>
                </div>
                <Meta>{category.blurb}</Meta>
              </div>
              <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
                {inGroup.map((topic, i) => (
                  <li key={topic.slug} className="reveal" style={revealAt(i)}>
                    <SubjectCard topic={topic} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        {/* ── Where the graded work lives ────────────────────────────────── */}
        {/*
         * What replaced twenty-two unlabelled cards.
         *
         * The briefs are the strongest thing the product owns, and listing them
         * here did them no favours: a title and a criteria count, twice, on two
         * pages, with the page that has room to explain them one click away.
         * This says what they are, counts them, and hands the reader over.
         */}
        <section className="flex flex-col gap-8">
          <SectionHead
            step={q ? "03" : "02"}
            label="Graded projects"
            title="Work that gets marked, not ticked"
            icon={<ChecklistIcon />}
          />
          <Card className="settle flex flex-col items-start gap-6 p-7 sm:p-9">
            <Lead>
              Every subject ends in something you make — a memo, a query, a
              photograph — and every one of them comes with the checklist it
              will be marked against, published before you start.
            </Lead>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-hairline pt-5 w-full">
              <Meta>{projects.length} briefs</Meta>
              <Meta>across {subjectCount} subjects</Meta>
              <Meta>every checklist public</Meta>
            </div>
            <Link
              href="/projects"
              className="min-h-[var(--touch-min)] inline-flex items-center rounded-[var(--radius-control)] bg-accent px-5 font-[550] text-on-accent transition-opacity duration-[var(--dur-fast)] hover:opacity-90"
            >
              Read the briefs
            </Link>
          </Card>
        </section>

        {/* ── And if it is not here ──────────────────────────────────────── */}
        {/*
         * The one accent field on this page, and it is the closing offer rather
         * than anything in the catalogue — because this is the single moment
         * `/learn` asks the reader for something, and a page with no change of
         * ground anywhere reads as one long column however well it is grouped.
         *
         * It escapes `PageFrame`'s column with a negative margin rather than
         * living outside `<main>`: a cosmetic background is not worth pulling
         * content out of the main landmark for.
         */}
        <section className="-mx-6 flex flex-col gap-8 bg-accent-weak px-6 py-14 sm:rounded-[var(--radius-card)] sm:px-10">
          <SectionHead
            step={q ? "04" : "03"}
            label="Anything else"
            title="Ask for a subject nobody has written"
            icon={<PenIcon />}
            onField
          />
          <Lead className="text-ink-muted">
            The list above is what exists today, not what you can learn. Tell us
            what you want to be able to do, and we write the skills, the
            questions and the checklist — about three minutes.
          </Lead>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href={CUSTOM_PATH_HREF}
              className="min-h-[var(--touch-min)] inline-flex items-center rounded-[var(--radius-control)] bg-accent px-5 font-[550] text-on-accent transition-opacity duration-[var(--dur-fast)] hover:opacity-90"
            >
              Ask for a subject
            </Link>
            {/* §8.5.4 — `--ink-faint` measures 4.15:1 on the accent field, under
                the 4.5:1 bar 13px text is held to, so meta here steps up. */}
            <Meta tone="muted" className="max-w-[var(--measure)]">
              It arrives labelled{" "}
              <strong className="font-[650] text-ink">Experimental</strong> until
              a person has read it, so you always know which you are looking at.
            </Meta>
          </div>
        </section>
      </PageFrame>
    </>
  );
}
