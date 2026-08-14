import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChecklistIcon, GridIcon, StepsIcon } from "@/components/icons";
import {
  EvalTierNote,
  JsonLdScript,
  PageFrame,
  PageIntro,
  RubricLadder,
  SectionHead,
} from "@/components/marketing";
import { LinkCard, Meta, revealAt } from "@/components/ui";
import { allProjects, findProject } from "@/lib/content";
import { breadcrumbs, howTo } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * §10 B — a graded project brief with its public rubric.
 *
 * This is the strongest page type the product has: it is a tool and unique
 * data rather than an article, which is what keeps it clear of the
 * scaled-content exposure §12 is written about. And §4.2 law 2 makes it a
 * product requirement, not a marketing choice — "every rubric is public before
 * the work is done."
 *
 * §8.5.9 — the rubric section used to hand-roll its own band display, with a
 * three-deep nested ternary picking a `Status` tone per band and `problem`
 * (rose-red, the failure colour) standing in for "Absent". It now uses the same
 * `RubricLadder` the landing page does, so there is one rendering of a grading
 * standard on the site rather than two that can disagree.
 */
export const revalidate = 86_400;

export function generateStaticParams() {
  return allProjects().map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = findProject(slug);
  if (!project) return {};

  return marketingMetadata({
    title: project.title,
    description: `A ${project.topicName} project marked against ${project.rubricDetail.criteria.length} published criteria. Read the checklist before you start — about ${project.estimatedMinutes} minutes of work.`,
    path: `/projects/${project.slug}`,
    indexable: project.indexable,
  });
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = findProject(slug);
  if (!project) notFound();

  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Learn", path: "/learn" },
    { name: project.topicName, path: `/learn/${project.topicSlug}` },
    { name: project.title, path: `/projects/${project.slug}` },
  ];

  // Heaviest first: the criterion that decides the grade should be the one the
  // reader meets first, not whichever the pack author happened to type first.
  const criteria = [...project.rubricDetail.criteria].sort(
    (a, b) => b.weight - a.weight,
  );

  return (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs), howTo(project)]} />

      <PageFrame crumbs={crumbs}>
        <PageIntro
          title={project.title}
          lead={project.brief}
          facts={
            <>
              <Meta>~{project.estimatedMinutes} minutes</Meta>
              <Meta>Evidence: {project.evidenceType}</Meta>
              <EvalTierNote tier={project.evalTier} />
            </>
          }
        />

        {/* ── 01 Done means ────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-8">
          <SectionHead
            step="01"
            label="What counts as done"
            title="What you have to hand in"
            icon={<StepsIcon />}
          />
          <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2">
            {project.acceptanceCriteria.map((criterion, i) => (
              <li
                key={criterion}
                className="reveal flex items-start gap-3 rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--shadow-raised)]"
                style={revealAt(i)}
              >
                <span
                  aria-hidden="true"
                  className="mt-2 inline-block size-2 shrink-0 rounded-full bg-accent"
                />
                <span className="text-[length:var(--text-label-size)] text-ink">
                  {criterion}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── 02 The rubric, in full, before the work ──────────────────────── */}
        {/*
         * The one full-bleed accent field on this page, for the same reason the
         * landing page has one: this section *is* the product's argument, and a
         * band that changes colour is what tells a scrolling reader so.
         *
         * It escapes PageFrame's column with a negative margin rather than
         * living outside `<main>`, because the rubric is the page's primary
         * content and pulling it out of the main landmark to get a background
         * colour would be a real accessibility regression for a cosmetic win.
         */}
        <section className="-mx-6 flex flex-col gap-10 bg-accent-weak px-6 py-16 sm:rounded-[var(--radius-card)] sm:px-10">
          <SectionHead
            step="02"
            label="How it will be marked"
            title="The checklist, published before you start"
            icon={<ChecklistIcon />}
            onField
          />

          <Meta tone="muted" className="max-w-[var(--measure)]">
            We score your work against each line below, and every score has to
            quote the part of your work it is based on. You read all of it
            first, so you can argue with any score on the specifics.
          </Meta>

          {/*
           * `settle` rather than `reveal`, for the same reason the specimen on
           * `/projects` and the offer card on `/learn` use it: these are the
           * page's showcase surfaces, and they arrive as whole objects. The
           * ladder inside each one builds against its own entrance (§8.5.6's
           * marketing amendment), so what the reader gets is a card arriving
           * with its bands filling in — the standard assembling itself in the
           * order it is meant to be read, which is the one thing on this page
           * that motion can genuinely say.
           */}
          <ul className="grid list-none grid-cols-1 gap-5 p-0 m-0 lg:grid-cols-2">
            {criteria.map((criterion, i) => (
              <li
                key={criterion.id}
                className="settle rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-lifted)]"
                style={revealAt(i)}
              >
                <RubricLadder criterion={criterion} />
              </li>
            ))}
          </ul>
        </section>

        {/* ── 03 What this proves ─────────────────────────────────────────── */}
        <section className="flex flex-col gap-8">
          <SectionHead
            step="03"
            label="What this proves"
            title="The skills a pass would prove"
            icon={<GridIcon />}
          />
          <Meta>
            Pass, and these skills count as proven, with this piece of work
            attached as the evidence.
          </Meta>
          <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2">
            {project.skills.map((skill, i) => (
              <li key={skill.slug} className="reveal" style={revealAt(i)}>
                <LinkCard href={`/check/${project.topicSlug}/${skill.slug}`}>
                  <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                    {skill.name}
                  </span>
                  <span className="text-[length:var(--text-label-size)] text-ink-muted">
                    {skill.canDoStatement}
                  </span>
                </LinkCard>
              </li>
            ))}
          </ul>
        </section>

        <Meta>
          Part of{" "}
          <Link href={`/learn/${project.topicSlug}`} className="text-accent">
            {project.topicName}
          </Link>
          . See all{" "}
          <Link href="/projects" className="text-accent">
            graded projects
          </Link>
          .
        </Meta>
      </PageFrame>
    </>
  );
}
