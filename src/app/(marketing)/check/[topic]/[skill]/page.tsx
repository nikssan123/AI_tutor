import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChecklistIcon, GridIcon, StepsIcon } from "@/components/icons";
import {
  EvalTierNote,
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import { LinkCard, Meta, stagger } from "@/components/ui";
import {
  allPacks,
  CHECKS_ARE_NEVER_INDEXED,
  findSkill,
  skillDetails,
} from "@/lib/content";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

/**
 * §10 A — the interactive Skill Check.
 *
 * **Deliberately `noindex` in this build.** §2.6 identified the skill-assessment
 * SERP as "the crack in the wall", but the thing that would earn the ranking is
 * the working adaptive assessment, and that is E4/E11. Publishing the shell now
 * would be precisely the thin-content pattern §12 exists to prevent — so the
 * page is served, honest about its state, and kept out of the index until the
 * tool behind it is real.
 */
export const revalidate = 86_400;

export function generateStaticParams() {
  return allPacks().flatMap((pack) =>
    pack.skills.map((skill) => ({ topic: pack.slug, skill: skill.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string; skill: string }>;
}): Promise<Metadata> {
  const { topic, skill } = await params;
  const found = findSkill(topic, skill);
  if (!found) return {};

  return {
    title: `${found.skill.name} — skill check`,
    description: found.skill.canDoStatement,
    alternates: { canonical: canonical(`/check/${topic}/${skill}`) },
    robots: CHECKS_ARE_NEVER_INDEXED,
  };
}

/** The three graph relations, rendered identically because they are the same
 *  shape of information — only the heading and the reason differ. */
function SkillLinks({
  packSlug,
  slugs,
  name,
}: {
  packSlug: string;
  slugs: string[];
  name: (slug: string) => string;
}) {
  return (
    <ul className="grid list-none grid-cols-1 gap-3 p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
      {slugs.map((slug, i) => (
        <li key={slug} className="rise" style={stagger(i)}>
          <LinkCard href={`/check/${packSlug}/${slug}`} className="p-4">
            <span className="text-[length:var(--text-label-size)] font-[550] text-ink">
              {name(slug)}
            </span>
          </LinkCard>
        </li>
      ))}
    </ul>
  );
}

export default async function CheckPage({
  params,
}: {
  params: Promise<{ topic: string; skill: string }>;
}) {
  const { topic, skill } = await params;
  const found = findSkill(topic, skill);
  if (!found) notFound();

  const { pack, skill: detail } = found;
  const byslug = new Map(skillDetails(pack).map((s) => [s.slug, s]));
  const name = (slug: string) => byslug.get(slug)!.name;

  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Learn", path: "/learn" },
    { name: pack.name, path: `/learn/${pack.slug}` },
    { name: detail.name, path: `/check/${pack.slug}/${detail.slug}` },
  ];

  return (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs)]} />

      <PageFrame crumbs={crumbs}>
        <PageIntro
          title={detail.name}
          lead={detail.description}
          facts={
            <>
              <Meta>{detail.level}</Meta>
              <Meta>~{detail.estimatedHours}h</Meta>
              <EvalTierNote tier={detail.evalTier} />
            </>
          }
        />

        {/*
         * The bar and the honest state of the tool, side by side. These are the
         * two things a visitor actually needs from this page, and stacking them
         * as two full-width cards made the second look like an afterthought.
         */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div
            className="rise flex flex-col gap-3 rounded-[var(--radius-card)] bg-accent-weak p-7"
            style={stagger(0)}
          >
            <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
              The bar
            </span>
            <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
              What counts as knowing this
            </span>
            <p className="m-0 max-w-[var(--measure)] text-[length:var(--text-lead-size)] leading-[var(--text-lead-line)] text-ink">
              {detail.canDoStatement}
            </p>
            {/* §8.5.4 — --ink-faint is under the 4.5:1 bar on the accent field. */}
            <Meta tone="muted">
              That sentence is the bar. It only counts once your work shows you
              can do it. Reading about it does not.
            </Meta>
          </div>

          {/*
            Honest about state rather than a fake "coming soon" CTA. §4.2 law 5:
            declared limits are a feature, and a disabled button pretending to
            be a product is the overclaiming the whole positioning rejects.

            The claim here used to be that the check "needs the diagnostic
            engine, which is the next piece of work" — written before E4 landed
            and left behind by it. The engine exists and `/check/[topic]` runs
            on it; what is still missing is a check you can take for one skill
            on its own.
          */}
          <div
            className="rise flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-raised)]"
            style={stagger(1)}
          >
            <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-attention">
              Not ready yet
            </span>
            <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
              A check for this one skill
            </span>
            <p className="m-0 max-w-[var(--measure)] text-[length:var(--text-label-size)] text-ink-muted">
              You cannot check this skill on its own yet. The ten-minute check
              for {pack.name} covers it along with the rest. We have written{" "}
              {detail.itemCount} question{detail.itemCount === 1 ? "" : "s"} for
              this skill so far.
            </p>
            <Meta className="mt-auto">
              This page stays out of search results until you can check this
              skill on its own.
            </Meta>
          </div>
        </div>

        {detail.hardPrerequisites.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step="01"
              label="Prerequisites"
              title="You'll need these first"
              icon={<StepsIcon />}
            />
            <SkillLinks
              packSlug={pack.slug}
              slugs={detail.hardPrerequisites}
              name={name}
            />
          </section>
        ) : (
          <section className="flex flex-col gap-4">
            <SectionHead
              step="01"
              label="Prerequisites"
              title="Where it sits"
              icon={<StepsIcon />}
            />
            <Meta>
              No prerequisites — this is a starting point in {pack.name}.
            </Meta>
          </section>
        )}

        {detail.softPrerequisites.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step="02"
              label="Also helpful"
              title="Helpful, but not required"
              icon={<GridIcon />}
            />
            <SkillLinks
              packSlug={pack.slug}
              slugs={detail.softPrerequisites}
              name={name}
            />
          </section>
        ) : null}

        {detail.unlocks.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step="03"
              label="What comes next"
              title="What it unlocks"
              icon={<ChecklistIcon />}
            />
            <SkillLinks
              packSlug={pack.slug}
              slugs={detail.unlocks}
              name={name}
            />
          </section>
        ) : null}

        <Meta>
          Part of{" "}
          <Link href={`/learn/${pack.slug}`} className="text-accent">
            {pack.name}
          </Link>
          .
        </Meta>
      </PageFrame>
    </>
  );
}
