import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { evaluationFor, submissionById } from "@/lib/submissions/store";
import { BAND_SCORE, type Band } from "@/lib/contracts/evaluation";
import {
  Card,
  Confidence,
  confidenceLevel,
  DisplayTitle,
  Lead,
  Meta,
  Status,
  Title,
} from "@/components/ui";

/**
 * §8 screen 9 — the evaluation result.
 *
 * The screen the whole product is for. Its job is not to deliver a number: it
 * is to show, for every criterion, the words out of the learner's own work that
 * the judgement rests on. §4.2 law 2 published the rubric before they started;
 * this is the other half of that bargain.
 */
export const metadata: Metadata = {
  title: "Your marked work",
  robots: { index: false, follow: false },
};

/** How long to wait before looking again while it is still being marked. */
const REFRESH_SECONDS = 5;

const BAND_LABEL: Record<Band, string> = {
  absent: "Not there",
  developing: "Getting there",
  competent: "Does the job",
  strong: "Does it well",
};

const BAND_TONE: Record<Band, "problem" | "attention" | "verified"> = {
  absent: "problem",
  developing: "attention",
  competent: "verified",
  strong: "verified",
};

type Props = { params: Promise<{ id: string }> };

export default async function SubmissionPage({ params }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { id } = await params;
  const db = getDb();

  // Scoped to its owner: reading someone else's marked work by guessing a UUID
  // is not a feature.
  const stored = await submissionById(db, id, session.user.id);
  if (!stored) notFound();

  const evaluation = await evaluationFor(db, id);
  const pack = await resolvePack(db, stored.packSlug);
  const project = pack?.projects.find((p) => p.slug === stored.projectSlug);

  if (!evaluation) {
    const failed = stored.status === "failed";

    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        {failed ? null : <meta httpEquiv="refresh" content={String(REFRESH_SECONDS)} />}

        <div className="rise flex flex-col gap-5">
          <DisplayTitle>
            {failed ? "We couldn’t mark this one" : "Marking your work"}
          </DisplayTitle>
          <Lead>
            {failed
              ? "Nothing has been added to your record. You can hand it in again."
              : "Two passes over what you handed in, against the rubric you read before you started. About a minute."}
          </Lead>
        </div>

        {failed ? (
          <Link
            href="/today"
            className="min-h-[var(--touch-min)] inline-flex w-fit items-center rounded-[var(--radius-control)] bg-accent px-5 font-[550] text-on-accent"
          >
            Back to today
          </Link>
        ) : (
          <Meta tone="muted">This page checks again every few seconds.</Meta>
        )}
      </main>
    );
  }

  const percent = Math.round(evaluation.overall * 100);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-4">
        <DisplayTitle>{project?.title ?? "Your marked work"}</DisplayTitle>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[length:var(--text-display-size)] font-[650] text-ink">
            {percent}%
          </span>
          {/*
            §7.2 — "confidence propagates to the UI everywhere". The number is
            never shown without what it is worth, because a tier-3 verdict at
            0.8 is not the same claim as a tier-1 one.
          */}
          <Confidence level={confidenceLevel(evaluation.confidence)} />
          <Meta tone="muted">
            Tier {evaluation.evalTier} evidence
          </Meta>
        </div>

        {stored.status === "human_review" ? (
          <Status tone="attention">
            A person is checking this one before it counts. The two passes
            disagreed, so we would rather be slow than wrong.
          </Status>
        ) : null}

        {stored.truncated ? (
          <Status tone="attention">
            Your work was longer than we can mark and was cut off, so this only
            covers the first part of it.
          </Status>
        ) : null}
      </header>

      {/* ── The criteria ─────────────────────────────────────────────────── */}
      <ol className="flex list-none flex-col gap-4 p-0 m-0">
        {evaluation.criteria.map((criterion) => (
          <li key={criterion.criterionId}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Title className="text-[length:var(--text-label-size)]">
                  {criterion.name}
                </Title>
                <Status tone={BAND_TONE[criterion.band]}>
                  {BAND_LABEL[criterion.band]}
                </Status>
              </div>

              {/*
                The quote, first and set apart. Every score on this page is
                anchored in the learner's own words — a criterion whose quote
                could not be found in the work was thrown out before it got here.
              */}
              <blockquote className="border-l-2 border-accent bg-raised px-5 py-3 whitespace-pre-wrap font-mono text-[length:var(--text-meta-size)]">
                {criterion.evidence}
              </blockquote>

              <Lead>{criterion.reasoning}</Lead>
            </Card>
          </li>
        ))}
      </ol>

      {evaluation.gaps.length > 0 ? (
        <Card className="flex flex-col gap-3">
          <Title className="text-[length:var(--text-label-size)]">
            What to fix, in order
          </Title>
          <ol className="flex flex-col gap-2 pl-5">
            {evaluation.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ol>
        </Card>
      ) : null}

      {evaluation.nextActions.length > 0 ? (
        <Card className="flex flex-col gap-3">
          <Title className="text-[length:var(--text-label-size)]">Do next</Title>
          <ul className="flex list-none flex-col gap-2 p-0 m-0">
            {evaluation.nextActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Link
        href="/today"
        className="min-h-[var(--touch-min)] inline-flex w-fit items-center rounded-[var(--radius-control)] bg-accent px-5 font-[550] text-on-accent"
      >
        Back to today
      </Link>
    </main>
  );
}

/** Kept beside the page because only this screen maps bands to a score. */
export const BAND_ORDER = Object.keys(BAND_SCORE) as Band[];
