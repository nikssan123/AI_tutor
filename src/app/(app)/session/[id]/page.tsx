import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { hasApiKey } from "@/lib/ai/client";
import { requireUser } from "@/lib/account/session";
import { PLANS, resolvePlanId, type PlanId } from "@/lib/billing/catalog";
import { nudgeAt } from "@/lib/billing/gate";
import type { Nudge } from "@/lib/billing/nudge";
import { UpgradeNudge } from "@/components/upgrade-nudge";
import { sessionView } from "@/lib/session/view";
import { transcriptFor, turnsTaken } from "@/lib/session/tutor";
import type { EngineSkill, MasteryState, SessionBlock } from "@/lib/engine";
import type { BlockResponse } from "@/lib/contracts/session";
import {
  Button,
  ButtonLink,
  Card,
  cx,
  Lead,
  Meta,
  Skeleton,
  Status,
  Title,
  stagger,
} from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
import { submitWorkAction } from "@/app/(app)/submission/actions";
import { TutorPanel } from "./tutor-panel";
import { LessonBody } from "./lesson-body";
import {
  answerAction,
  continueAction,
  finishAction,
  noteAction,
  proveAction,
} from "./actions";
import { PROVE_ITEM_COUNT, proveOffer } from "@/lib/session/prove";
import type { PriorDomain } from "@/lib/contracts/goal";
import { recentSignals } from "@/lib/session/store";

/**
 * §8 screen 7 — "20–60 minutes of active learning. Never passive."
 *
 * One block at a time rather than the whole session on one page. The plan calls
 * for "visible block progress", and a scrollable wall of everything is the
 * shape that makes a session feel like reading material rather than doing work.
 *
 * Every transition is a form POST to a Server Action, so the session runs with
 * no client JavaScript. The tutor panel is the single exception and it says so.
 */
export const metadata: Metadata = {
  title: "Session",
  robots: { index: false, follow: false },
};

const BLOCK_LABEL: Record<SessionBlock["type"], string> = {
  explain: "Read",
  check: "Recall",
  apply: "Do",
  review: "Review",
  reflect: "Reflect",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function SessionPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  const db = getDb();
  const now = new Date();

  const view = await sessionView(db, user.id, id, now);
  if (!view) redirect("/today");

  const { session, block, skill } = view;
  const position = Math.min(session.blockIndex + 1, session.blocks.length);

  // `submitWorkAction` sends them back here when the month's marking is gone.
  // Loaded only on that path: a nudge costs two queries, and every other visit
  // to this screen is somebody getting on with the work.
  const quotaNudge =
    error === "quota"
      ? await nudgeAt(db, user.id, user.plan, "evaluations_spent")
      : undefined;

  // PLAN-ADAPTATION step 4. Derived on every render rather than stored: the
  // offer is a function of what the tutor heard and what the session already
  // contains, and both of those move while the page is open.
  const offer = proveOffer({
    signals: await recentSignals(db, user.id, view.goal.packSlug, now),
    block,
    blocks: session.blocks,
    pack: view.pack,
  });

  return (
    /* §8.5.9's documented exception — a session is a thing you *do*, so it
       keeps the narrow column and one block on screen at a time. */
    <AppFrame width="narrow">
      {/* The same header every other product screen opens with: the surface
          named above the title, the title, and the facts on a ruled row. It
          used to be a `Meta`, a `DisplayTitle` and the rail stacked by hand,
          which put the pack name and the block count in one run-on line and
          left the rail hanging off the bottom with nothing separating it. */}
      <AppHeader
        eyebrow={view.pack.name}
        title={
          view.finished ? "That's the session" : (skill?.name ?? "Today's session")
        }
        facts={
          <Meta>
            {view.finished
              ? "Session complete"
              : `Block ${position} of ${session.blocks.length}`}
          </Meta>
        }
        action={<BlockRail blocks={session.blocks} at={session.blockIndex} />}
      />

      {view.finished || !block ? (
        <Card className="rise flex flex-col items-start gap-5" style={stagger(1)}>
          <Lead>
            {session.completedAt
              ? "This one is already finished."
              : "You've worked through every block. Finishing writes it to your record."}
          </Lead>
          {session.completedAt ? (
            <ButtonLink href="/today">Back to today</ButtonLink>
          ) : (
            <form action={finishAction.bind(null, session.id)}>
              <Button type="submit">Finish session</Button>
            </form>
          )}
        </Card>
      ) : (
        <Card className="rise flex flex-col gap-6 p-0" style={stagger(1)}>
          {/* The block's identity, on its own strip. It used to be two spans
              floating above the content with nothing separating them from it,
              so a block read as a card that happened to start with a pill. */}
          <div className="flex items-center justify-between gap-4 border-b border-hairline px-7 py-4">
            <span className="inline-flex min-w-14 justify-center rounded-[var(--radius-pill)] bg-accent-weak px-2.5 py-1 text-[length:var(--text-meta-size)] font-[650] text-accent">
              {BLOCK_LABEL[block.type]}
            </span>
            <Meta>{block.estMinutes} min</Meta>
          </div>

          <div className="px-7 pb-7">
            <BlockBody
              block={block}
              skill={skill}
              mastery={view.mastery}
              response={view.response}
              sessionId={session.id}
              index={session.blockIndex}
              packSlug={view.goal.packSlug}
              priorDomain={view.goal.spec.priorDomain}
              userId={user.id}
              plan={resolvePlanId(user.plan)}
              now={now}
              error={error}
              quotaNudge={quotaNudge}
            />
          </div>
        </Card>
      )}

      {offer && skill ? (
        <Card className="rise flex flex-col items-start gap-4" style={stagger(2)}>
          <Title>You said you already know this</Title>
          <Lead>
            Then show us. {PROVE_ITEM_COUNT} questions on {skill.name}, the
            hardest ones in the bank.
          </Lead>
          <Meta>
            They&rsquo;re marked like everything else, and they count either way
            — which is what makes getting them right mean something. Do well and
            this comes off your path.
          </Meta>
          <form action={proveAction.bind(null, session.id)}>
            <Button type="submit" variant="text">
              Give me the questions
            </Button>
          </form>
        </Card>
      ) : null}

      <section className="rise flex flex-col gap-4" style={stagger(2)}>
        <Title>Tutor</Title>
        {hasApiKey() ? (
          <Suspense fallback={<Skeleton className="h-20" />}>
            <Tutor
              sessionId={session.id}
              userId={user.id}
              plan={resolvePlanId(user.plan)}
              /* One ask at a time: the quota nudge below is already asking. */
              quiet={quotaNudge !== undefined}
            />
          </Suspense>
        ) : (
          <Meta>The tutor is unavailable right now.</Meta>
        )}
      </section>

      <Meta>
        <Link href="/today" className="hover:underline underline-offset-4">
          Leave and come back later
        </Link>{" "}
        — your place is saved.
      </Meta>
    </AppFrame>
  );
}

/**
 * Visible block progress (§8 screen 7), as one mark per block.
 *
 * The marks share the width rather than each taking a fixed 40px, so the rail
 * reads as one bar the session moves along instead of as a row of dashes that
 * happens to get longer on a longer session.
 */
function BlockRail({
  blocks,
  at,
}: {
  blocks: SessionBlock[];
  at: number;
}) {
  return (
    <ul className="flex list-none gap-1.5 p-0 m-0" aria-hidden="true">
      {blocks.map((block, i) => (
        <li
          key={`${block.type}-${i}`}
          className={cx(
            "h-1.5 min-w-6 flex-1 rounded-[var(--radius-pill)]",
            "transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)]",
            i < at ? "bg-accent" : i === at ? "bg-accent-weak" : "bg-hairline",
          )}
        />
      ))}
    </ul>
  );
}

/**
 * The tutor, with the two numbers §14.9.7 limit 4 needs.
 *
 * The count is read here rather than in the panel because the panel is a client
 * component, and because `transcriptFor` cannot answer it: that list stops at
 * `TRANSCRIPT_DEPTH`, so a long conversation would report twenty for ever.
 */
async function Tutor({
  sessionId,
  userId,
  plan,
  quiet,
}: {
  sessionId: string;
  userId: string;
  plan: PlanId;
  quiet: boolean;
}) {
  const db = getDb();
  const [history, taken] = await Promise.all([
    transcriptFor(db, sessionId, userId),
    turnsTaken(db, sessionId, userId),
  ]);

  return (
    <TutorPanel
      sessionId={sessionId}
      initialTurns={history}
      turnsTaken={taken}
      turnLimit={PLANS[plan].entitlements.tutorTurnsPerSession}
      quiet={quiet}
    />
  );
}

interface BodyProps {
  block: SessionBlock;
  skill: EngineSkill | undefined;
  mastery: MasteryState | undefined;
  response: BlockResponse | undefined;
  sessionId: string;
  index: number;
  packSlug: string;
  priorDomain: PriorDomain;
  userId: string;
  /** §14.9.7 limit 1 — whose ceiling a generated lesson counts against. */
  plan: PlanId;
  now: Date;
  /** Why the last hand-in bounced, if it did. */
  error?: string;
  /** Shown in place of an error when the month's marking is already spent. */
  quotaNudge?: Nudge;
}

function BlockBody(props: BodyProps) {
  const { block } = props;

  switch (block.type) {
    case "explain":
      return <ExplainBlock {...props} block={block} />;
    case "check":
      return <CheckBlock {...props} block={block} />;
    case "apply":
      return <ApplyBlock {...props} block={block} />;
    case "review":
      return (
        <ContinueOnly sessionId={props.sessionId} index={props.index}>
          <Lead>{block.focus}</Lead>
        </ContinueOnly>
      );
    case "reflect":
      return <ReflectBlock {...props} block={block} />;
  }
}

function ExplainBlock(
  props: BodyProps & { block: Extract<SessionBlock, { type: "explain" }> },
) {
  return (
    <div className="flex flex-col gap-5">
      <Lead>{props.skill?.canDoStatement ?? props.block.content}</Lead>

      {/*
       * The lesson is the one thing on this page that can cost a model call, so
       * it streams in behind its own boundary. The blocks, the rail and the
       * tutor are already in the browser while it is being written.
       */}
      <Suspense fallback={<Skeleton className="h-48" />}>
        <LessonBody
          userId={props.userId}
          packSlug={props.packSlug}
          priorDomain={props.priorDomain}
          plan={props.plan}
          skill={props.skill}
          mastery={props.mastery}
          minutes={props.block.estMinutes}
          now={props.now}
          /*
           * Read off the same plan id the ceiling check uses, rather than
           * resolved separately. Two lookups of "what may this learner have"
           * on one screen is how one of them ends up a release behind the
           * other, and this one decides whether a paywall appears.
           */
          lessonsPerCourse={PLANS[props.plan].entitlements.lessonsPerCourse}
        />
      </Suspense>

      <ContinueOnly sessionId={props.sessionId} index={props.index} />
    </div>
  );
}

function CheckBlock(
  props: BodyProps & { block: Extract<SessionBlock, { type: "check" }> },
) {
  const { response } = props;

  if (response) {
    return (
      <div className="flex flex-col gap-5">
        <Lead>{props.block.prompt}</Lead>

        <div className="rounded-[var(--radius-control)] bg-raised px-5 py-4 whitespace-pre-wrap">
          {response.answer === "" ? (
            <Meta>You left this one blank.</Meta>
          ) : (
            response.answer
          )}
        </div>

        {/*
         * The verdict says which of three things happened, because they are
         * three different claims: marked and right, marked and not, or not
         * marked at all. Collapsing the third into either of the others is how
         * a product ends up claiming evidence it never had (§4.2 law 3).
         */}
        {response.correct === null ? (
          <Status tone="attention">Not marked — this one doesn&rsquo;t count</Status>
        ) : response.correct ? (
          <Status tone="verified">Marked correct</Status>
        ) : (
          <Status tone="attention">Not right yet</Status>
        )}

        {response.feedback === "" ? null : <p>{response.feedback}</p>}

        <ContinueOnly sessionId={props.sessionId} index={props.index} />
      </div>
    );
  }

  return (
    <form
      action={answerAction.bind(null, props.sessionId)}
      className="flex flex-col gap-5"
    >
      <Lead>{props.block.prompt}</Lead>
      <input type="hidden" name="block" value={props.index} />
      <textarea
        name="answer"
        rows={5}
        aria-label="Your answer"
        className="w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 py-3 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        placeholder="From memory — don't look it up"
      />
      {/* `SubmitButton`, because this press buys a model call. The form posts
          over `fetch`, so without it the box sits there with the answer still
          in it and nothing anywhere saying it went — which reads as a press
          that missed, and the second press is a second marking. */}
      <div className="flex flex-wrap items-start gap-4">
        <SubmitButton
          pendingLabel="Marking your answer"
          note="It takes a few seconds to read and mark."
        >
          Submit answer
        </SubmitButton>
        <Meta>Marked against what the question asked for, not on wording.</Meta>
      </div>
    </form>
  );
}

function ApplyBlock(
  props: BodyProps & { block: Extract<SessionBlock, { type: "apply" }> },
) {
  return (
    <div className="flex flex-col gap-5">
      <Lead>{props.block.brief}</Lead>

      <Meta>
        Do this away from the screen, in whatever you normally work in. Paste it
        back here when you are ready and it gets marked against the rubric.
      </Meta>

      {/*
        A hand-in that was nothing but whitespace. `required` does not catch it
        — a box of spaces satisfies the browser and then trims to empty — so
        without this the work appears to vanish and nothing says why.
      */}
      {props.error === "empty" ? (
        <Status tone="attention">
          There was nothing in the box to mark. Paste your work in and hand it
          in again.
        </Status>
      ) : null}

      {/*
        The month's marking is spent, so the box below will not do anything.
        Said as an offer rather than as an error, because unlike the empty-box
        case there is nothing for the learner to correct — the only thing that
        changes the outcome is a bigger plan or the 1st of the month.
      */}
      {props.quotaNudge ? <UpgradeNudge nudge={props.quotaNudge} /> : null}

      {/* §24 E8. A form POST, so handing work in needs no JavaScript either. */}
      <form action={submitWorkAction} className="flex flex-col gap-3">
        <input type="hidden" name="skill" value={props.block.skillId} />
        <input type="hidden" name="rubric" value={props.block.rubricId ?? ""} />
        <input
          type="hidden"
          name="returnTo"
          value={`/session/${props.sessionId}`}
        />

        <label htmlFor="work" className="sr-only">
          What you made
        </label>
        <textarea
          id="work"
          name="work"
          rows={10}
          required
          placeholder="Paste your work here…"
          className="w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 py-3 font-mono text-[length:var(--text-meta-size)] text-ink placeholder:text-ink-faint focus:border-accent"
        />
        {/* The longest wait in a session — a rubric read over a whole piece of
            work — and the one where a silent press costs the most: the learner
            who thinks it missed presses again, and hands the same work in
            twice against a monthly allowance. */}
        <SubmitButton
          pendingLabel="Marking your work"
          note="Reading a whole piece of work against the rubric takes longer than a question."
        >
          Hand it in
        </SubmitButton>
      </form>

      <ContinueOnly sessionId={props.sessionId} index={props.index} label="Skip for now" />
    </div>
  );
}

function ReflectBlock(
  props: BodyProps & { block: Extract<SessionBlock, { type: "reflect" }> },
) {
  if (props.response) {
    return (
      <div className="flex flex-col gap-5">
        <Lead>{props.block.prompt}</Lead>
        <div className="rounded-[var(--radius-control)] bg-raised px-5 py-4 whitespace-pre-wrap">
          {props.response.answer === "" ? (
            <Meta>You skipped this one.</Meta>
          ) : (
            props.response.answer
          )}
        </div>
        <ContinueOnly sessionId={props.sessionId} index={props.index} />
      </div>
    );
  }

  return (
    <form
      action={noteAction.bind(null, props.sessionId)}
      className="flex flex-col gap-5"
    >
      <Lead>{props.block.prompt}</Lead>
      <input type="hidden" name="block" value={props.index} />
      <textarea
        name="answer"
        rows={4}
        aria-label="Your reflection"
        className="w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 py-3 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit">Save and continue</Button>
        <Meta>Kept for you. Not marked, and not counted as evidence.</Meta>
      </div>
    </form>
  );
}

function ContinueOnly({
  sessionId,
  index,
  label = "Continue",
  children,
}: {
  sessionId: string;
  index: number;
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <form
      action={continueAction.bind(null, sessionId)}
      className="flex flex-col gap-5"
    >
      {children}
      <input type="hidden" name="to" value={index + 1} />
      <div>
        <Button type="submit">{label}</Button>
      </div>
    </form>
  );
}
