import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudienceBody } from "@/components/audience-body";
import {
  ChecklistIcon,
  GridIcon,
  MasteryIcon,
  StepsIcon,
  SubjectIcon,
} from "@/components/icons";
import {
  EvalTierNote,
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
  TopicStartOffer,
} from "@/components/marketing";
import {
  LinkCard,
  MaturityBadge,
  Meta,
  revealAt,
} from "@/components/ui";
import { allAudiences, audienceDetail, audiencesForTopic } from "@/lib/audiences";
import {
  allPacks,
  findPack,
  projectDetails,
  skillDetails,
  topicSummary,
} from "@/lib/content";
import type { DomainPack } from "@/lib/packs/types";
import { allGuides } from "@/lib/guides";
import { guidesForSubject } from "@/lib/guides/links";
import { ROADMAP_TOOL_PATH } from "@/lib/roadmap/plan";
import { breadcrumbs, course } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";
import { subjectInProse } from "@/lib/subject-name";

/** §13.3 — generateStaticParams + ISR for every marketing route. */
export const revalidate = 86_400;

/**
 * Two page types share this segment, because §13.2 gives them one URL space:
 * `/learn/{topic}` and `/learn/{topic}-for-{audience}`, both flat, both
 * self-canonical. Nesting the second under `/learn/{topic}/for/{audience}`
 * would have kept the routes apart at the cost of the slug the page is *for* —
 * "sql for product managers" is the query, and a URL is allowed to look like
 * one.
 *
 * The two cannot collide: an audience slug must contain `-for-`, and the loader
 * refuses one that matches a pack.
 */
export function generateStaticParams() {
  return [
    ...allPacks().map((pack) => ({ topic: pack.slug })),
    ...allAudiences().map((audience) => ({ topic: audience.slug })),
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;

  const audience = audienceDetail(topic);
  if (audience) {
    return marketingMetadata({
      title: audience.path.audience.title,
      description: audience.path.audience.description,
      path: `/learn/${topic}`,
      indexable: audience.indexable,
    });
  }

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

export default async function LearnPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;

  const audience = audienceDetail(topic);
  if (audience) return <AudienceBody detail={audience} />;

  const pack = findPack(topic);
  if (!pack) notFound();

  return <TopicPage pack={pack} />;
}

function TopicPage({ pack }: { pack: DomainPack }) {
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
  const guides = guidesForSubject(pack.slug, allGuides());
  const audiences = audiencesForTopic(pack.slug);

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
            is exactly that. One card, four figures, no chrome per figure.

            The figures count themselves in left to right as the card crosses
            the fold — a row on a vertical timeline, which is the case
            `revealAt` exists for (§8.5.6's marketing amendment). */}
        <div className="grid grid-cols-2 gap-6 rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-raised)] sm:grid-cols-4">
          {[
            ["Skills", String(summary.skillCount)],
            ["Graded projects", String(summary.projectCount)],
            ["Estimated hours", `~${summary.totalHours}`],
            ["Areas", String(areas.length)],
          ].map(([label, value], i) => (
            <div
              key={label}
              className="reveal flex flex-col gap-1"
              style={revealAt(i)}
            >
              <span className="text-[length:var(--text-display-size)] font-[650] leading-none tracking-[var(--text-display-tracking)] text-accent">
                {value}
              </span>
              <Meta>{label}</Meta>
            </div>
          ))}
        </div>

        {/*
         * The one number the four figures above cannot give: how long ~47 hours
         * is *for you*. §11 item 3 asks every page like this one for "a
         * realistic time estimate with an explicit range and stated
         * assumptions", and the honest version of that depends on a pace only
         * the reader knows — so it links to the tool that asks for one rather
         * than printing a week count nobody's week matches.
         *
         * The parameterised URL is deliberate: it is `noindex, follow` at the
         * other end (§13.3), so this passes a reader through without asking
         * Google to rank a view.
         */}
        <Meta className="max-w-[var(--measure)]">
          {summary.totalHours} hours is a number, not a plan.{" "}
          <Link
            href={`${ROADMAP_TOOL_PATH}?subject=${pack.slug}`}
            className="font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
          >
            Lay it out week by week
          </Link>{" "}
          at the hours you actually have.
        </Meta>

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
                    <li key={skill.slug} className="reveal" style={revealAt(i)}>
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
              <li key={project.slug} className="reveal" style={revealAt(i)}>
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

        {/* ── 03 Arriving with something already ───────────────────────────
            §10 C's pages, and the subject page is where they are found. It is
            also the inbound link their own gate counts (§13.3's ≥2 rule), which
            is why every cut is listed and not only the published ones — a list
            that quietly dropped the drafts would make that count measure
            itself. A draft says so on its own page, in the badge under its
            title. */}
        {audiences.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step="03"
              label="Already know some of this"
              title="The shorter route in"
              icon={<MasteryIcon />}
            />
            <Meta>
              What we would skip for somebody arriving from a particular job,
              what only looks familiar, and what it takes off the estimate.
            </Meta>
            <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2">
              {audiences.map((audience, i) => (
                <li key={audience.slug} className="reveal" style={revealAt(i)}>
                  <LinkCard href={`/learn/${audience.slug}`}>
                    <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                      {audience.h1}
                    </span>
                    <Meta className="mt-auto">
                      {audience.credited} of {audience.skillCount} skills you
                      may already have
                    </Meta>
                  </LinkCard>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── 04 The questions asked before the course ─────────────────────
            §13.3's internal-link rule from the other side. A guide earns this
            link by quoting this subject's real figures — that reference is the
            evidence it is genuinely about this subject, so nobody authors a
            link table and no guide can add itself here by asserting relevance.
            It is also where §13.3's "≥2 inbound" comes from for the guides:
            without it they could only link to each other, which is a ring, not
            a graph. */}
        {guides.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step={audiences.length > 0 ? "04" : "03"}
              label="Before you start"
              title="Questions people ask about this"
              icon={<StepsIcon />}
            />
            <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2">
              {guides.map((guide, i) => (
                <li key={guide.slug} className="reveal" style={revealAt(i)}>
                  <LinkCard href={`/guides/${guide.slug}`}>
                    <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                      {guide.h1}
                    </span>
                  </LinkCard>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <TopicStartOffer topicName={pack.name} />

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
