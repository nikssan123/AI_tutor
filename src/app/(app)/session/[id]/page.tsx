import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { hasApiKey } from "@/lib/ai/client";
import { requireUser } from "@/lib/account/session";
import { sessionView } from "@/lib/session/view";
import { transcriptFor } from "@/lib/session/tutor";
import type { EngineSkill, MasteryState, SessionBlock } from "@/lib/engine";
import type { BlockResponse } from "@/lib/contracts/session";
import {
  Button,
  Card,
  DisplayTitle,
  EmptyState,
  Lead,
  Meta,
  Skeleton,
  Status,
  Title,
  stagger,
} from "@/components/ui";
import { TutorPanel } from "./tutor-panel";
import { LessonBody } from "./lesson-body";
import { answerAction, continueAction, finishAction, noteAction } from "./actions";

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

type Props = { params: Promise<{ id: string }> };

export default async function SessionPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const now = new Date();

  const view = await sessionView(db, user.id, id, now);
  if (!view) redirect("/today");

  const { session, block, skill } = view;
  const position = Math.min(session.blockIndex + 1, session.blocks.length);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="rise flex flex-col gap-2">
        <Meta>
          {view.pack.name} ·{" "}
          {view.finished
            ? "Session complete"
            : `Block ${position} of ${session.blocks.length}`}
        </Meta>
        <DisplayTitle>
          {view.finished ? "That's the session" : (skill?.name ?? "Today's session")}
        </DisplayTitle>
        <BlockRail blocks={session.blocks} at={session.blockIndex} />
      </div>

      {view.finished || !block ? (
        <Card className="rise flex flex-col gap-5" style={stagger(1)}>
          <Lead>
            {session.completedAt
              ? "This one is already finished."
              : "You've worked through every block. Finishing writes it to your record."}
          </Lead>
          {session.completedAt ? (
            <div>
              <Link href="/today">
                <Button>Back to today</Button>
              </Link>
            </div>
          ) : (
            <form action={finishAction.bind(null, session.id)}>
              <Button type="submit">Finish session</Button>
            </form>
          )}
        </Card>
      ) : (
        <Card className="rise flex flex-col gap-6" style={stagger(1)}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="inline-flex min-w-14 justify-center rounded-[var(--radius-pill)] bg-accent-weak px-2.5 py-1 text-[length:var(--text-meta-size)] font-[650] text-accent">
              {BLOCK_LABEL[block.type]}
            </span>
            <Meta>{block.estMinutes} min</Meta>
          </div>

          <BlockBody
            block={block}
            skill={skill}
            mastery={view.mastery}
            response={view.response}
            sessionId={session.id}
            index={session.blockIndex}
            packSlug={view.goal.packSlug}
            userId={user.id}
            now={now}
          />
        </Card>
      )}

      <section className="rise flex flex-col gap-3" style={stagger(2)}>
        <Title>Tutor</Title>
        {hasApiKey() ? (
          <Suspense fallback={<Skeleton className="h-20" />}>
            <Tutor sessionId={session.id} userId={user.id} />
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
    </main>
  );
}

/** Visible block progress (§8 screen 7), as one mark per block. */
function BlockRail({
  blocks,
  at,
}: {
  blocks: SessionBlock[];
  at: number;
}) {
  return (
    <ul className="flex list-none flex-wrap gap-1.5 p-0 m-0" aria-hidden="true">
      {blocks.map((block, i) => (
        <li
          key={`${block.type}-${i}`}
          className={`h-1.5 w-10 rounded-[var(--radius-pill)] ${
            i < at ? "bg-accent" : i === at ? "bg-accent-weak" : "bg-hairline"
          }`}
        />
      ))}
    </ul>
  );
}

async function Tutor({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}) {
  const history = await transcriptFor(getDb(), sessionId, userId);
  return <TutorPanel sessionId={sessionId} initialTurns={history} />;
}

interface BodyProps {
  block: SessionBlock;
  skill: EngineSkill | undefined;
  mastery: MasteryState | undefined;
  response: BlockResponse | undefined;
  sessionId: string;
  index: number;
  packSlug: string;
  userId: string;
  now: Date;
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
          skill={props.skill}
          mastery={props.mastery}
          minutes={props.block.estMinutes}
          now={props.now}
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
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit">Submit answer</Button>
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

      {/*
       * Handing work in is E8, and saying so plainly beats a button that files
       * it nowhere. §4.2 law 5: the declared limit has to be the real one.
       */}
      <EmptyState message="Do this away from the screen, in whatever you normally work in. You can't hand it in here yet — marked submissions are the next thing being built." />

      <ContinueOnly sessionId={props.sessionId} index={props.index} label="Done" />
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
