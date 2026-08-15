import Link from "next/link";
import { Prose, Sources } from "@/components/guide-body";
import {
  ChecklistIcon,
  GridIcon,
  MasteryIcon,
  StepsIcon,
  TickIcon,
} from "@/components/icons";
import { JsonLdScript, PageFrame, PageIntro, SectionHead } from "@/components/marketing";
import {
  ButtonLink,
  Card,
  Lead,
  LinkCard,
  Meta,
  Status,
  Title,
  revealAt,
} from "@/components/ui";
import type { Audience, AudienceDetail } from "@/lib/audiences";
import { roadmapHref } from "@/lib/audiences/links";
import { claimGroups, type ClassifiedSkill } from "@/lib/audiences/path";
import { guideClaim } from "@/lib/claims";
import { breadcrumbs, course, faqPage } from "@/lib/seo/jsonld";

/**
 * §10 C's page, in §11's order.
 *
 * The ordering decision worth recording is what comes *first*, because it is
 * not what a conversion-shaped page would put there. Above the skills, above
 * the arithmetic, above the check, sits the list of conditions under which any
 * of this is true about the reader — and if they do not hold, the page says so
 * and sends them to the ordinary subject page.
 *
 * Every competing "X for Y people" page opens by telling the reader how much
 * they already know. This one opens by asking. That is §4.2 law 3 applied where
 * flattery would convert better, and it is also the only honest way to publish a
 * claim about somebody you have never met: state the condition, then hand them
 * the check that settles it.
 */

/** A skill, as a card that leads to the check that settles it. */
function SkillCard({
  skill,
  topicSlug,
  index,
}: {
  skill: ClassifiedSkill;
  topicSlug: string;
  index: number;
}) {
  return (
    <li className="reveal" style={revealAt(index)}>
      <LinkCard href={`/check/${topicSlug}/${skill.slug}`}>
        <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
          {skill.name}
        </span>
        <span className="text-[length:var(--text-label-size)] text-ink-muted">
          {skill.canDoStatement}
        </span>
        <Meta className="mt-auto">
          {skill.level} · ~{skill.estimatedHours}h ·{" "}
          {skill.itemCount === 1 ? "one question" : `${skill.itemCount} questions`}
        </Meta>
      </LinkCard>
    </li>
  );
}

function SkillGrid({
  skills,
  topicSlug,
}: {
  skills: ClassifiedSkill[];
  topicSlug: string;
}) {
  return (
    <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((skill, i) => (
        <SkillCard key={skill.slug} skill={skill} topicSlug={topicSlug} index={i} />
      ))}
    </ul>
  );
}

export function AudienceBody({ detail }: { detail: AudienceDetail }) {
  const { path, siblings } = detail;
  const { audience, topic } = path;
  const claim = guideClaim(audience.review.reviewKind);

  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Learn", path: "/learn" },
    { name: topic.name, path: `/learn/${topic.slug}` },
    { name: audience.title, path: `/learn/${audience.slug}` },
  ];

  const known = claimGroups(path, "known");
  const transfers = claimGroups(path, "transfers");

  // The areas the new material falls into, in graph order. Rendering eighteen
  // skills as eighteen cards would be the subject page again; what this page
  // owes the reader is the *shape* of what is left, and a link to the map.
  const areas = [...new Set(path.fresh.map((s) => s.area))];

  // Numbered section heads are assigned rather than hard-coded, because the
  // first section only exists on a page that credits the reader with something.
  let step = 0;
  const next = () => String(++step).padStart(2, "0");

  return (
    <>
      <JsonLdScript
        blocks={[
          breadcrumbs(crumbs),
          // §13.3 — `Course` only where a real structured curriculum exists.
          // This one is real *and* different from the subject page's: it
          // teaches what this reader has not been credited with, and its
          // `timeRequired` is the remaining estimate rather than the whole one.
          ...(detail.indexable
            ? [
                course(
                  {
                    ...topic,
                    slug: audience.slug,
                    name: audience.h1,
                    skillCount: path.skills.length - path.known.length,
                    projectCount: path.projects.length,
                    totalHours: path.hours.high,
                  },
                  path.skills.filter((s) => s.verdict !== "known"),
                ),
              ]
            : []),
          ...(audience.faqs.length > 0 ? [faqPage(audience.faqs)] : []),
        ]}
      />

      <PageFrame crumbs={crumbs}>
        <PageIntro
          icon={<MasteryIcon />}
          title={audience.h1}
          lead={audience.answer}
          facts={
            <>
              <Status tone={claim.tone}>{claim.label}</Status>
              <Meta>{topic.name}</Meta>
              <Meta>No signup</Meta>
            </>
          }
          action={
            <Link
              href={`/check/${topic.slug}`}
              className="inline-flex min-h-[var(--touch-min)] w-full items-center justify-center rounded-[var(--radius-control)] bg-accent px-6 text-[length:var(--text-label-size)] font-[550] text-white shadow-[var(--shadow-raised)] transition-opacity duration-[var(--dur-fast)] hover:opacity-90 sm:w-auto"
            >
              Settle it — take the check, about ten minutes
            </Link>
          }
        />

        {/* ── Who this is for ──────────────────────────────────────────────
            First, and deliberately. Everything below is conditional on it. */}
        <section className="-mx-6 flex flex-col gap-5 bg-accent-weak px-6 py-10 sm:rounded-[var(--radius-card)] sm:px-10">
          <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
            This page assumes
          </span>
          <ul className="flex max-w-[var(--measure)] list-none flex-col gap-3 p-0 m-0">
            {audience.ifYou.map((condition, i) => (
              <li
                key={condition}
                className="reveal flex items-start gap-3"
                style={revealAt(i)}
              >
                <span className="mt-0.5 shrink-0 text-accent">
                  <TickIcon />
                </span>
                <span className="text-[length:var(--text-label-size)] text-ink">
                  {condition}
                </span>
              </li>
            ))}
          </ul>
          <Meta>
            If none of that is you,{" "}
            <Link
              href={`/learn/${topic.slug}`}
              className="font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
            >
              the ordinary {topic.name} path
            </Link>{" "}
            is the better page — it assumes nothing.
          </Meta>
        </section>

        {/* ── The arithmetic ───────────────────────────────────────────────
            §8.5.5 bans a metric grid per figure; one card, four figures. */}
        <div className="grid grid-cols-2 gap-6 rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-raised)] sm:grid-cols-4">
          {[
            ["Skipped, if we are right", String(path.known.length)],
            ["Already yours, renamed", String(path.transfers.length)],
            ["New to you", String(path.fresh.length)],
            ["Hours, not " + path.hours.total, `${path.hours.low}–${path.hours.high}`],
          ].map(([label, value], i) => (
            <div key={label} className="reveal flex flex-col gap-1" style={revealAt(i)}>
              <span className="text-[length:var(--text-display-size)] font-[650] leading-none tracking-[var(--text-display-tracking)] text-accent">
                {value}
              </span>
              <Meta>{label}</Meta>
            </div>
          ))}
        </div>

        {/* §11 item 3 — "an explicit range with stated assumptions". Both
            assumptions are named here rather than left to the reader, because
            the two ends of that range are the two things this page is guessing
            about and one of them is testable in ten minutes. */}
        <Meta className="max-w-[var(--measure)]">
          The low end assumes what transfers really does transfer; the high end
          assumes none of it does. Nothing comes off for the skills we think you
          have until a check says so.{" "}
          <Link
            href={roadmapHref(topic.slug)}
            className="font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
          >
            Lay it out week by week
          </Link>{" "}
          at the hours you actually have.
        </Meta>

        {/* ── What you already have ───────────────────────────────────────── */}
        {known.length > 0 ? (
          <section className="flex flex-col gap-10">
            <SectionHead
              step={next()}
              label="What we would skip"
              title="What you already have"
              icon={<TickIcon />}
            />
            <Meta>
              Every one of these is a guess about you, and every one of them has
              a check behind it. Take the ones you doubt.
            </Meta>
            {known.map((entry) => (
              <div key={entry.claim.claim} className="flex flex-col gap-5">
                <Prose text={entry.claim.claim} sources={audience.sources} />
                <SkillGrid skills={entry.skills} topicSlug={topic.slug} />
              </div>
            ))}
          </section>
        ) : null}

        {/* ── What transfers ───────────────────────────────────────────────── */}
        {transfers.length > 0 ? (
          <section className="flex flex-col gap-10">
            <SectionHead
              step={next()}
              label="What transfers"
              title="Things you already do, under another name"
              icon={<StepsIcon />}
            />
            <Meta>
              These stay on the path. What you bring is a head start on the
              idea, not the hours — and each one has a place where the
              resemblance stops being true.
            </Meta>
            {transfers.map((entry) => (
              <div key={entry.claim.claim} className="flex flex-col gap-5">
                <Prose text={entry.claim.claim} sources={audience.sources} />
                {/* Drawn unconditionally: a `transfers` claim carries its
                    caveat in the type, so there is no absent case to guard. */}
                <div className="border-l-2 border-accent/30 pl-5">
                  <Prose text={entry.claim.note} sources={audience.sources} />
                </div>
                <SkillGrid skills={entry.skills} topicSlug={topic.slug} />
              </div>
            ))}
          </section>
        ) : null}

        {/* ── Where you start ──────────────────────────────────────────────
            Derived, not authored: everything whose prerequisites the claims
            above have satisfied. For a reader credited with nothing this is the
            graph's roots, which is the right answer for them too. */}
        <section className="flex flex-col gap-8">
          <SectionHead
            step={next()}
            label="Where you start"
            title="Open to you today"
            icon={<GridIcon />}
          />
          <Meta>
            Nothing below is waiting on anything else you have not done. This is
            read off the dependency graph, not chosen.
          </Meta>
          <SkillGrid skills={path.frontier} topicSlug={topic.slug} />
        </section>

        {/* ── What is genuinely new ────────────────────────────────────────── */}
        <section className="flex flex-col gap-8">
          <SectionHead
            step={next()}
            label="The rest"
            title="What none of this covers"
            icon={<StepsIcon />}
          />
          <ul className="flex list-none flex-col gap-4 p-0 m-0">
            {areas.map((area, i) => {
              const inArea = path.fresh.filter((s) => s.area === area);
              return (
                <li
                  key={area}
                  className="reveal flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-4"
                  style={revealAt(i)}
                >
                  <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                    {area.replace(/-/g, " ")}
                  </span>
                  <Meta>
                    {inArea.length === 1 ? "one skill" : `${inArea.length} skills`}{" "}
                    · ~{Math.round(inArea.reduce((n, s) => n + s.estimatedHours, 0))}h
                  </Meta>
                </li>
              );
            })}
          </ul>
          <Meta>
            <Link
              href={`/learn/${topic.slug}`}
              className="font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
            >
              The full skill map
            </Link>{" "}
            has every one of them, in the order they depend on each other.
          </Meta>
        </section>

        {/* ── The graded work ──────────────────────────────────────────────── */}
        {path.projects.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step={next()}
              label="The graded work"
              title="Briefs you could not hand in today"
              icon={<ChecklistIcon />}
            />
            <Meta>
              Each one targets at least one skill this page has not credited you
              with. The marking checklist is published before you start.
            </Meta>
            <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 lg:grid-cols-2">
              {path.projects.map((project, i) => (
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
        ) : null}

        {/* ── Sources ──────────────────────────────────────────────────────── */}
        {audience.sources.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step={next()}
              label="Where this comes from"
              title="Sources, and what each is worth"
              icon={<ChecklistIcon />}
            />
            <Sources sources={audience.sources} />
          </section>
        ) : null}

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        {audience.faqs.length > 0 ? (
          <section className="flex flex-col gap-8">
            <SectionHead
              step={next()}
              label="Also asked"
              title="Questions that come with this one"
              icon={<GridIcon />}
            />
            <div className="flex flex-col gap-8">
              {audience.faqs.map((faq) => (
                <div key={faq.question} className="flex max-w-[var(--measure)] flex-col gap-2">
                  <h3 className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {faq.question}
                  </h3>
                  <Prose text={faq.answer} sources={audience.sources} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── The other cuts of this subject ───────────────────────────────── */}
        {siblings.length > 0 ? (
          <section className="flex flex-col gap-6">
            <Meta>Arriving with something else</Meta>
            <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2">
              {siblings.map((sibling: Audience, i: number) => (
                <li key={sibling.slug} className="reveal" style={revealAt(i)}>
                  <LinkCard href={`/learn/${sibling.slug}`}>
                    <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                      {sibling.h1}
                    </span>
                  </LinkCard>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* §11 item 12 — the personalised CTA, which on this page type is not a
            promise of personalisation but an offer to check the one we already
            made in public. */}
        <Card className="flex flex-col items-start gap-5">
          <Title>Find out which half of this is true</Title>
          <Lead>
            Everything above is what we would assume about {audience.audience}.
            The check asks you instead — it adapts as you answer, needs no
            account, and what it settles carries into the path if you build one.
          </Lead>
          <Meta tone="muted">
            About ten minutes. Nothing is marked until you hand something in.
          </Meta>
          <ButtonLink href={`/check/${topic.slug}`}>
            Take the {topic.name} check
          </ButtonLink>
        </Card>

        {!detail.indexable ? (
          <Meta>
            Nobody has read this page yet, so treat it as a first draft.
          </Meta>
        ) : null}
      </PageFrame>
    </>
  );
}
