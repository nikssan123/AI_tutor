import type { Metadata } from "next";
import { ChecklistIcon } from "@/components/icons";
import {
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import { LinkCard, Meta, stagger } from "@/components/ui";
import { allProjects } from "@/lib/content";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "Graded projects, and the checklists behind them",
  description:
    "Real project briefs, each with the full checklist it will be marked against. You read the checklist first, then you do the work.",
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
      <PageFrame crumbs={crumbs}>
        <PageIntro
          icon={<ChecklistIcon />}
          title="Graded projects"
          lead="Each brief comes with the checklist it will be marked against. You read it before you start, so you always know what you are aiming at."
          facts={
            <>
              <Meta>{projects.length} briefs</Meta>
              <Meta>
                {new Set(projects.map((p) => p.topicName)).size} subjects
              </Meta>
              <Meta>Every checklist public</Meta>
            </>
          }
        />

        <section className="flex flex-col gap-8">
          <SectionHead
            step="01"
            label="The briefs"
            title="Pick something you would really have to do"
            icon={<ChecklistIcon />}
          />

          <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 lg:grid-cols-2">
            {projects.map((project, i) => (
              <li key={project.slug} className="rise" style={stagger(i)}>
                <LinkCard href={`/projects/${project.slug}`} className="gap-4 p-6">
                  <Meta>{project.topicName}</Meta>
                  <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {project.title}
                  </span>
                  <span className="text-[length:var(--text-label-size)] text-ink-muted">
                    {project.brief.slice(0, 160)}
                    {project.brief.length > 160 ? "…" : ""}
                  </span>
                  <span className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-hairline pt-4">
                    <Meta>
                      {project.rubricDetail.criteria.length} criteria
                    </Meta>
                    <Meta>{project.estimatedMinutes} min</Meta>
                    <Meta>Evidence: {project.evidenceType}</Meta>
                  </span>
                </LinkCard>
              </li>
            ))}
          </ul>
        </section>
      </PageFrame>
    </>
  );
}
