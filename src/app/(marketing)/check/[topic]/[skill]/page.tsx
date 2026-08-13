import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Breadcrumbs,
  EvalTierNote,
  JsonLdScript,
} from "@/components/marketing";
import { Card, DisplayTitle, Lead, Meta, Title } from "@/components/ui";
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

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-16">
        <Breadcrumbs crumbs={crumbs} />

        <header className="flex flex-col gap-5">
          <DisplayTitle>{detail.name}</DisplayTitle>
          <Lead>{detail.description}</Lead>
          <div className="flex flex-wrap items-center gap-6">
            <Meta>{detail.level}</Meta>
            <Meta>~{detail.estimatedHours}h</Meta>
            <EvalTierNote tier={detail.evalTier} />
          </div>
        </header>

        <Card className="flex flex-col gap-3">
          <Title>What counts as knowing this</Title>
          <p className="max-w-[var(--measure)] text-[length:var(--text-lead-size)]">
            {detail.canDoStatement}
          </p>
          <Meta>
            That sentence is the bar. Mastery only moves when your work
            demonstrates it — reading about it does not count.
          </Meta>
        </Card>

        {/*
          Honest about state rather than a fake "coming soon" CTA. §4.2 law 5:
          declared limits are a feature, and a disabled button pretending to be
          a product is the overclaiming the whole positioning rejects.
        */}
        <Card className="flex flex-col gap-3">
          <Title>The check itself</Title>
          <p className="max-w-[var(--measure)] text-ink-muted">
            The adaptive assessment for this skill is built but not yet wired up
            — it needs the diagnostic engine, which is the next piece of work.
            The item bank behind it already exists: {detail.itemCount} question
            {detail.itemCount === 1 ? "" : "s"} written and validated for this
            skill.
          </p>
          <Meta>
            This page is served but kept out of search until the check runs. A
            page that promises a tool it does not have is the thing we are trying
            not to build.
          </Meta>
        </Card>

        {detail.hardPrerequisites.length > 0 ? (
          <section className="flex flex-col gap-3">
            <Title>You&rsquo;ll need these first</Title>
            <ul className="flex list-none flex-col gap-2 p-0 m-0">
              {detail.hardPrerequisites.map((slug) => (
                <li key={slug}>
                  <Link
                    href={`/check/${pack.slug}/${slug}`}
                    className="block rounded-[var(--radius-card)] bg-surface p-4 hover:bg-accent-weak"
                  >
                    {name(slug)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="flex flex-col gap-2">
            <Title>Where it sits</Title>
            <Meta>
              No prerequisites — this is a starting point in {pack.name}.
            </Meta>
          </section>
        )}

        {detail.softPrerequisites.length > 0 ? (
          <section className="flex flex-col gap-3">
            <Title>Helpful, but not required</Title>
            <ul className="flex list-none flex-col gap-2 p-0 m-0">
              {detail.softPrerequisites.map((slug) => (
                <li key={slug}>
                  <Link
                    href={`/check/${pack.slug}/${slug}`}
                    className="block rounded-[var(--radius-card)] bg-surface p-4 hover:bg-accent-weak"
                  >
                    {name(slug)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {detail.unlocks.length > 0 ? (
          <section className="flex flex-col gap-3">
            <Title>What it unlocks</Title>
            <ul className="flex list-none flex-col gap-2 p-0 m-0">
              {detail.unlocks.map((slug) => (
                <li key={slug}>
                  <Link
                    href={`/check/${pack.slug}/${slug}`}
                    className="block rounded-[var(--radius-card)] bg-surface p-4 hover:bg-accent-weak"
                  >
                    {name(slug)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Meta>
          Part of{" "}
          <Link href={`/learn/${pack.slug}`} className="text-accent">
            {pack.name}
          </Link>
          .
        </Meta>
      </main>
    </>
  );
}
