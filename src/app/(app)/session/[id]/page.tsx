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

  const minutes = session.blocks.reduce((sum, b) => sum + b.estMinutes, 0);

  return (
    /*
     * **`wide`, and the narrow exception is retired here.**
     *
     * §8.5.9 let this screen keep `narrow` on the grounds that a session is one
     * thing you *do*. That was written when a block was a question you answer.
     * It is not what an explain block turned out to be: a twelve-minute written
     * lesson is three thousand pixels of column, and for the whole of it the
     * tutor — the one thing on the page that rescues a learner who is stuck —
     * sat below the fold at the very bottom, reachable only by scrolling past
     * the thing they were stuck on.
     *
     * So the work keeps a reading column (`GeneratedProse` caps at `--measure`,
     * so nothing gets wider) and the space `wide` adds goes to a rail: where
     * you are in the session, and the tutor, both on screen the entire time.
     * Under `lg` it stacks back to exactly the single column this screen has
     * always been.
     */
    <AppFrame width="wide">
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
          <>
            <Meta>
              {view.finished
                ? "Session complete"
                : `Block ${position} of ${session.blocks.length}`}
            </Meta>
            <Meta>About {minutes} minutes</Meta>
          </>
        }
      />

      {/* `minmax(0,1fr)` on both layouts, not just the two-column one. A grid
          track defaults to `min-width: auto`, so it refuses to shrink below its
          widest child — and a lesson's widest child is a `dotnet sln add
          src/…/….csproj` that runs well past a phone. The track grew to fit it
          and took the whole page sideways with it, heading included. With the
          floor at 0 the listing scrolls inside its own box, which is what
          `GeneratedProse` built it to do. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-10 gap-y-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {view.finished || !block ? (
            <Card
              className="rise flex flex-col items-start gap-5"
              style={stagger(1)}
            >
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
            <BlockShell block={block}>
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
            </BlockShell>
          )}

          {offer && skill ? (
            <Card
              className="rise flex flex-col items-start gap-4"
              style={stagger(2)}
            >
              <Title>You said you already know this</Title>
              <Lead>
                Then show us. {PROVE_ITEM_COUNT} questions on {skill.name}, the
                hardest ones in the bank.
              </Lead>
              <Meta>
                They&rsquo;re marked like everything else, and they count either
                way — which is what makes getting them right mean something. Do
                well and this comes off your path.
              </Meta>
              <form action={proveAction.bind(null, session.id)}>
                <Button type="submit" variant="text">
                  Give me the questions
                </Button>
              </form>
            </Card>
          ) : null}
        </div>

        {/* Sticky from `lg` up, which is the whole point of the rail: the block
            you are on and the tutor stay put while the lesson scrolls past. */}
        <aside
          className="rise flex flex-col gap-5 lg:sticky lg:top-10"
          style={stagger(2)}
        >
          {/* Both rail panels are cards, and the lesson beside them is not.
              That inversion is the point: the rail is instruments, the column
              is the thing you came to read. */}
          <Card className="flex flex-col gap-4">
            <RailLabel>This session</RailLabel>
            <BlockRail blocks={session.blocks} at={session.blockIndex} />
          </Card>

          <Card className="flex flex-col gap-4">
            <RailLabel>Tutor</RailLabel>
            {hasApiKey() ? (
              <Suspense fallback={<Skeleton className="h-24" />}>
                <Tutor
                  sessionId={session.id}
                  userId={user.id}
                  plan={resolvePlanId(user.plan)}
                  /* One ask at a time: the quota nudge is already asking. */
                  quiet={quotaNudge !== undefined}
                />
              </Suspense>
            ) : (
              <Meta>The tutor is unavailable right now.</Meta>
            )}
          </Card>

          <Meta className="px-1">
            <Link href="/today" className="hover:underline underline-offset-4">
              Leave and come back later
            </Link>{" "}
            — your place is saved.
          </Meta>
        </aside>
      </div>
    </AppFrame>
  );
}

/**
 * The heading on a rail panel.
 *
 * A plain `h2` rather than `Title` with a size override: both set
 * `text-[length:…]`, and two arbitrary values of the same property resolve by
 * the order Tailwind emitted them rather than the order they are written. In
 * the rail these label instruments, so they are set as labels.
 */
function RailLabel({ children }: { children: string }) {
  return (
    <h2 className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-ink-faint">
      {children}
    </h2>
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
}: {
  blocks: SessionBlock[];
  at: number;
}) {
  return (
    <ol className="flex list-none flex-col gap-0 p-0 m-0">
      {blocks.map((block, i) => {
        const done = i < at;
        const now = i === at;

        return (
          <li
            key={`${block.type}-${i}`}
            aria-current={now ? "step" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5",
              "transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)]",
              now && "bg-accent-weak",
            )}
          >
            {/* The state, as a mark that differs in *shape* and not only in
                colour — §8.5.5's ban on colour-as-meaning. Filled for done,
                ringed for the one in hand, hollow for the ones ahead. */}
            <span
              aria-hidden="true"
              className={cx(
                "size-2.5 shrink-0 rounded-full",
                done && "bg-accent",
                now && "ring-2 ring-accent ring-offset-2 ring-offset-transparent",
                !done && !now && "border border-hairline",
              )}
            />
            <span
              className={cx(
                "flex-1 text-[length:var(--text-label-size)]",
                now ? "font-[650] text-ink" : "text-ink-muted",
              )}
            >
              {BLOCK_LABEL[block.type]}
            </span>
            <Meta>{block.estMinutes} min</Meta>
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
    <div className="flex flex-col gap-8">
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

function CheckBlock(
  props: BodyProps & { block: Extract<SessionBlock, { type: "check" }> },
) {
  const { response } = props;

  if (response) {
    return (
      <div className="flex flex-col gap-6">
        <Ask>{props.block.prompt}</Ask>

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
    <div className="flex flex-col gap-6">
      <Ask>{props.block.brief}</Ask>

      <Lead>
        Do this away from the screen, in whatever you normally work in. Paste it
        back here when you are ready and it gets marked against the rubric.
      </Lead>

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
      <div>
        <Button type="submit">{label}</Button>
      </div>
    </form>
  );
}
