import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubjectIcon } from "@/components/icons";
import {
  Breadcrumbs,
  EvalTierNote,
  JsonLdScript,
} from "@/components/marketing";
import {
  Card,
  DisplayTitle,
  Lead,
  MaturityBadge,
  Meta,
  Title,
} from "@/components/ui";
import {
  allPacks,
  findPack,
  projectDetails,
  skillDetails,
  topicSummary,
} from "@/lib/content";
import { breadcrumbs, course } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

/** §13.3 — generateStaticParams + ISR for every marketing route. */
export const revalidate = 86_400;

export function generateStaticParams() {
  return allPacks().map((pack) => ({ topic: pack.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;
  const pack = findPack(topic);
  if (!pack) return {};

  const summary = topicSummary(pack);

  return {
    // §13.3 — title ≤60 characters, description 140–160.
    title: `${pack.name}: ${summary.skillCount} skills, graded`,
    description: `A validated ${summary.skillCount}-skill path for ${pack.name.toLowerCase()}, with ${summary.projectCount} graded projects and published rubrics. Roughly ${summary.totalHours} hours of real work.`,
    alternates: { canonical: canonical(`/learn/${pack.slug}`) },
    // §12.1 — a page earns indexing; it is never granted by default.
    robots: summary.indexable
      ? undefined
      : { index: false, follow: true },
  };
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const pack = findPack(topic);
  if (!pack) notFound();

  const summary = topicSummary(pack);
  const skills = skillDetails(pack);
  const projects = projectDetails(pack);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Learn", path: "/learn" },
    { name: pack.name, path: `/learn/${pack.slug}` },
  ];

  // Group by area so the page reads as a curriculum rather than a list of 26.
  const areas = [...new Set(skills.map((s) => s.area))];

  return (
    <>
      <JsonLdScript
        blocks={[
          breadcrumbs(crumbs),
          // §13.3 — Course markup "only where a real structured curriculum
          // exists", which is exactly what a validated pack is.
          ...(summary.indexable ? [course(summary, skills)] : []),
        ]}
      />

      <main className="mx-auto flex max-w-3xl flex-col gap-14 px-6 py-16">
        <Breadcrumbs crumbs={crumbs} />

        <header className="flex flex-col gap-5">
          <span className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
              <SubjectIcon taxonomyParent={pack.taxonomyParent} />
            </span>
            <DisplayTitle>{pack.name}</DisplayTitle>
          </span>
          <Lead>
            {summary.skillCount} skills across {areas.length} areas, ordered by
            what depends on what. {summary.projectCount} of them end in work that
            gets graded against a published rubric.
          </Lead>
          <div className="flex flex-wrap items-center gap-6">
            <MaturityBadge maturity={summary.maturity} />
            <EvalTierNote tier={summary.evalTier} />
          </div>
          {/* The whole point of a skill map is to find out where you are on it,
              so the entry into the check sits above the map rather than under it. */}
          <Link
            href={`/check/${pack.slug}`}
            className="inline-flex min-h-[var(--touch-min)] w-full items-center justify-center rounded-[var(--radius-control)] bg-accent px-6 text-[length:var(--text-label-size)] font-[550] text-white hover:opacity-90 sm:w-auto"
          >
            Take the skill check — about 10 minutes
          </Link>
        </header>

        <Card className="flex flex-wrap gap-x-12 gap-y-4">
          {[
            ["Skills", String(summary.skillCount)],
            ["Graded projects", String(summary.projectCount)],
            ["Estimated hours", `~${summary.totalHours}`],
            ["Areas", String(areas.length)],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <Meta>{label}</Meta>
              <span className="text-[length:var(--text-title-size)] font-semibold">
                {value}
              </span>
            </div>
          ))}
        </Card>

        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <Title>What you&rsquo;ll be able to do</Title>
            <Meta>
              Each line is a capability statement — the thing your work has to
              demonstrate before the skill counts as mastered.
            </Meta>
          </div>

          {areas.map((area) => (
            <div key={area} className="flex flex-col gap-3">
              <Meta>{area.replace(/-/g, " ")}</Meta>
              <ul className="flex list-none flex-col gap-2 p-0 m-0">
                {skills
                  .filter((s) => s.area === area)
                  .map((skill) => (
                    <li key={skill.slug}>
                      <Link
                        href={`/check/${pack.slug}/${skill.slug}`}
                        className="flex flex-col gap-1 rounded-[var(--radius-card)] bg-surface p-4 hover:bg-accent-weak"
                      >
                        <span className="font-[550]">{skill.name}</span>
                        <span className="text-ink-muted">
                          {skill.canDoStatement}
                        </span>
                        <Meta>
                          {skill.level} · ~{skill.estimatedHours}h
                          {skill.hardPrerequisites.length > 0
                            ? ` · needs ${skill.hardPrerequisites.length} earlier skill${skill.hardPrerequisites.length === 1 ? "" : "s"}`
                            : " · no prerequisites"}
                        </Meta>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-4">
          <Title>The graded work</Title>
          <Lead>
            The rubric is published before you start. That makes the verdict
            trustworthy and any disagreement productive.
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
                    {project.estimatedMinutes} min · targets{" "}
                    {project.skills.length} skills
                  </Meta>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {!summary.indexable ? (
          <Meta>
            This pack has not been through human review yet, so it is served but
            not submitted for search indexing.
          </Meta>
        ) : null}
      </main>
    </>
  );
}
