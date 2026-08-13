import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Breadcrumbs,
  EvalTierNote,
  JsonLdScript,
} from "@/components/marketing";
import {
  Card,
  DisplayTitle,
  Lead,
  Meta,
  Status,
  Title,
} from "@/components/ui";
import { allProjects, findProject } from "@/lib/content";
import { breadcrumbs, howTo } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

/**
 * §10 B — a graded project brief with its public rubric.
 *
 * This is the strongest page type the product has: it is a tool and unique
 * data rather than an article, which is what keeps it clear of the
 * scaled-content exposure §12 is written about. And §4.2 law 2 makes it a
 * product requirement, not a marketing choice — "every rubric is public before
 * the work is done."
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

  return {
    title: project.title,
    description: `A graded ${project.topicName} project marked against ${project.rubricDetail.criteria.length} published criteria. Read the rubric before you start — about ${project.estimatedMinutes} minutes of work.`,
    alternates: { canonical: canonical(`/projects/${project.slug}`) },
    robots: project.indexable ? undefined : { index: false, follow: true },
  };
}

const BANDS = ["absent", "developing", "competent", "strong"] as const;

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

  return (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs), howTo(project)]} />

      <main className="mx-auto flex max-w-3xl flex-col gap-14 px-6 py-16">
        <Breadcrumbs crumbs={crumbs} />

        <header className="flex flex-col gap-5">
          <DisplayTitle>{project.title}</DisplayTitle>
          <Lead>{project.brief}</Lead>
          <div className="flex flex-wrap items-center gap-6">
            <Meta>~{project.estimatedMinutes} minutes</Meta>
            <Meta>Evidence: {project.evidenceType}</Meta>
            <EvalTierNote tier={project.evalTier} />
          </div>
        </header>

        <section className="flex flex-col gap-4">
          <Title>Done means</Title>
          <ul className="flex list-none flex-col gap-3 p-0 m-0">
            {project.acceptanceCriteria.map((criterion) => (
              <li key={criterion} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2 inline-block size-2 shrink-0 rounded-full bg-accent"
                />
                <span className="max-w-[var(--measure)]">{criterion}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── The rubric, in full, before the work ───────────────────────── */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Title>How it will be graded</Title>
            <Lead>
              This is the actual rubric. Your submission is scored against each
              criterion, and every score has to quote your work as evidence.
            </Lead>
          </div>

          {project.rubricDetail.criteria.map((criterion) => (
            <Card key={criterion.id} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-[length:var(--text-title-size)] font-semibold">
                  {criterion.name}
                </span>
                <Meta>{Math.round(criterion.weight * 100)}% of the grade</Meta>
              </div>
              <p className="max-w-[var(--measure)] text-ink-muted">
                {criterion.description}
              </p>

              <dl className="flex flex-col gap-3 m-0">
                {BANDS.map((band) => (
                  <div key={band} className="flex flex-col gap-1">
                    <dt>
                      <Status
                        tone={
                          band === "strong"
                            ? "verified"
                            : band === "competent"
                              ? "verified"
                              : band === "developing"
                                ? "attention"
                                : "problem"
                        }
                      >
                        {band}
                      </Status>
                    </dt>
                    <dd className="m-0 max-w-[var(--measure)] text-ink-muted">
                      {criterion.bands[band]}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </section>

        <section className="flex flex-col gap-4">
          <Title>What this proves</Title>
          <Lead>
            Passing this moves these skills in your mastery ledger — with this
            submission attached as the evidence.
          </Lead>
          <ul className="flex list-none flex-col gap-2 p-0 m-0">
            {project.skills.map((skill) => (
              <li key={skill.slug}>
                <Link
                  href={`/check/${project.topicSlug}/${skill.slug}`}
                  className="flex flex-col gap-1 rounded-[var(--radius-card)] bg-surface p-4 hover:bg-accent-weak"
                >
                  <span className="font-[550]">{skill.name}</span>
                  <span className="text-ink-muted">{skill.canDoStatement}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
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
        </section>
      </main>
    </>
  );
}
