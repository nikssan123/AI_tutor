import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { EvalTierNote, PageFrame, SectionHead } from "@/components/marketing";
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
import { CHECKS_ARE_NEVER_INDEXED, findPack } from "@/lib/content";
import {
  DEFAULT_BUDGET,
  isComplete,
  selectNextItem,
  summarise,
} from "@/lib/engine/diagnostic";
import {
  cookieName,
  decode,
  needsSelfMark,
  readableAnswerKey,
  replay,
  toDiagnostic,
} from "@/lib/check/session";
import { startCheck, submitAnswer, submitSelfMark } from "./actions";
import { canonical } from "@/lib/site";

/**
 * §24 E4 — the Skill Check, running.
 *
 * One route, four states: intro, question, self-mark, result. Every transition
 * is a plain form POST to a Server Action, which Next progressively enhances —
 * so the whole thing works with JavaScript disabled and adds nothing to the
 * marketing bundle (§8.5.8, §13.3).
 *
 * Never indexed. §12.1 — a page earns indexing by being useful to a stranger
 * arriving from search, and a half-finished assessment is not that.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ topic: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { topic } = await params;
  const pack = findPack(topic);
  if (!pack) return {};

  return {
    title: `${pack.name} — skill check`,
    description: `A ten-minute check across ${pack.skills.length} skills in ${pack.name.toLowerCase()}. The questions change based on your answers.`,
    alternates: { canonical: canonical(`/check/${topic}`) },
    robots: CHECKS_ARE_NEVER_INDEXED,
  };
}

function toEngine(topic: string) {
  const pack = findPack(topic);
  if (!pack) notFound();

  return { pack, ...toDiagnostic(pack) };
}

/* ── Screens ────────────────────────────────────────────────────────────── */

const BAND_COPY = {
  "likely-known": { tone: "verified" as const, text: "Likely known" },
  unclear: { tone: "attention" as const, text: "Unclear" },
  gap: { tone: "problem" as const, text: "Gap" },
  "not-assessed": { tone: "neutral" as const, text: "Not assessed" },
};

export default async function CheckRunPage({ params }: Params) {
  const { topic } = await params;
  const { pack, skills, items } = toEngine(topic);

  const jar = await cookies();
  const cookie = decode(jar.get(cookieName(topic))?.value);
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
  const shell = (children: React.ReactNode) => (
    <PageFrame crumbs={crumbs} narrow className="gap-10">
      {children}
    </PageFrame>
  );

  /* ── Intro ───────────────────────────────────────────────────────────── */
  if (!cookie.s) {
    const closed = items.filter((i) => i.type === "mcq").length;
    return shell(
      <>
        <div className="rise flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
            <SubjectIcon taxonomyParent={pack.taxonomyParent} />
          </span>
          <DisplayTitle>{pack.name} — skill check</DisplayTitle>
        </div>
        <Lead className="rise" style={stagger(1)}>
          About {DEFAULT_BUDGET} questions, ten minutes, no account. The
          questions change based on your answers, so it covers as much of the
          subject as it can.
        </Lead>
        <div
          className="rise flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-raised)]"
          style={stagger(2)}
        >
          <Title>What it can and cannot tell you</Title>
          <Meta>
            {closed} of the {items.length} questions in this subject can be
            marked automatically, and those count. You mark the rest yourself
            against a model answer. That is useful practice, but{" "}
            <strong>marking your own work never counts as proof</strong>. For
            that, you hand in a project.
          </Meta>
          <EvalTierNote tier={pack.evalTier} />
        </div>
        <form action={startCheck.bind(null, topic)}>
          <Button type="submit">Start the check</Button>
        </form>
      </>,
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

        <form action={startCheck.bind(null, topic)}>
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

    const key = readableAnswerKey(item);

    return shell(
      <>
        <Meta>
          Question {state.asked.length + 1} of {DEFAULT_BUDGET} · mark your own
          answer
        </Meta>
        <Title>{item.prompt}</Title>

        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-raised)]">
          <Meta>What you wrote</Meta>
          <p className="whitespace-pre-wrap m-0">
            {cookie.p.r || "(left blank)"}
          </p>
        </div>

        <div className="rise flex flex-col gap-2 rounded-[var(--radius-card)] bg-accent-weak p-6">
          {/* §8.5.4 — --ink-faint is under the small-text bar on this fill. */}
          <Meta tone="muted">A good answer covers</Meta>
          <ul className="flex list-disc flex-col gap-1 pl-5 m-0">
            {key.map((concept) => (
              <li key={concept}>{concept}</li>
            ))}
          </ul>
        </div>

        <form action={submitSelfMark.bind(null, topic)} className="flex gap-3">
          <Button type="submit" name="got" value="1">
            I had that
          </Button>
          <Button type="submit" name="got" value="0" variant="text">
            I did not
          </Button>
        </form>

        <Meta>Either way, this does not count. It is practice.</Meta>
      </>,
    );
  }

  /* ── Question ────────────────────────────────────────────────────────── */
  const item = selectNextItem(state, items)!;
  const closed = !needsSelfMark(item);

  return shell(
    <>
      <Meta>
        Question {state.asked.length + 1} of {DEFAULT_BUDGET}
        {closed ? " · marked automatically" : " · you will mark this one yourself"}
      </Meta>
      <Title>{item.prompt}</Title>

      <form action={submitAnswer.bind(null, topic)} className="flex flex-col gap-5">
        <input type="hidden" name="item" value={item.slug} />

        {closed ? (
          <ul className="flex list-none flex-col gap-0 p-0 m-0 rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-raised)] overflow-hidden">
            {/* The validator rejects any mcq with fewer than two options. */}
            {item.options!.map((option, i) => (
              <li
                key={option}
                className="rise border-b border-hairline last:border-b-0 hover:bg-accent-weak"
                style={stagger(i)}
              >
                <label className="flex cursor-pointer items-center gap-3 px-5 py-4">
                  <input
                    type="radio"
                    name="response"
                    value={String(i)}
                    required
                    className="accent-[var(--color-accent)]"
                  />
                  {option}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <textarea
            name="response"
            rows={6}
            placeholder="Your answer"
            className="rounded-[var(--radius-control)] border border-hairline bg-surface p-4 text-ink placeholder:text-ink-faint"
          />
        )}

        <div>
          <Button type="submit">
            {closed ? "Answer" : "Show me a good answer"}
          </Button>
        </div>
      </form>
    </>,
  );
}
