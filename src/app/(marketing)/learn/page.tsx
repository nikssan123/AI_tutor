import type { Metadata } from "next";
import { GridIcon, StepsIcon, SubjectIcon } from "@/components/icons";
import {
  EvalTierNote,
  GoalSearch,
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import {
  EmptyState,
  LinkCard,
  MaturityBadge,
  Meta,
  stagger,
} from "@/components/ui";
import { allProjects, allTopics, search } from "@/lib/content";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

/**
 * The `/learn` hub, and the destination of the landing page's goal input.
 *
 * §13.3 — "Site search is `noindex,follow`." A results page is not content, but
 * its links are worth crawling, so links are followed and the page is not
 * indexed. The unfiltered hub *is* indexable: it is the top of the internal
 * link graph.
 *
 * §8.5.9 — rebuilt alongside the landing page. It was a 768px column of cards
 * with no elevation, which is to say it looked like a list of links with
 * generous padding.
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

  return {
    title: "What you can learn — and prove",
    description:
      "Every subject with a validated skill graph, a real item bank and graded projects behind it. Depth is declared, never implied.",
    alternates: { canonical: canonical("/learn") },
  };
}

export default async function LearnIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const topics = allTopics();
  const projects = allProjects();
  const suggestions = [
    ...topics.map((t) => t.name),
    ...projects.map((p) => p.title),
  ];

  const hits = q ? search(q) : [];

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
          lead="A subject appears here only once it has a validated skill graph, a real item bank and at least one graded project behind it."
          action={<GoalSearch suggestions={suggestions} defaultValue={q ?? ""} />}
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
                  <li key={hit.href} className="rise" style={stagger(i)}>
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
            <EmptyState
              message={`Nothing matches “${q}” yet. The subjects below are what has a real skill graph behind it today.`}
            />
          )
        ) : null}

        <section className="flex flex-col gap-8">
          <SectionHead
            step={q ? "02" : "01"}
            label="Subjects"
            title="Everything with a skill graph behind it"
            icon={<GridIcon />}
          />
          <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic, i) => (
              <li key={topic.slug} className="rise" style={stagger(i)}>
                <LinkCard href={`/learn/${topic.slug}`} className="gap-4 p-6">
                  <span className="flex size-10 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
                    <SubjectIcon taxonomyParent={topic.taxonomyParent} />
                  </span>
                  <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {topic.name}
                  </span>
                  <Meta>
                    {topic.skillCount} skills · {topic.projectCount} graded
                    projects · about {topic.totalHours} hours ·{" "}
                    {topic.areas.length} areas
                  </Meta>
                  {/* Maturity says how deep the subject goes; the tier says
                      what the system can honestly verify about your work. A
                      card showing only the first tells half the story. */}
                  <span className="mt-auto flex flex-col gap-2 border-t border-hairline pt-4">
                    <MaturityBadge maturity={topic.maturity} />
                    <EvalTierNote tier={topic.evalTier} />
                  </span>
                </LinkCard>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-8">
          <SectionHead
            step={q ? "03" : "02"}
            label="Graded projects"
            title="Work that gets marked, not ticked"
            icon={<StepsIcon />}
          />
          <Meta>
            Each one publishes the rubric it will be marked against, before you
            start.
          </Meta>
          <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, i) => (
              <li key={project.slug} className="rise" style={stagger(i)}>
                <LinkCard href={`/projects/${project.slug}`}>
                  <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                    {project.title}
                  </span>
                  <Meta className="mt-auto">
                    {project.rubricDetail.criteria.length} criteria ·{" "}
                    {project.estimatedMinutes} min
                  </Meta>
                </LinkCard>
              </li>
            ))}
          </ul>
        </section>
      </PageFrame>
    </>
  );
}
