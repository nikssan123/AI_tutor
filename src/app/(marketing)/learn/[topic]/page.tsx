import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChecklistIcon, GridIcon, SubjectIcon } from "@/components/icons";
import {
  EvalTierNote,
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import {
  LinkCard,
  MaturityBadge,
  Meta,
  stagger,
} from "@/components/ui";
import {
  allPacks,
  findPack,
  projectDetails,
  skillDetails,
  topicSummary,
} from "@/lib/content";
import { breadcrumbs, course } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";
import { subjectInProse } from "@/lib/subject-name";

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

  return marketingMetadata({
    // §13.3 — title ≤60 characters, description 140–160.
    title: `${pack.name}: ${summary.skillCount} skills, graded`,
    description: `A ${summary.skillCount}-skill path for ${subjectInProse(pack.name)}, with ${summary.projectCount} marked projects and the checklist behind each one. Roughly ${summary.totalHours} hours of real work.`,
    path: `/learn/${pack.slug}`,
    // §12.1 — a page earns indexing; it is never granted by default.
    indexable: summary.indexable,
  });
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

      <PageFrame crumbs={crumbs}>
        <PageIntro
          icon={<SubjectIcon taxonomyParent={pack.taxonomyParent} />}
          title={pack.name}
          lead={`${summary.skillCount} skills across ${areas.length} areas, in the order you need to learn them. ${summary.projectCount} of them end in work you hand in and we mark.`}
          facts={
            <>
              <MaturityBadge maturity={summary.maturity} />
              <EvalTierNote tier={summary.evalTier} />
            </>
          }
          action={
            /* The whole point of a skill map is to find out where you are on
               it, so the entry into the check sits above the map, not under. */
            <Link
              href={`/check/${pack.slug}`}
              className="inline-flex min-h-[var(--touch-min)] w-full items-center justify-center rounded-[var(--radius-control)] bg-accent px-6 text-[length:var(--text-label-size)] font-[550] text-white shadow-[var(--shadow-raised)] transition-opacity duration-[var(--dur-fast)] hover:opacity-90 sm:w-auto"
            >
              Take the skill check — about 10 minutes
            </Link>
          }
        />

        {/* §8.5.5 bans dense metric grids, and four numbers on separate cards
            is exactly that. One card, four figures, no chrome per figure. */}
        <div className="grid grid-cols-2 gap-6 rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-raised)] sm:grid-cols-4">
          {[
            ["Skills", String(summary.skillCount)],
            ["Graded projects", String(summary.projectCount)],
            ["Estimated hours", `~${summary.totalHours}`],
            ["Areas", String(areas.length)],
          ].map(([label, value], i) => (
            <div key={label} className="rise flex flex-col gap-1" style={stagger(i)}>
              <span className="text-[length:var(--text-display-size)] font-[650] leading-none tracking-[var(--text-display-tracking)] text-accent">
                {value}
              </span>
              <Meta>{label}</Meta>
            </div>
          ))}
        </div>

        {/* ── 01 The skill map ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-10">
          <SectionHead
            step="01"
            label="The skill map"
            title="What you'll be able to do"
            icon={<GridIcon />}
          />
          <Meta>
            Each line says what you have to be able to do before the skill
            counts as learned.
          </Meta>

          {areas.map((area) => (
            <div key={area} className="flex flex-col gap-4">
              <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
                {area.replace(/-/g, " ")}
              </span>
              <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
                {skills
                  .filter((s) => s.area === area)
                  .map((skill, i) => (
                    <li key={skill.slug} className="rise" style={stagger(i)}>
                      <LinkCard href={`/check/${pack.slug}/${skill.slug}`}>
                        <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                          {skill.name}
                        </span>
                        <span className="text-[length:var(--text-label-size)] text-ink-muted">
                          {skill.canDoStatement}
                        </span>
                        <Meta className="mt-auto">
                          {skill.level} · ~{skill.estimatedHours}h
                          {skill.hardPrerequisites.length > 0
                            ? ` · needs ${skill.hardPrerequisites.length} earlier skill${skill.hardPrerequisites.length === 1 ? "" : "s"}`
                            : " · no prerequisites"}
                        </Meta>
                      </LinkCard>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>

        {/* ── 02 The graded work ───────────────────────────────────────────── */}
        <section className="flex flex-col gap-8">
          <SectionHead
            step="02"
            label="The graded work"
            title="Where the proof comes from"
            icon={<ChecklistIcon />}
          />
          <Meta>
            You can read the marking checklist before you start, so you always
            know what you are aiming at.
          </Meta>
          <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 lg:grid-cols-2">
            {projects.map((project, i) => (
              <li key={project.slug} className="rise" style={stagger(i)}>
                <LinkCard href={`/projects/${project.slug}`} className="gap-4 p-6">
                  <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {project.title}
                  </span>
                  <Meta className="mt-auto">
                    {project.rubricDetail.criteria.length} criteria ·{" "}
                    {project.estimatedMinutes} min · targets{" "}
                    {project.skills.length} skills
                  </Meta>
                </LinkCard>
              </li>
            ))}
          </ul>
        </section>

        {!summary.indexable ? (
          <Meta>
            Nobody has reviewed this subject by hand yet, so treat it as a first
            draft.
          </Meta>
        ) : null}
      </PageFrame>
    </>
  );
}
