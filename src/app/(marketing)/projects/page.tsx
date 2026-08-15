import type { Metadata } from "next";
import Link from "next/link";
import { ChecklistIcon, GridIcon } from "@/components/icons";
import {
  BriefCard,
  JsonLdScript,
  PageFrame,
  PageIntro,
  RubricLadder,
  SectionHead,
} from "@/components/marketing";
import { Meta, revealAt } from "@/components/ui";
import { allProjects, allTopics, featuredProject } from "@/lib/content";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * Every graded brief in the product.
 *
 * It was one wall: twenty-two cards, two columns, ordered by `difficulty` —
 * which is a number the reader cannot see and would not agree with if they
 * could — with each brief cut to 160 characters mid-word ("What is being
 * marked…", "separate a real projection from a s…"). Nothing on the page said
 * what a graded project *is*, so the wall was also the explanation.
 *
 * Two changes:
 *
 * 1. **It explains before it lists.** One criterion of one real rubric, in
 *    full, on the accent field. "Graded" is the word this page is selling and
 *    it means nothing until you have seen what a band actually says; §4.2 law 2
 *    published the standard, and a page that only counts criteria is throwing
 *    that away.
 * 2. **It is grouped by subject.** Which is the axis a reader has: they came
 *    from a subject, or they are deciding between subjects. Difficulty order
 *    across a flat list of twenty-two put a cooking brief between two SQL ones
 *    for a reason no visitor could reconstruct. Within a subject the briefs
 *    keep difficulty order, where it is finally legible as "easiest first".
 */
export const revalidate = 86_400;

export const metadata: Metadata = marketingMetadata({
  title: "Graded projects, and the checklists behind them",
  description:
    "Every graded brief we run, grouped by the course it belongs to, each with the full checklist it will be marked against. You read the checklist first, then you do the work.",
  path: "/projects",
});

export default function ProjectsIndexPage() {
  const projects = allProjects();
  const featured = featuredProject();
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Projects", path: "/projects" },
  ];

  // The heaviest criterion of the brief the landing page also shows. One
  // ladder, not four: §8.5.1's density rule, and the point is made by the first.
  const heaviest = [...featured.rubricDetail.criteria].sort(
    (a, b) => b.weight - a.weight,
  )[0]!;

  /*
   * Grouped by subject, in the catalogue's own order, and dropping any subject
   * with nothing to show. `allProjects` already sorts by difficulty, and
   * `filter` preserves that — so inside a group the easiest brief is first,
   * which is the one place difficulty order means something to a reader.
   */
  const bySubject = allTopics()
    .map((topic) => ({
      topic,
      briefs: projects.filter((p) => p.topicSlug === topic.slug),
    }))
    .filter((group) => group.briefs.length > 0);

  return (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs)]} />
      <PageFrame crumbs={crumbs}>
        <PageIntro
          icon={<ChecklistIcon />}
          title="Graded projects"
          lead="Every brief here belongs to a course — it is the work you hand in at the end of one, marked against the checklist below it. You read that checklist before you start, so you always know what you are aiming at, and starting a brief starts the course that gets you to it."
          facts={
            <>
              <Meta>{projects.length} briefs</Meta>
              <Meta>
                across {bySubject.length} course
                {bySubject.length === 1 ? "" : "s"}
              </Meta>
              <Meta>Every checklist public</Meta>
            </>
          }
        />

        {/* ── 01 What "graded" means here ────────────────────────────────── */}
        {/*
         * The one full-bleed accent field on this page, for the same reason the
         * landing page has one: this is the page's argument, and a band that
         * changes colour is what tells a scrolling reader so. It escapes
         * PageFrame's column with a negative margin rather than living outside
         * `<main>` — the rubric is primary content, and pulling it out of the
         * main landmark for a background colour would be a real accessibility
         * regression for a cosmetic win.
         */}
        <section className="-mx-6 flex flex-col gap-8 bg-accent-weak px-6 py-14 sm:rounded-[var(--radius-card)] sm:px-10">
          <SectionHead
            step="01"
            label="What a checklist is"
            title="One line of one real checklist"
            icon={<ChecklistIcon />}
            onField
          />

          <Meta tone="muted" className="max-w-[var(--measure)]">
            Every brief below is marked on four or five lines like this one. You
            read all of them before you start, and every score we give has to
            quote the part of your work it came from — so you can argue with any
            of it on the specifics.
          </Meta>

          <div className="settle rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-lifted)]">
            <RubricLadder criterion={heaviest} />
          </div>

          <Meta tone="muted">
            From{" "}
            <Link
              href={`/projects/${featured.slug}`}
              className="font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
            >
              {featured.title}
            </Link>
            , which publishes {featured.rubricDetail.criteria.length} of them.
          </Meta>
        </section>

        {/* ── 02 The briefs ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-10">
          <SectionHead
            step="02"
            label="The briefs"
            title="Pick something you would really have to do"
            icon={<GridIcon />}
          />

          {/* Said once here as well as on each brief, because this is the page
              where the grouping could be read as filing rather than as the
              structure it actually is. */}
          <Meta tone="muted" className="max-w-[var(--measure)]">
            Grouped by the course each one belongs to. Picking a brief picks
            that course — you get the skills it takes, in the order they build
            on each other, and the brief at the end.
          </Meta>

          {bySubject.map(({ topic, briefs }) => (
            <section key={topic.slug} className="flex flex-col gap-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-hairline pt-5">
                <h3 className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                  {topic.name}
                </h3>
                <Meta>
                  <Link
                    href={`/learn/${topic.slug}`}
                    className="text-ink-muted hover:text-accent"
                  >
                    {briefs.length} brief{briefs.length === 1 ? "" : "s"} · see
                    the course
                  </Link>
                </Meta>
              </div>

              <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 md:grid-cols-2 lg:grid-cols-3">
                {briefs.map((project, i) => (
                  <li key={project.slug} className="reveal" style={revealAt(i)}>
                    <BriefCard project={project} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      </PageFrame>
    </>
  );
}
