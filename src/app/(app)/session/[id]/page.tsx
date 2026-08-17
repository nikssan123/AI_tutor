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
import { TutorDock } from "./tutor-dock";
// From the plain module, never from `tutor-dock` itself: a non-component export
// of a `"use client"` module is a client-reference proxy on the server, and
// `cx()` stringifies it into the class attribute. See `dock-frame.ts`.
import {
  DOCK_INNER,
  DOCK_OUTER,
  DOCK_PANEL,
  SESSION_COLUMN,
} from "./dock-frame";
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
  searchParams: Promise<{ error?: string; block?: string }>;
};

export default async function SessionPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const { error, block: wanted } = await searchParams;
  const db = getDb();
  const now = new Date();

  const view = await sessionView(db, user.id, id, now, wanted);
  if (!view) redirect("/today");

  const { session, block, skill, viewing, lookingBack } = view;

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
  //
  // Not while looking back, and not only to save the query: the offer is about
  // the skill in hand, and appending three questions to the end of the session
  // from a page that is showing something already finished is an offer made
  // about the wrong moment.
  const offer = lookingBack
    ? undefined
    : proveOffer({
        signals: await recentSignals(db, user.id, view.goal.packSlug, now),
        block,
        blocks: session.blocks,
        pack: view.pack,
      });

  const minutes = session.blocks.reduce((sum, b) => sum + b.estMinutes, 0);

  // Everything a block needs except the block, which the two branches below
  // narrow for themselves. `index` is the block on screen, so a form on it
  // posts against the block the learner is actually looking at.
  const bodyProps = {
    skill,
    mastery: view.mastery,
    response: view.response,
    sessionId: session.id,
    index: viewing,
    packSlug: view.goal.packSlug,
    priorDomain: view.goal.spec.priorDomain,
    userId: user.id,
    plan: resolvePlanId(user.plan),
    now,
    error,
    quotaNudge,
  };

  return (
    /*
     * **One reading column, and the tutor along the bottom of it.**
     *
     * The tutor was the last section in the document, so for the whole of a
     * twelve-minute read the one thing that rescues a stuck learner was below
     * the fold. Moving it into a 22rem sticky rail fixed the reach and bought a
     * worse problem: a chat that answers a .NET question with three fenced
     * commands had 352px to do it in, and the lesson lost a third of its row to
     * pay for it — two columns competing for one 1024px row, both losing.
     *
     * A dock does not compete. At rest it is the box you type in, pinned where
     * your hands are and reachable from any scroll position; it grows upward
     * only once there is something to read, and then the answer gets the same
     * column the lesson has rather than a gutter beside it. What it costs is
     * that an open dock covers the lesson, which is the trade taken knowingly:
     * you do not read a paragraph and the answer to it in the same instant.
     */
    <AppFrame flush>
      {/*
       * The reading column, capped here rather than by the frame.
       *
       * `AppFrame` has one product width and a screen does not get to pick it,
       * which is right — and it is also not the measure. This screen is a
       * single column of prose with no cards or rails to put beside it, so
       * left-aligning a 646px paragraph in a 1024px frame would strand 378px of
       * nothing down the right of every line, and a `<pre>` (a block, stretched
       * by its flex parent) would run to the full 1024 while the prose beside it
       * stopped at 646. Capping the *content* keeps the listings and the
       * sentences agreeing on where the page ends.
       *
       * A fixed width rather than `--measure`: `--measure` is in `ch` and so
       * moves with font size, which is exactly what you want for a paragraph
       * and exactly what you do not want for the column a header, a lesson and
       * a dock all have to line up inside. `SESSION_COLUMN` is the dock's, so
       * the two cannot drift apart.
       */}
      <div className={cx("mx-auto flex w-full flex-col gap-14", SESSION_COLUMN)}>
      {/* The same header every other product screen opens with: the surface
          named above the title, the title, and the facts on a ruled row. */}
      <AppHeader
        eyebrow={view.pack.name}
        title={
          // Looking back wins over finished: the screen below is a block, so a
          // header reading "That's the session" would be titling the wrong one.
          view.finished && !lookingBack
            ? "That's the session"
            : (skill?.name ?? "Today's session")
        }
        /* The rail *is* the facts row now. It used to sit under the words
           "Block 1 of 3", which is the same fact drawn twice — and only one of
           the two drawings can tell you the block after this one is eleven
           minutes of writing code. */
        facts={
          <>
            <BlockRail
              blocks={session.blocks}
              at={session.blockIndex}
              viewing={viewing}
              sessionId={session.id}
            />
            <Meta>About {minutes} minutes</Meta>
          </>
        }
      />

      {block && lookingBack ? (
        /* Behind the cursor: the same block, shown as a record. Which branch
           runs is decided here rather than inside each block type, so there is
           one place that says what looking back means. */
        <BlockShell block={block}>
          <PastBlock {...bodyProps} block={block} />
        </BlockShell>
      ) : view.finished || !block ? (
        <Card className="rise flex flex-col items-start gap-5" style={stagger(1)}>
          <Lead>
            {session.completedAt
              ? "This one is already finished."
              : "You've worked through every block. Finishing writes it to your record."}
          </Lead>
          <div className="flex flex-wrap items-center gap-3">
            {session.completedAt ? (
              <ButtonLink href="/today">Back to today</ButtonLink>
            ) : (
              <form action={finishAction.bind(null, session.id)}>
                <Button type="submit">Finish session</Button>
              </form>
            )}
            {/* Finishing is finishing, so the way back to what was in the
                session has to be here too — otherwise the last block is the
                one thing in a session you cannot re-read. */}
            <BackLink sessionId={session.id} index={session.blocks.length} />
          </div>
        </Card>
      ) : (
        <BlockShell block={block}>
          <BlockBody {...bodyProps} block={block} />
        </BlockShell>
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

      <div className="flex flex-col gap-3">
        <Meta>
          <Link href="/today" className="hover:underline underline-offset-4">
            Leave and come back later
          </Link>{" "}
          — your place is saved.
        </Meta>

        {/* Said in the page rather than left to an empty dock. A learner who
            expects a tutor and finds nothing at the foot of the screen has been
            told the product is broken; a learner told it is unavailable has been
            told the truth. */}
        {hasApiKey() ? null : <Meta>The tutor is unavailable right now.</Meta>}
      </div>

      {/* Floor for the dock, and for the mobile bar under it.
          A spacer rather than the frame's own `pb-*`, which is why `flush` is
          set above: two competing padding utilities resolve by the order
          Tailwind emitted them rather than the order they are written, so a
          `pb-40` handed to `AppFrame` would win or lose depending on which one
          Tailwind happened to put last. A box with a height is a box with a
          height. */}
      <div aria-hidden="true" className="h-32 lg:h-20" />
      </div>

      {/* Last in the document so it is last in the tab order: it is pinned to
          the foot of the viewport, but somebody tabbing through a lesson should
          reach the Continue button before the thing that floats over it. */}
      {hasApiKey() ? (
        /* The fallback sits in exactly the dock's own frame, which is what
           `DOCK_OUTER`/`DOCK_INNER`/`DOCK_PANEL` exist for. A `null` fallback
           made the composer pop into being once the transcript query returned;
           a differently-shaped one made it jump. */
        <Suspense
          fallback={
            <div className={DOCK_OUTER}>
              <div className={DOCK_INNER}>
                <div className={cx(DOCK_PANEL, "p-3")}>
                  <Skeleton className="h-11" />
                </div>
              </div>
            </div>
          }
        >
          <Tutor
            sessionId={session.id}
            userId={user.id}
            plan={resolvePlanId(user.plan)}
            /* One ask at a time: the quota nudge is already asking. */
            quiet={quotaNudge !== undefined}
          />
        </Suspense>
      ) : null}
    </AppFrame>
  );
}

/**
 * What a block sits on — and the two answers are different.
 *
 * **A block you read is a document; a block you do is a form.** Every block
 * used to render inside the same `Card`, which is right for the second and
 * wrong for the first: a twelve-minute lesson set inside a rounded, shadowed,
 * 28px-padded box reads as *cramped*, because a box is a thing with edges and
 * three thousand pixels of prose pressed against them. Nothing about a
 * paragraph wants a container.
 *
 * So an explain block gets the page itself — a ruled header, then the lesson,
 * with the full column width and no walls. Everything else keeps the card,
 * because a textarea and a submit button on bare ground have nothing holding
 * them together, and `--ground` is also the fill every input in this design
 * uses (`FIELD_INPUT`) — a form on the page would be a field you cannot see.
 */
function BlockShell({
  block,
  children,
}: {
  block: SessionBlock;
  children: React.ReactNode;
}) {
  const header = (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex min-w-14 justify-center rounded-[var(--radius-pill)] bg-accent-weak px-2.5 py-1 text-[length:var(--text-meta-size)] font-[650] text-accent">
        {BLOCK_LABEL[block.type]}
      </span>
      <Meta>{block.estMinutes} min</Meta>
    </div>
  );

  if (block.type === "explain") {
    return (
      <article className="rise flex flex-col gap-10" style={stagger(1)}>
        <div className="border-b border-hairline pb-5">{header}</div>
        {children}
      </article>
    );
  }

  return (
    <Card flush className="rise flex flex-col gap-6" style={stagger(1)}>
      {/* The block's identity, on its own strip. It used to be two spans
          floating above the content with nothing separating them from it, so a
          block read as a card that happened to start with a pill. */}
      <div className="border-b border-hairline px-7 py-4">{header}</div>
      <div className="px-7 pb-8">{children}</div>
    </Card>
  );
}

/**
 * Visible block progress (§8 screen 7), as the list of what a session is.
 *
 * It was a row of coloured dashes sitting directly under the words "Block 1 of
 * 3", which is the same fact drawn twice and neither drawing says anything the
 * other does not. A dash cannot tell you that the thing after this one is
 * fifteen minutes of writing code, and that is exactly what somebody deciding
 * whether to start a session at 9pm wants to know.
 *
 * So it names them. One row per block: what kind of work it is, how long it
 * runs, and which of the three states it is in — behind you, the one you are
 * on, or still ahead.
 */
function BlockRail({
  blocks,
  at,
  viewing,
  sessionId,
}: {
  blocks: SessionBlock[];
  at: number;
  /** The block on screen — `at` unless the learner has gone back. */
  viewing: number;
  sessionId: string;
}) {
  return (
    <ol className="flex list-none flex-wrap items-center gap-x-5 gap-y-2 p-0 m-0">
      {blocks.map((block, i) => {
        const done = i < at;
        const now = i === at;
        const here = i === viewing;

        const label = (
          <>
            {/* The state, as a mark that differs in *shape* and not only in
                colour — §8.5.5's ban on colour-as-meaning. Filled for done,
                ringed for the one on screen, hollow for the ones ahead. */}
            <span
              aria-hidden="true"
              className={cx(
                "size-2 shrink-0 rounded-full",
                done && "bg-accent",
                here && "ring-2 ring-accent ring-offset-2 ring-offset-transparent",
                !done && !here && "border border-hairline",
              )}
            />
            <span
              className={cx(
                "text-[length:var(--text-label-size)]",
                now ? "font-[650] text-ink" : "text-ink-muted",
              )}
            >
              {BLOCK_LABEL[block.type]}
            </span>
            <Meta>{block.estMinutes} min</Meta>
          </>
        );

        return (
          <li
            key={`${block.type}-${i}`}
            aria-current={here ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {/*
             * The rail is the way back. It was already the only thing on the
             * screen that named the blocks behind you — "Read", "Recall" —
             * while being the one thing you could not press, so a learner who
             * wanted the lesson again had nowhere to go but out of the session.
             *
             * A link, not a form: going back looks at a block rather than
             * moving to it, so it costs nothing, survives a refresh and leaves
             * the browser's own Back button meaning what it should.
             *
             * Only the blocks behind the cursor. Everything ahead stays plain
             * text — a rail you could jump forward in would be a way to skip
             * the work and land on the questions.
             */}
            {done ? (
              <Link
                href={`/session/${sessionId}?block=${i}`}
                aria-label={`Go back to ${BLOCK_LABEL[block.type].toLowerCase()}, block ${i + 1}`}
                className="flex items-center gap-2 rounded-[var(--radius-control)] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                {label}
              </Link>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ol>
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
    <TutorDock
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

/**
 * A block the learner has already been through, on a screen of its own.
 *
 * **Read-only, whatever the block is.** Not a limitation to lift later: every
 * form on this page either spends something or records something against the
 * cursor, and both are wrong for a block the session has moved past. An answer
 * box would offer a marking the server would refuse (`answerAction` drops a
 * post that is not for the block in hand); a hand-in box would spend a second
 * evaluation from the month's allowance on work that was already handed in.
 * What is left is what somebody going back actually came for: the lesson, the
 * question, what they wrote, and what it was marked.
 *
 * The lesson is the exception that proves it — `Reading` is the same component
 * the live block uses, because re-reading is the whole point and the cache and
 * the allowance rules underneath it already handle a second look.
 */
function PastBlock(props: BodyProps) {
  const { block, response } = props;

  return (
    <div className="flex flex-col gap-6">
      <Status tone="neutral">
        Looking back — you&rsquo;ve already been through this one
      </Status>

      {block.type === "explain" ? <Reading {...props} block={block} /> : null}

      {block.type === "check" ? (
        response ? (
          <Marked prompt={block.prompt} response={response} />
        ) : (
          <>
            <Ask>{block.prompt}</Ask>
            <Meta>You moved on without answering this one.</Meta>
          </>
        )
      ) : null}

      {block.type === "apply" ? (
        <>
          <Ask>{block.brief}</Ask>
          <Meta>
            Work you hand in is marked on its own page, and stays there.
          </Meta>
        </>
      ) : null}

      {block.type === "review" ? <Lead>{block.focus}</Lead> : null}

      {block.type === "reflect" ? (
        <>
          <Ask>{block.prompt}</Ask>
          <div className="rounded-[var(--radius-control)] bg-raised px-5 py-4 whitespace-pre-wrap">
            {response && response.answer !== "" ? (
              response.answer
            ) : (
              <Meta>You skipped this one.</Meta>
            )}
          </div>
        </>
      ) : null}

      {/* Both directions, because a look-back has two of them: further back
          through what is already done, and out — forward to the block the
          session is actually on. The way out is the loud one. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
        <ButtonLink href={`/session/${props.sessionId}`}>
          Back to where you were
        </ButtonLink>
        <BackLink sessionId={props.sessionId} index={props.index} />
      </div>
    </div>
  );
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
    <div className="flex flex-col gap-8">
      <Reading {...props} />

      <ContinueOnly
        sessionId={props.sessionId}
        index={props.index}
        /* Ruled off, because on an explain block this button is three thousand
           pixels below everything above it and needs to read as the end of the
           reading rather than as one more paragraph of it. */
        className="border-t border-hairline pt-6"
      />
    </div>
  );
}

/**
 * The lesson itself, without whatever sits under it.
 *
 * Its own component because a learner who goes back to the Read block wants
 * *this* — the same lesson, from the same cache, under the same allowance
 * rules — and not the Continue button that would move a cursor which is
 * already three blocks further on.
 */
function Reading(
  props: BodyProps & { block: Extract<SessionBlock, { type: "explain" }> },
) {
  return (
    <>
      {/*
       * No opening line when there is a skill, and that is the fix rather than
       * an omission. The header already carries the skill's name and the lesson
       * opens with its own objective — with a `Lead` here as well, the reader's
       * first two paragraphs were the can-do statement and a paraphrase of it,
       * in the same size and the same grey.
       *
       * Without a skill there is no lesson either (`LessonBody` says so), so the
       * block's own brief is the only thing left that says what this is about.
       */}
      {props.skill ? null : <Lead>{props.block.content}</Lead>}

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
    </>
  );
}

function CheckBlock(
  props: BodyProps & { block: Extract<SessionBlock, { type: "check" }> },
) {
  const { response } = props;

  if (response) {
    return (
      <div className="flex flex-col gap-6">
        <Marked prompt={props.block.prompt} response={response} />

        <ContinueOnly
          sessionId={props.sessionId}
          index={props.index}
          className="border-t border-hairline pt-6"
        />
      </div>
    );
  }

  return (
    <form
      action={answerAction.bind(null, props.sessionId)}
      className="flex flex-col gap-6"
    >
      <Ask>{props.block.prompt}</Ask>
      <input type="hidden" name="block" value={props.index} />
      {/*
       * **The browser's prose habits are off, whatever the answer is.**
       *
       * Not a nicety: a recall answer is where identifiers, commands and
       * syntax get typed, and autocapitalise turns `dotnet new` into `Dotnet
       * new` on a phone while the spellchecker underlines every one of them.
       * There is nothing here for those features to be right about — the
       * grader marks what the answer says, and §14.9.2's grader prompt says
       * spelling and phrasing are irrelevant — so all they can do is corrupt
       * what was typed and nag about the rest.
       *
       * Monospace is the part that follows the question: an item authored as
       * code gets a box that lines up, and prose keeps the reading font.
       */}
      <textarea
        name="answer"
        rows={5}
        aria-label="Your answer"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        className={cx(
          "w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 py-3 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          props.block.answerFormat === "code" &&
            "font-mono text-[length:var(--text-meta-size)]",
        )}
        placeholder={
          props.block.answerFormat === "code"
            ? "From memory — don't look it up or run it"
            : "From memory — don't look it up"
        }
      />
      {/* `SubmitButton`, because this press buys a model call. The form posts
          over `fetch`, so without it the box sits there with the answer still
          in it and nothing anywhere saying it went — which reads as a press
          that missed, and the second press is a second marking. */}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel="Marking your answer"
          note="It takes a few seconds to read and mark."
        >
          Submit answer
        </SubmitButton>
        {/* The block a learner is most likely to want to leave and come back
            to: the question is answered from memory, and the lesson it is
            about is one press behind. */}
        <BackLink sessionId={props.sessionId} index={props.index} />
      </div>
      <Meta>Marked against what the question asked for, not on wording.</Meta>
    </form>
  );
}

/**
 * A question, the answer given to it, and what the marking made of it.
 *
 * Shared by the screen you land on the moment marking finishes and the one you
 * get by going back to the block later, because they are the same three facts
 * and a learner comparing them should not find two different accounts.
 */
function Marked({
  prompt,
  response,
}: {
  prompt: string;
  response: BlockResponse;
}) {
  return (
    <>
      <Ask>{prompt}</Ask>

      <div className="flex flex-col gap-2">
        <Meta>What you wrote</Meta>
        <div className="rounded-[var(--radius-control)] bg-raised px-5 py-4 whitespace-pre-wrap">
          {response.answer === "" ? (
            <Meta>You left this one blank.</Meta>
          ) : (
            response.answer
          )}
        </div>
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

      {response.feedback === "" ? null : (
        <p className="max-w-[var(--measure)]">{response.feedback}</p>
      )}
    </>
  );
}

/**
 * "about 20 minutes" · "about 2 hours" · "about 7 hours".
 *
 * No singular. Below ninety minutes this counts in minutes, and ninety or more
 * can never round to one hour — so a `hour${n === 1 ? "" : "s"}` was a branch
 * nothing could reach, which is a thing to delete rather than to test around.
 */
function workWords(minutes: number): string {
  if (minutes < 90) return `about ${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}

function ApplyBlock(
  props: BodyProps & { block: Extract<SessionBlock, { type: "apply" }> },
) {
  const project = props.block.project;

  return (
    <div className="flex flex-col gap-6">
      {/*
       * The project's own title and brief, and — the half that was missing —
       * what it will be marked against.
       *
       * This block used to read "Produce work that demonstrates: <can-do
       * statement>", written by the composer, while `projectForBlock` chose the
       * actual project at submission time. The words on this screen and the
       * words the grader used were two different documents: somebody handed in
       * against an eleven-minute line and was marked on a 420-minute project's
       * criteria, scoring 0% on work nobody had told them to do. §4.2 law 2 is
       * that the rubric is public *before* the work starts, and this screen is
       * where that promise is either kept or broken.
       */}
      <Ask>{project?.title ?? props.block.brief}</Ask>

      {project ? <Lead>{props.block.brief}</Lead> : null}

      {project ? (
        <div className="flex flex-col gap-3">
          <Meta>It&rsquo;s finished when</Meta>
          <ul className="flex list-none flex-col gap-2 p-0 m-0 max-w-[var(--measure)]">
            {project.acceptanceCriteria.map((criterion) => (
              <li key={criterion} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                />
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Lead>
        Do this away from the screen, in whatever you normally work in. Paste it
        back here when you are ready and it gets marked against the rubric.
      </Lead>

      {/*
       * The size of the work, said where it cannot be missed.
       *
       * The block's own `estMinutes` is the slot in this session — time to read
       * the brief and hand something in. The project is frequently hours. The
       * plan showed the first as though it were the second, so a seven-hour
       * piece of work was offered as "Do · 11 min", twice: once on `/today` and
       * once on the block's own header.
       */}
      {project ? (
        <Status tone="attention">
          {workWords(project.projectMinutes)} of work — not something to finish
          in this session
        </Status>
      ) : null}

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

      <ContinueOnly
        sessionId={props.sessionId}
        index={props.index}
        label="Skip for now"
        className="border-t border-hairline pt-6"
      />
    </div>
  );
}

function ReflectBlock(
  props: BodyProps & { block: Extract<SessionBlock, { type: "reflect" }> },
) {
  if (props.response) {
    return (
      <div className="flex flex-col gap-6">
        <Ask>{props.block.prompt}</Ask>
        <div className="rounded-[var(--radius-control)] bg-raised px-5 py-4 whitespace-pre-wrap">
          {props.response.answer === "" ? (
            <Meta>You skipped this one.</Meta>
          ) : (
            props.response.answer
          )}
        </div>
        <ContinueOnly
          sessionId={props.sessionId}
          index={props.index}
          className="border-t border-hairline pt-6"
        />
      </div>
    );
  }

  return (
    <form
      action={noteAction.bind(null, props.sessionId)}
      className="flex flex-col gap-6"
    >
      <Ask>{props.block.prompt}</Ask>
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

/**
 * What this block is asking of the learner, as the loudest thing in the card.
 *
 * Every block used to open with its prompt in a `Lead`: 19px, `--ink-muted`,
 * the same treatment as the sentence under it explaining how marking works. So
 * the question and the note about the question were drawn identically, and a
 * check block read as two grey paragraphs and a box rather than as something
 * being asked. A question is a heading — it is what the rest of the card is
 * about — so it is set as one.
 */
function Ask({ children }: { children: string }) {
  return <Title className="max-w-[var(--measure)] text-balance">{children}</Title>;
}

function ContinueOnly({
  sessionId,
  index,
  label = "Continue",
  className,
  children,
}: {
  sessionId: string;
  index: number;
  label?: string;
  /** For the ruled separator an explain block's Continue needs. */
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <form
      action={continueAction.bind(null, sessionId)}
      className={cx("flex flex-col gap-5", className)}
    >
      {children}
      <input type="hidden" name="to" value={index + 1} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{label}</Button>
        <BackLink sessionId={sessionId} index={index} />
      </div>
    </form>
  );
}

/**
 * The button back, one block at a time.
 *
 * The rail is navigable and that was found — and a button was asked for
 * anyway, which is the answer: a named control beside the one that goes
 * forward, rather than a word in a progress indicator that has to be
 * recognised as a link first.
 *
 * **A link, where Continue is a form, and drawn so you can tell.** The
 * asymmetry is the honest part: going on *moves* the session and writes to the
 * row, going back only *looks* at a block. So Continue stays the one filled
 * button (§8.5.5) and this is a quiet text one that costs nothing to press. A
 * matched pair would claim they were two of the same act.
 *
 * Nothing on the first block, because there is nothing behind it.
 */
function BackLink({ sessionId, index }: { sessionId: string; index: number }) {
  if (index <= 0) return null;

  return (
    <ButtonLink
      variant="text"
      href={`/session/${sessionId}?block=${index - 1}`}
      aria-label="Back to the previous block"
    >
      ← Back
    </ButtonLink>
  );
}
