import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, JsonLdScript } from "@/components/marketing";
import { DisplayTitle, Lead, Meta, Title } from "@/components/ui";
import { allProjects } from "@/lib/content";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "Graded projects with published rubrics",
  description:
    "Real project briefs, each with the full rubric it will be marked against — published before you start. Read the criteria, then do the work.",
  alternates: { canonical: canonical("/projects") },
};

export default function ProjectsIndexPage() {
  const projects = allProjects();
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Projects", path: "/projects" },
  ];

  return (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs)]} />
      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-16">
        <Breadcrumbs crumbs={crumbs} />

        <div className="flex flex-col gap-5">
          <DisplayTitle>Graded projects</DisplayTitle>
          <Lead>
            Each brief publishes the rubric it will be marked against, before you
            start. That is what makes the verdict trustworthy — and what makes
            disagreeing with it productive.
          </Lead>
        </div>

        <section className="flex flex-col gap-4">
          <Title>{projects.length} briefs</Title>
          <ul className="flex list-none flex-col gap-3 p-0 m-0">
            {projects.map((project) => (
              <li key={project.slug}>
                <Link
                  href={`/projects/${project.slug}`}
                  className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-5 hover:bg-accent-weak"
                >
                  <span className="font-[550]">{project.title}</span>
                  <span className="max-w-[var(--measure)] text-ink-muted">
                    {project.brief.slice(0, 160)}
                    {project.brief.length > 160 ? "…" : ""}
                  </span>
                  <Meta>
                    {project.rubricDetail.criteria.length} criteria ·{" "}
                    {project.estimatedMinutes} min · {project.topicName}
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
