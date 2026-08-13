import type { Metadata } from "next";
import Link from "next/link";
import { SubjectIcon } from "@/components/icons";
import {
  Breadcrumbs,
  EvalTierNote,
  GoalSearch,
  JsonLdScript,
} from "@/components/marketing";
import {
  DisplayTitle,
  EmptyState,
  Lead,
  MaturityBadge,
  Meta,
  Title,
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

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-16">
        <Breadcrumbs
          crumbs={[
            { name: "Home", path: "/" },
            { name: "Learn", path: "/learn" },
          ]}
        />

        <div className="flex flex-col gap-5">
          <DisplayTitle>
            {q ? `Results for “${q}”` : "What you can learn — and prove"}
          </DisplayTitle>
          <Lead>
            A subject appears here only once it has a validated skill graph, a
            real item bank and at least one graded project behind it.
          </Lead>
        </div>

        <GoalSearch suggestions={suggestions} defaultValue={q ?? ""} />

        {q ? (
          hits.length > 0 ? (
            <section className="flex flex-col gap-4">
              <Title>{hits.length} matches</Title>
              <ul className="flex list-none flex-col gap-3 p-0 m-0">
                {hits.map((hit) => (
                  <li key={hit.href}>
                    <Link
                      href={hit.href}
                      className="flex flex-col gap-1 rounded-[var(--radius-card)] bg-surface p-5 hover:bg-accent-weak"
                    >
                      <span className="font-[550]">{hit.title}</span>
                      <Meta>
                        {hit.kind} · {hit.detail}
                      </Meta>
                    </Link>
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

        <section className="flex flex-col gap-4">
          <Title>Subjects</Title>
          <ul className="flex list-none flex-col gap-3 p-0 m-0">
            {topics.map((topic) => (
              <li key={topic.slug}>
                <Link
                  href={`/learn/${topic.slug}`}
                  className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-5 hover:bg-accent-weak"
                >
                  <span className="flex items-center gap-2.5 font-[550]">
                    <span className="text-accent">
                      <SubjectIcon taxonomyParent={topic.taxonomyParent} />
                    </span>
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
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <MaturityBadge maturity={topic.maturity} />
                    <EvalTierNote tier={topic.evalTier} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <Title>Graded projects</Title>
          <Lead>
            Each one publishes the rubric it will be marked against, before you
            start.
          </Lead>
          <ul className="flex list-none flex-col gap-3 p-0 m-0">
            {projects.map((project) => (
              <li key={project.slug}>
                <Link
                  href={`/projects/${project.slug}`}
                  className="flex flex-col gap-1 rounded-[var(--radius-card)] bg-surface p-5 hover:bg-accent-weak"
                >
                  <span className="font-[550]">{project.title}</span>
                  <Meta>
                    {project.rubricDetail.criteria.length} criteria ·{" "}
                    {project.estimatedMinutes} min
                  </Meta>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
