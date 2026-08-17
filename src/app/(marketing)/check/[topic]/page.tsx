import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  CheckStartOffer,
  EvalTierNote,
  JsonLdScript,
  PageFrame,
  SectionHead,
} from "@/components/marketing";
import { ChecklistIcon, SubjectIcon } from "@/components/icons";
import {
  Button,
  DisplayTitle,
  Lead,
  Meta,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import {
  BAND_COPY,
  MarkingScreen,
  QuestionScreen,
  SelfMarkScreen,
} from "@/components/check-screens";
import { findPack, isCheckIndexable, topicSummary } from "@/lib/content";
import {
  CHECK_MINUTES,
  DEFAULT_BUDGET,
  isComplete,
  selectNextItem,
  summarise,
} from "@/lib/engine/diagnostic";
import { breadcrumbs, quiz, type JsonLd } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";
import { subjectInProse } from "@/lib/subject-name";
import { cookieFor, narrow } from "@/lib/check/run";
import { decode, readableAnswerKey, replay } from "@/lib/check/session";
import {
  continueAfterMarking,
  startCheck,
  submitAnswer,
  submitSelfMark,
} from "./actions";

/**
 * §24 E4 — the Skill Check, running.
 *
 * One route, five states: intro, question, marking, self-mark, result. Every
 * transition is a plain form POST to a Server Action, which Next progressively
 * enhances — so the whole thing works with JavaScript disabled and adds nothing
 * to the marketing bundle (§8.5.8, §13.3).
 *
 * *Marking* and *self-mark* are the same moment answered two ways: §14.2's
 * Assessment Agent marked the written answer, or it could not and the learner
 * marks it themselves. The second was the only one that existed for six passes
 * and is still what a missing key, an exhausted daily budget or a failed call
 * degrades to (`lib/check/mark.ts`).
 *
 * **Indexable on its own gate — `isCheckIndexable`, not the subject page's.**
 * §12.1's bar is usefulness to a stranger arriving from search, and this page
 * clears it whoever authored the graph: the check runs, it takes ten minutes,
 * and it needs no account. That is §12.1 rule 2's "working tool", and it is why
 * a Standard pack's check is submitted while its `/learn` page is not.
 *
 * The sentence that used to sit here pointed at a constant named
 * `SKILL_CHECKS_ARE_NEVER_INDEXED`, which stopped existing when the per-skill
 * page was built and indexed. A comment describing a rule the code no longer
 * holds is worse than none — it is the reason the subject check itself sat out
 * of the index for two passes after E4 shipped.
 *
 * `force-dynamic` and indexable is not a contradiction — the page is rendered on
 * the server either way, and a crawler arrives with no cookie and so is served
 * the intro, which is the state worth ranking. What it costs is the ISR cache,
 * and the page cannot have one: it renders four different screens at one URL off
 * a cookie, and a cached first question would be someone else's.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ topic: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { topic } = await params;
  const pack = findPack(topic);
  if (!pack) return {};

  return marketingMetadata({
    title: `${pack.name} — skill check`,
    description: `A ten-minute check across ${pack.skills.length} skills in ${subjectInProse(pack.name)}. The questions change based on your answers.`,
    path: `/check/${topic}`,
    // The check's own gate, not the subject page's — this page is the working
    // tool §12.1 rule 2 asks for, and what it does for a visitor does not depend
    // on who authored the graph. `sitemap.ts` uses the same function, and the
    // robots tag and the sitemap disagreeing is the one thing that must not
    // happen: a URL submitted for crawling that tells the crawler to go away.
    indexable: isCheckIndexable(pack),
  });
}

function toEngine(topic: string) {
  const pack = findPack(topic);
  if (!pack) notFound();

  return { pack, ...narrow(pack, { topic }) };
}

/* ── Screens ────────────────────────────────────────────────────────────── */

export default async function CheckRunPage({ params }: Params) {
  const { topic } = await params;
  const ref = { topic };
  const { pack, skills, items } = toEngine(topic);

  const jar = await cookies();
  const cookie = decode(jar.get(cookieFor(ref))?.value);
  const now = new Date().toISOString();
  const state = replay(cookie, skills, items, now);

  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Learn", path: "/learn" },
    { name: pack.name, path: `/learn/${topic}` },
    { name: "Skill check", path: `/check/${topic}` },
  ];

  /*
   * §8.5.9's one documented exception to the max-w-5xl frame: this is a task,
   * not a document. One question at a time, nothing else on screen — a wide
   * column here would be actively worse (§8.5.1, one idea per screen).
   */
  const shell = (children: React.ReactNode, blocks: JsonLd[] = []) => (
    <>
      {/* §13.3 — BreadcrumbList everywhere, paired with the visible trail
          PageFrame draws. This page had the trail and not the markup. */}
      <JsonLdScript blocks={[breadcrumbs(crumbs), ...blocks]} />
      <PageFrame crumbs={crumbs} narrow className="gap-10">
        {children}
      </PageFrame>
    </>
  );

  /* ── Intro ───────────────────────────────────────────────────────────── */
  if (!cookie.s) {
    return shell(
      <>
        <div className="rise flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
            <SubjectIcon taxonomyParent={pack.taxonomyParent} />
          </span>
          <DisplayTitle>{pack.name} — skill check</DisplayTitle>
        </div>
        <Lead className="rise" style={stagger(1)}>
          About {DEFAULT_BUDGET} questions, {CHECK_MINUTES} minutes, no account.
          The questions change based on your answers, so it covers as much of
          the subject as it can.
        </Lead>
        <div
          className="rise flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-raised)]"
          style={stagger(2)}
        >
          <Title>What it can and cannot tell you</Title>
          {/*
            No count of markable questions here any more. It used to say "5 of
            the 33 can be marked automatically", which was true of closed items
            and is now true of nearly all of them — and a number that has to be
            re-explained the moment a marker is unavailable is worse than the
            rule it stands for. The rule is the last sentence, and it has not
            changed.
          */}
          <Meta>
            Written answers are marked against what the skill asks for, and
            those count. If we can&rsquo;t mark one, you&rsquo;ll mark it
            yourself against a model answer, and the result says which is which.
            That is useful practice, but{" "}
            <strong>marking your own work never counts as proof</strong>. For
            that, you hand in a project.
          </Meta>
          {/* The summary's tier, not the pack's: `topicSummary` caps it at
              what the evaluator can honour, and this page reaching past it for
              the declared number is the exact bug that had /check promising
              tier 1's "we run your work" on a build with no sandbox. */}
          <EvalTierNote tier={topicSummary(pack).evalTier} />
        </div>
        <form action={startCheck.bind(null, ref)}>
          <Button type="submit">Start the check</Button>
        </form>
      </>,
      // Only on the intro. It is the state a crawler is served, and it is the
      // only state where the three facts the markup states are on the screen.
      [quiz(topicSummary(pack), DEFAULT_BUDGET, CHECK_MINUTES)],
    );
  }

  /* ── Marked, and waiting to be read ──────────────────────────────────── */
  /*
   * Ahead of the result deliberately. A graded answer can be the one that
   * finishes the check, and showing the result over the top of it would throw
   * away the only per-answer feedback a visitor gets for free.
   */
  if (cookie.m) {
    const marked = items.find((i) => i.slug === cookie.m!.i);
    if (!marked) redirect(`/check/${topic}`);

    return shell(
      <MarkingScreen
        prompt={marked.prompt}
        marked={cookie.m}
        asked={state.asked.length}
        budget={DEFAULT_BUDGET}
        action={continueAfterMarking.bind(null, ref)}
      />,
    );
  }

  /* ── Result ──────────────────────────────────────────────────────────── */
  if (isComplete(state, items)) {
    const summary = summarise(state, skills, now);

    return shell(
      <>
        <DisplayTitle>Your result</DisplayTitle>
        <Lead>
          {summary.assessedCount === 0
            ? "None of these could be marked automatically, so nothing here counts yet."
            : `We marked ${summary.assessedCount} of ${skills.length} skills automatically. The rest are still unknown.`}
        </Lead>

        <ul className="flex list-none flex-col gap-0 p-0 m-0 rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-raised)] overflow-hidden">
          {summary.verdicts.map((verdict, i) => (
            <li
              key={verdict.skillSlug}
              className="rise flex items-center justify-between gap-4 border-b border-hairline px-5 py-4 last:border-b-0"
              style={stagger(i)}
            >
              <Link
                href={`/check/${topic}/${verdict.skillSlug}`}
                className="font-[550] hover:text-accent"
              >
                {verdict.name}
              </Link>
              <Status tone={BAND_COPY[verdict.band].tone}>
                {BAND_COPY[verdict.band].text}
              </Status>
            </li>
          ))}
        </ul>

        {/* The intro already explained that self-marked answers do not count,
            and the self-mark screen says it again at the moment it matters.
            Here the reader only needs to know why those skills are missing
            from the list above — not to be told a third time. */}
        {summary.selfMarkedCount > 0 ? (
          <Meta>
            You marked {summary.selfMarkedCount} answer
            {summary.selfMarkedCount === 1 ? "" : "s"} yourself, so those are
            not in the list above.
          </Meta>
        ) : null}

        <SectionHead
          step="Next"
          label="What to do about it"
          title={
            summary.gaps.length > 0
              ? `${summary.gaps.length} skills to work on`
              : "Prove it on real work"
          }
          icon={<ChecklistIcon />}
        />
        <Lead>
          A check narrows things down. It cannot prove you can do the work.
          Only doing the work can.
        </Lead>
        <div className="flex flex-wrap gap-4">
          <Link href={`/learn/${topic}`} className="text-accent font-[550]">
            See the whole skill map
          </Link>
          <Link href="/projects" className="text-accent font-[550]">
            Look at a graded project
          </Link>
        </div>

        {/* The ten minutes they just spent already seed a plan, and until now
            this screen ended without saying so — three sideways links and a
            "start again", on the one page where the reader has proved they
            want the subject. */}
        <CheckStartOffer topicName={pack.name} />

        <form action={startCheck.bind(null, ref)}>
          <Button type="submit" variant="text">
            Start again
          </Button>
        </form>
      </>,
    );
  }

  /* ── Self-mark, with the key revealed ────────────────────────────────── */
  if (cookie.p) {
    const item = items.find((i) => i.slug === cookie.p!.i);
    if (!item) redirect(`/check/${topic}`);

    return shell(
      <SelfMarkScreen
        prompt={item.prompt}
        response={cookie.p.r}
        concepts={readableAnswerKey(item)}
        asked={state.asked.length}
        budget={DEFAULT_BUDGET}
        action={submitSelfMark.bind(null, ref)}
      />,
    );
  }

  /* ── Question ────────────────────────────────────────────────────────── */
  return shell(
    <QuestionScreen
      item={selectNextItem(state, items)!}
      asked={state.asked.length}
      budget={DEFAULT_BUDGET}
      action={submitAnswer.bind(null, ref)}
    />,
  );
}
