import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { evaluationFor, submissionById } from "@/lib/submissions/store";
import { nudgeAt } from "@/lib/billing/gate";
import { UpgradeNudge } from "@/components/upgrade-nudge";
import { BAND_SCORE, type Band } from "@/lib/contracts/evaluation";
import {
  ButtonLink,
  Card,
  Confidence,
  confidenceLevel,
  Figure,
  HeroBand,
  Lead,
  Meta,
  Signal,
  Skeleton,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import {
  FAILURE_CONSEQUENCE,
  FAILURE_RETRY,
  failureCopy,
} from "@/lib/submissions/failure";
import { PollWhileMarking } from "./poll-while-marking";

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

  /*
   * §24 E8.5 — which criteria the photographs informed.
   *
   * Read off the rubric rather than off the verdict, because it is a property
   * of the criterion the learner could see before they started (§4.2 law 2) and
   * not something the grader reports about itself. And gated on a photograph
   * having actually arrived: a criterion the rubric marks from an image, on a
   * hand-in that carried none, was judged from the write-up like everything
   * else, and saying otherwise would claim we looked at something we never had.
   */
  const rubric = pack?.rubrics.find((r) => r.slug === project?.rubric);
  const fromPhotograph = new Set(
    stored.images.length === 0
      ? []
      : (rubric?.criteria ?? [])
          .filter((c) => c.marks !== "text")
          .map((c) => c.id),
  );

  if (!evaluation) {
    const failed = stored.status === "failed";
    /*
     * Every failure used to render one sentence — "We couldn't mark this one.
     * Nothing has been added to your record. You can hand it in again." — no
     * matter what had happened, because `fail` discarded the reason it was
     * handed. An empty hand-in, a brief withdrawn mid-queue and a marker that
     * fell over were indistinguishable, and one of the three made that closing
     * offer an instruction to waste a second evaluation.
     */
    const failure = failureCopy(stored.failureCause);

    return (
      /* The same frame the graded screen below uses. This waiting branch
         refreshes itself into that one, so a narrower column here was a page
         that changed width under the reader the moment marking finished. */
      <AppFrame>
        {failed ? null : (
          <>
            <PollWhileMarking seconds={REFRESH_SECONDS} />
            {/*
             * The same poll for a browser with no JavaScript. Written as raw
             * markup rather than as a `<meta>` element: React hoists metadata
             * tags into the document head, and one hoisted out of here would
             * reload the page for everybody — which is the thing being fixed.
             */}
            <noscript
              dangerouslySetInnerHTML={{
                __html: `<meta http-equiv="refresh" content="${REFRESH_SECONDS}">`,
              }}
            />
          </>
        )}

        <AppHeader
          eyebrow={failed ? "Not marked" : "Marking"}
          title={failed ? failure.title : "Marking your work"}
          lead={
            failed
              ? failure.lead
              : "Two passes over what you handed in, against the rubric you read before you started. About a minute."
          }
          action={
            failed ? (
              <ButtonLink href="/today" className="w-auto">
                Back to today
              </ButtonLink>
            ) : null
          }
        />

        {failed ? (
          /* What it means for their account, which is the same whatever went
             wrong, and the invitation to retry only where retrying is not a
             waste of an evaluation. */
          <Meta tone="muted">
            {FAILURE_CONSEQUENCE}
            {failure.canRetry ? ` ${FAILURE_RETRY}` : ""}
          </Meta>
        ) : null}

        {failed ? null : (
          <Card className="rise flex flex-col gap-4" style={stagger(1)}>
            {/* §8.5.5 — a skeleton matching the final layout, never a spinner.
                What lands here is one card per criterion, so that is what the
                wait looks like. */}
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-20" />
            <Skeleton className="h-5 w-64" />
            <Meta tone="muted">This page checks again every few seconds.</Meta>
          </Card>
        )}
      </AppFrame>
    );
  }

  const percent = Math.round(evaluation.overall * 100);

  const nudge = await nudgeAt(
    db,
    session.user.id,
    session.user.plan,
    "evaluation_landed",
  );

  return (
    <AppFrame>
      <AppHeader
        eyebrow="Marked work"
        title={project?.title ?? "Your marked work"}
      />

      {/*
       * The verdict, alone on the accent field, in the shape `/today` uses.
       * This is the screen the whole product is for and the grade used to sit
       * in a row of loose spans under the title, at the same weight as the tier
       * note beside it.
       */}
      <HeroBand
        className="rise"
        style={stagger(1)}
        field={
          <>
            <Figure
              value={`${percent}%`}
              caption="against the rubric you could read before you started"
            />

            {/*
              §7.2 — "confidence propagates to the UI everywhere". The number is
              never shown without what it is worth, because a tier-3 verdict at
              0.8 is not the same claim as a tier-1 one.
            */}
            <div className="flex flex-col items-start gap-2">
              <Confidence level={confidenceLevel(evaluation.confidence)} />
              <Meta tone="muted">Tier {evaluation.evalTier} evidence</Meta>
            </div>
          </>
        }
      />

      {/*
        Two caveats on the verdict above, and both were mis-drawn in the same
        way: §8.5.5's `Status` is "a dot plus a word", and each of these was a
        two-clause sentence wearing one — a dot, then 14px of running prose
        floating between two bands with no surface under it. A qualification on
        the number the whole product exists to produce is not a status; it is
        the reason that number is not yet what it looks like.

        Only ever one at a time in practice, and if both fired they would be
        saying different things about the same verdict, which is exactly when a
        reader needs them separated rather than run together.
      */}
      {stored.status === "human_review" ? (
        <Signal
          tone="attention"
          live
          state="With a person"
          title="This one doesn’t count yet"
        >
          <Lead>
            The two passes disagreed, so somebody is checking it before it goes
            on your record. We would rather be slow than wrong.
          </Lead>
        </Signal>
      ) : null}

      {stored.truncated ? (
        <Signal
          tone="attention"
          state="Partly marked"
          title="We only marked the first part of this"
        >
          <Lead>
            Your work was longer than we can mark in one go and was cut off, so
            the verdict above covers the beginning of it and not the rest.
          </Lead>
        </Signal>
      ) : null}

      {/* ── The criteria ─────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead label="The marking" title="Criterion by criterion" />

        <ol className="flex list-none flex-col gap-4 p-0 m-0">
          {evaluation.criteria.map((criterion, i) => (
            <li key={criterion.criterionId}>
              <Card
                className="rise flex flex-col gap-4"
                style={stagger(i + 3)}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Title>{criterion.name}</Title>
                  <Status tone={BAND_TONE[criterion.band]}>
                    {BAND_LABEL[criterion.band]}
                  </Status>
                </div>

                {/*
                  The quote, first and set apart. Every score on this page is
                  anchored in the learner's own words — a criterion whose quote
                  could not be found in the work was thrown out before it got
                  here.

                  Set in the sans face: §8.5.5 bans monospace outside code
                  artefacts, and this quotes whatever the learner handed in,
                  which is as often a paragraph as a function.
                */}
                <blockquote className="m-0 border-l-2 border-accent bg-raised px-5 py-4 whitespace-pre-wrap text-[length:var(--text-label-size)] text-ink">
                  {criterion.evidence}
                </blockquote>

                {/*
                  Under the quote, not beside the band, because it qualifies
                  what the judgement rests on rather than what it was. The quote
                  is still from the written method — §14.5's check is an exact
                  string match and a photograph has no text spans — so this says
                  the picture was *also* read, which is the true and weaker
                  claim (§4.2 law 3).
                */}
                {fromPhotograph.has(criterion.criterionId) ? (
                  <Meta tone="muted">
                    Read against{" "}
                    {stored.images.length === 1
                      ? "your photograph"
                      : "your photographs"}{" "}
                    as well as your words.
                  </Meta>
                ) : null}

                <Lead>{criterion.reasoning}</Lead>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* ── What to do about it ──────────────────────────────────────────── */}
      {evaluation.gaps.length > 0 || evaluation.nextActions.length > 0 ? (
        <section className="rise flex flex-col gap-6" style={stagger(4)}>
          <SectionHead label="From here" title="What to do about it" />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {evaluation.gaps.length > 0 ? (
              <Card className="flex h-full flex-col gap-4">
                <Title>What to fix, in order</Title>
                <ol className="m-0 flex flex-col gap-2 pl-5">
                  {evaluation.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ol>
              </Card>
            ) : null}

            {evaluation.nextActions.length > 0 ? (
              <Card className="flex h-full flex-col gap-4">
                <Title>Do next</Title>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {evaluation.nextActions.map((action) => (
                    <li key={action} className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-accent"
                      />
                      {action}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        </section>
      ) : null}

      {/*
        The one moment in the product worth interrupting.

        §19.3 calls the first graded submission the activation event and calls
        everything before it "preamble" — so this is the only screen where a
        learner has first-hand evidence of the thing no competitor does, and the
        ask is "more of what you just had" rather than "trust us".

        It appears *after* the verdict and its evidence, never above them:
        somebody reading their own marked work should finish reading it. And
        `nudgeAt` returns nothing unless this was their last one, so a learner
        with allowance left is simply told nothing.
      */}
      {nudge ? <UpgradeNudge nudge={nudge} /> : null}

      <ButtonLink href="/today" className="w-auto">
        Back to today
      </ButtonLink>
    </AppFrame>
  );
}

/** Kept beside the page because only this screen maps bands to a score. */
export const BAND_ORDER = Object.keys(BAND_SCORE) as Band[];
