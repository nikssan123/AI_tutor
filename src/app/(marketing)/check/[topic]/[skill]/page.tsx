import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ChecklistIcon, GridIcon, StepsIcon } from "@/components/icons";
import {
  EvalTierNote,
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import {
  BAND_COPY,
  MarkingScreen,
  QuestionScreen,
  SelfMarkScreen,
} from "@/components/check-screens";
import {
  Button,
  DisplayTitle,
  Lead,
  LinkCard,
  Meta,
  stagger,
  Status,
} from "@/components/ui";
import { findSkill, isTopicIndexable, skillDetails } from "@/lib/content";
import {
  budgetFor,
  cookieFor,
  narrow,
  scopeFor,
  type CheckRef,
} from "@/lib/check/run";
import { decode, readableAnswerKey, replay } from "@/lib/check/session";
import {
  bandFor,
  isComplete,
  selectNextItem,
  settled,
} from "@/lib/engine/diagnostic";
import { effectiveMastery } from "@/lib/engine/bkt";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";
import {
  continueAfterMarking,
  startCheck,
  submitAnswer,
  submitSelfMark,
} from "../actions";

/**
 * §10 A — the interactive Skill Check, for one skill.
 *
 * **This page was an apology for two epics.** It described a skill, said "you
 * cannot check this skill on its own yet", and was held out of the index
 * because §12 forbids publishing a page for a tool that does not exist. The
 * tool exists now, and it is the answer to the half of §24 E4 that the broad
 * check cannot reach.
 *
 * The arithmetic is the whole reason it is a separate page. Clearing
 * `MASTERY_TARGET` takes three to five observations on *one* skill; a
 * nine-question check across twenty-six of them can never give any single skill
 * that many, so the broad check locates a learner and cannot prove anything.
 * This one spends its entire budget on one skill and stops the moment the skill
 * is decided (`settled`), which is what "adaptive" was supposed to mean.
 *
 * So it is indexable now, on the same gate as everything else about its pack —
 * §2.6 calls the skill-assessment SERP "the crack in the wall", and this is the
 * page that answers those queries with a working assessment rather than an
 * article about one.
 *
 * `force-dynamic` for the same reason `/check/{topic}` is: five screens at one
 * URL off a cookie, and a cached first question would be someone else's. A
 * crawler arrives without one and is served the description, which is the state
 * worth ranking.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string; skill: string }>;
}): Promise<Metadata> {
  const { topic, skill } = await params;
  const found = findSkill(topic, skill);
  if (!found) return {};

  return marketingMetadata({
    // §13.3 — title ≤60 characters, description 140–160.
    title: `${found.skill.name} — skill check`,
    description: `Prove one skill: ${found.skill.canDoStatement}. A short check, marked against the same bar, no account and nothing kept afterwards.`,
    path: `/check/${topic}/${skill}`,
    indexable: isTopicIndexable(found.pack),
  });
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

  /* ── The check, when one is running ──────────────────────────────────── */
  const ref: CheckRef = { topic, skill };
  const { skills, items } = narrow(pack, ref);
  const jar = await cookies();
  const cookie = decode(jar.get(cookieFor(ref))?.value);
  const now = new Date().toISOString();
  const state = replay(cookie, skills, items, now);
  const budget = budgetFor(ref, items);
  const scope = scopeFor(pack, ref);

  /*
   * The running screens keep the narrow column (§8.5.9's task-screen exception)
   * and drop everything else on the page. One question at a time is the whole
   * point, and the prerequisites map underneath it would be an invitation to
   * go and read the answer.
   */
  const running = (children: React.ReactNode) => (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs)]} />
      <PageFrame crumbs={crumbs} narrow className="gap-10">
        {children}
      </PageFrame>
    </>
  );

  if (cookie.s && cookie.m) {
    const marked = items.find((i) => i.slug === cookie.m!.i);
    if (!marked) redirect(`/check/${topic}/${skill}`);

    return running(
      <MarkingScreen
        prompt={marked.prompt}
        marked={cookie.m}
        asked={state.asked.length}
        budget={budget}
        action={continueAfterMarking.bind(null, ref)}
      />,
    );
  }

  if (cookie.s && cookie.p) {
    const item = items.find((i) => i.slug === cookie.p!.i);
    if (!item) redirect(`/check/${topic}/${skill}`);

    return running(
      <SelfMarkScreen
        prompt={item.prompt}
        response={cookie.p.r}
        concepts={readableAnswerKey(item)}
        asked={state.asked.length}
        budget={budget}
        action={submitSelfMark.bind(null, ref)}
      />,
    );
  }

  if (cookie.s && !isComplete(state, items, budget, scope)) {
    return running(
      <QuestionScreen
        item={selectNextItem(state, items, scope)!}
        asked={state.asked.length}
        budget={budget}
        action={submitAnswer.bind(null, ref)}
        refusal={cookie.e}
      />,
    );
  }

  /* ── The result, for one skill ───────────────────────────────────────── */
  if (cookie.s) {
    const mastery = effectiveMastery(state.mastery[detail.slug]!, now);
    // Assessed means something other than the learner decided it (§7.2).
    const assessed = state.asked.some((a) => a.mode !== "self");
    const band = bandFor(mastery, assessed);
    const proved = settled(state, detail.slug) && band === "likely-known";

    return running(
      <>
        <Status tone={BAND_COPY[band].tone}>{BAND_COPY[band].text}</Status>
        <DisplayTitle>{detail.name}</DisplayTitle>

        <Lead>
          {proved
            ? `You cleared the bar on this one: you can ${detail.canDoStatement}. It counts from ${state.asked.filter((a) => a.mode !== "self").length} marked answers, and it is still not the same as doing the work.`
            : assessed
              ? "Not yet — the answers we could mark did not get there. That is a useful thing to know before you spend hours on the rest of the subject."
              : "Nothing here could be marked, so nothing counts. Answering in writing is what makes a check mean something."}
        </Lead>

        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-accent-weak p-6">
          {/* §8.5.4 — --ink-faint is under the small-text bar on this fill. */}
          <Meta tone="muted">The bar, unchanged</Meta>
          <p className="m-0 max-w-[var(--measure)] text-[length:var(--text-lead-size)] leading-[var(--text-lead-line)] text-ink">
            {detail.canDoStatement}
          </p>
        </div>

        <Meta className="max-w-[var(--measure)]">
          A check narrows things down. Only a piece of work you hand in and we
          mark can prove you can do it — which is what a{" "}
          <Link href="/projects" className="text-accent font-[550]">
            graded project
          </Link>{" "}
          is for. The whole subject is on the{" "}
          <Link href={`/check/${topic}`} className="text-accent font-[550]">
            ten-minute check
          </Link>
          .
        </Meta>

        <form action={startCheck.bind(null, ref)}>
          <Button type="submit" variant="text">
            Start again
          </Button>
        </form>
      </>,
    );
  }

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
            Where the apology used to be.

            This card said "Not ready yet — you cannot check this skill on its
            own", which was true for two epics and is the reason the page was
            held out of the index. It is the offer now, and it says what the
            check can and cannot settle before anyone starts it (§4.2 law 5).

            Unless there is nothing to ask. A skill whose questions are all
            `micro_artifact` — "photograph a scene", "cook a dish" — has a bank
            a ten-minute check cannot draw from, and offering "up to 0
            questions" behind a Start button is worse than the apology it
            replaced. That skill gets the truth and the route that does work.
          */}
          {budget > 0 ? (
            <div
              className="rise flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-raised)]"
              style={stagger(1)}
            >
              <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
                Prove it
              </span>
              <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                A check for this one skill
              </span>
              <p className="m-0 max-w-[var(--measure)] text-[length:var(--text-label-size)] text-ink-muted">
                Up to {budget} question{budget === 1 ? "" : "s"} on this skill
                alone, marked against the bar beside this. It stops as soon as
                the answer is clear. No account, and your answers are not kept.
              </p>
              <form action={startCheck.bind(null, ref)}>
                <Button type="submit">Start</Button>
              </form>
            </div>
          ) : (
            <div
              className="rise flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-raised)]"
              style={stagger(1)}
            >
              <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-attention">
                Nothing to ask yet
              </span>
              <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                This one is proved by doing it
              </span>
              <p className="m-0 max-w-[var(--measure)] text-[length:var(--text-label-size)] text-ink-muted">
                Every question written for this skill asks for a piece of work
                rather than an answer, and a short check cannot take one. The
                route that can is a{" "}
                <Link href="/projects" className="text-accent font-[550]">
                  graded project
                </Link>
                .
              </p>
            </div>
          )}
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
