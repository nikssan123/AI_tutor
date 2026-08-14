import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { MAX_TURNS, turnsTaken } from "@/lib/goals/analyzer";
import {
  displayDeadline,
  displayHours,
  displayLevel,
} from "@/lib/goals/captured-display";
import { LATEST } from "@/lib/goals/anchors";
import { customPathHref } from "@/lib/goals/custom-path";
import {
  projectStartHref,
  projectStartSeed,
} from "@/lib/goals/project-start";
import { findProject } from "@/lib/content";
import { withDestination } from "@/lib/account/next-url";
import { loadIntake } from "@/lib/goals/intake-store";
import {
  Button,
  Card,
  cx,
  Meta,
  Status,
  Title,
  stagger,
} from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import {
  buildFromConversationAction,
  openAction,
  replyAction,
  restartAction,
  startFreshAction,
} from "./actions";
import { LEARNER_BUBBLE, ANALYZER_BUBBLE } from "./bubbles";
import { Composer } from "./composer";

/**
 * §8 screen 3 — goal creation, as the conversation the plan always described.
 *
 * "Chat, one question at a time, with **smart chips** for common answers so most
 * replies are one tap. Live-updating sidebar showing what's been captured."
 *
 * Every turn is a form POST that redirects back here, so the screen is a pure
 * function of the stored conversation and a refresh re-reads it rather than
 * re-sending an answer. The chips are submit buttons carrying their own value,
 * which is what makes "one tap" work without a bundle.
 *
 * That much still holds with scripting off. What is no longer true is "no
 * client JavaScript at all": `Composer` is a client component, because the
 * analyzer takes seconds and a screen that shows nothing for those seconds
 * reads as broken — it was reported as exactly that. It enhances the same
 * forms rather than replacing them, so the no-scripting path is unchanged.
 */
export const metadata: Metadata = {
  title: "Set a goal",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ error?: string; topic?: string; project?: string }>;
};

/**
 * How much of a seeded topic is carried in. Matches `MAX_REPLY` in the action,
 * which does the same slice again — this one is only so the screen never echoes
 * back more than it is going to send.
 */
const MAX_TOPIC = 500;

const ERRORS: Record<string, string> = {
  analyzer: "That didn't go through. Try saying it again.",
  subject: "We couldn't work out what you wanted to learn. Try again?",
  busy: "You already have a course being built. Give that one a moment.",
};

/** One captured field in the sidebar. Absent fields say so rather than hide. */
function Captured({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-hairline py-2.5 first:border-t-0">
      <Meta tone="muted">{label}</Meta>
      <span
        className={
          value === null
            ? "text-[length:var(--text-label-size)] text-ink-faint"
            : "text-[length:var(--text-label-size)] font-[550] text-ink text-right"
        }
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

const OUTCOMES: Record<string, string> = {
  career: "Work",
  project: "Something to make",
  exam: "An exam",
  personal: "For myself",
  curiosity: "Curiosity",
};

export default async function StartPage({ searchParams }: Props) {
  const { error, topic, project } = await searchParams;

  /*
   * The brief they pressed the button on, or nothing.
   *
   * Resolved before anything else is decided, because a slug that resolves is
   * the strongest instruction this screen can receive — it names one pack and
   * one project — and a slug that does not resolve must leave no trace at all.
   * Nothing a visitor can put in the query string reaches the page through
   * here: it is either a project we publish or it is `undefined`.
   */
  const brief = project ? findProject(project) : undefined;

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    // The typed subject comes back with them. Without this, someone who asked
    // us to build a subject signs in and is asked what they want all over
    // again — on the one screen whose whole job is not to lose that answer.
    //
    // The brief comes back with them for the same reason and it is the more
    // expensive one to drop: they read a rubric end to end before pressing the
    // button, and landing on a bare intake afterwards throws all of that away.
    redirect(
      withDestination(
        "/sign-in",
        brief ? projectStartHref(brief.slug) : customPathHref(topic ?? ""),
      ),
    );
  }
  const intake = await loadIntake(getDb(), session.user.id);
  const captured = intake.captured;
  const asked = turnsTaken(intake.messages);

  /*
   * What they typed into the search box on the way here (`/learn` offers this
   * when nothing covers their subject). It opens the conversation as their
   * first message rather than sitting in a hidden field: the analyzer's first
   * question then answers what they said instead of asking it back at them.
   */
  const seed = (topic ?? "").trim().slice(0, MAX_TOPIC);
  const started = intake.messages.length > 0;

  /** The subject of the conversation already in progress, if there is one. */
  const heldSubject = captured?.subject ?? null;

  /*
   * A brief takes the screen.
   *
   * This is the bug that shipped. A project click arrived as `?topic=<a whole
   * sentence>`, which is the parameter a *search box* fills, so the conversation
   * below treated it exactly like a vague query: an unfinished chat about
   * something else rendered in full, with the brief reduced to one line inside a
   * collision card — and the card asked whether you wanted to start on
   * `I want to learn SQL so I can do the “…” project.`, because the wording it
   * interpolates is meant to be a subject name.
   *
   * Worse, and quieter: the seed only ever became a first message when there was
   * no conversation at all. Anyone with an abandoned chat got their brief
   * dropped on the floor and their old answers shown instead.
   *
   * So a resolved brief returns here instead of falling through. The reader
   * chose one specific piece of work and read its rubric to the end; the screen
   * that follows is about that, and nothing else is drawn on it.
   *
   * The old conversation is not deleted on the way in. Clearing is a `POST`
   * below, because `Link` prefetches this route — a `GET` that threw away an
   * unfinished intake would do it to people who only hovered.
   */
  if (brief) {
    return (
      <AppFrame>
        <AppHeader
          title={`Start “${brief.title}”`}
          lead={`A few questions about you, then the path that gets you to this brief in ${brief.topicName}. It is what you hand in at the end, marked against the checklist you have already read.`}
        />

        {error ? (
          <Status tone="problem">{ERRORS[error] ?? ERRORS.subject}</Status>
        ) : null}

        <Card className="rise flex flex-col items-start gap-5" style={stagger(1)}>
          <Title>Let&rsquo;s work out what you need</Title>
          <Meta>
            No more than {MAX_TURNS} questions, and you can skip any of them. We
            ask what you want to do with it, where you are starting from, and how
            many hours a week you actually have — the brief itself we already
            know.
          </Meta>
          {/* Through `startFreshAction`, which clears any held conversation and
              then posts this as the opening line. Both halves matter: without
              the clear the analyzer answers the old chat, and without the reply
              the brief is not in the conversation at all. */}
          <form action={startFreshAction}>
            <input
              type="hidden"
              name="reply"
              value={projectStartSeed(brief.title, brief.topicName)}
            />
            <Button type="submit">Start this project</Button>
          </form>
        </Card>

        {started ? (
          <Meta tone="muted">
            {heldSubject
              ? `You still have a conversation going about ${heldSubject}.`
              : "You still have a conversation going about something else."}{" "}
            Starting here puts it aside — nothing has been built from it yet, so
            it costs you a plan you never had, but the answers go.{" "}
            <Link href="/start" className="underline underline-offset-4">
              {heldSubject ? `Carry on with ${heldSubject}` : "Carry on with it"}
            </Link>{" "}
            instead.
          </Meta>
        ) : null}
      </AppFrame>
    );
  }

  /*
   * They arrived asking for one subject and there is already a conversation
   * about another. The screen used to render the old one and say nothing —
   * `/start?topic=javascript` showed a half-finished conversation about
   * Japanese, which reads as the product having invented both the subject and
   * the answers.
   *
   * Compared loosely because the stored subject is the analyzer's wording and
   * the topic is theirs: "JavaScript" and "javascript" are not two subjects.
   *
   * This only ever sees a *subject*, which is the invariant the project offer
   * broke by routing a whole sentence through `?topic=`: no sentence equals a
   * stored subject, so every such arrival collided.
   */
  const collides =
    seed.length > 0 &&
    started &&
    heldSubject?.trim().toLowerCase() !== seed.toLowerCase();

  return (
    /* §8.5.9 — a task screen, but on the shared frame like every other one.
       It used to hand-roll a `max-w-4xl` main, which made it the third column
       width in the product and put its title at a different height from the
       screens on either side of it. `flush` is the one thing it genuinely
       needs that the others do not: the composer is pinned to the bottom of
       the viewport, so the frame gives up its bottom padding.

       Only while the composer is actually there. Once the conversation is done
       it is replaced by the "Build my plan" card, which is in normal flow — and
       a frame with no bottom padding puts that button under the fixed mobile
       nav, on the one screen where the button is the entire point. */
    <AppFrame flush={started && !intake.done}>
      {started ? (
        /*
         * The headline has done its job by now — it asked a question that has
         * four answers above it. Kept as the h1 because the screen still needs
         * one, at a size that no longer competes with the conversation.
         */
        <h1 className="text-[length:var(--text-label-size)] font-[650] text-ink-muted">
          What do you want to get good at?
        </h1>
      ) : (
        <AppHeader
          title="What do you want to get good at?"
          lead="Tell us in your own words. Anything — if we don’t already cover it, we’ll build it."
        />
      )}

      {error ? <Status tone="problem">{ERRORS[error] ?? ERRORS.subject}</Status> : null}

      <div className="flex flex-col gap-8 md:flex-row md:items-start">
        {/* ── The conversation ─────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {intake.messages.length === 0 ? (
            <Card className="rise flex flex-col items-start gap-4" style={stagger(1)}>
              <Title>Let&rsquo;s work out what you need</Title>
              <Meta>
                A few questions — no more than {MAX_TURNS}. You can skip any of
                them.
              </Meta>
              {seed ? (
                <>
                  <Meta tone="muted">
                    Starting from what you asked for:{" "}
                    <span className="font-[550] text-ink">
                      &ldquo;{seed}&rdquo;
                    </span>
                  </Meta>
                  {/* The seed goes through `replyAction`, which is already the
                      "the learner said something" path — an empty conversation
                      plus one message is exactly what it expects. */}
                  <form action={replyAction}>
                    <input type="hidden" name="reply" value={seed} />
                    <Button type="submit">Start</Button>
                  </form>
                </>
              ) : (
                <form action={openAction}>
                  <Button type="submit">Start</Button>
                </form>
              )}
            </Card>
          ) : (
            <>
              {collides ? (
                <Card className="flex flex-col items-start gap-4">
                  <Title>Start on &ldquo;{seed}&rdquo;?</Title>
                  <Meta>
                    {heldSubject
                      ? `You still have a conversation going about ${heldSubject}.`
                      : "You still have a conversation going about something else."}{" "}
                    Nothing has been built from it yet, so putting it aside
                    costs you a plan you never had — but the answers below go.
                  </Meta>
                  <div className="flex flex-wrap items-center gap-5">
                    <form action={startFreshAction}>
                      <input type="hidden" name="reply" value={seed} />
                      <Button type="submit">Start on &ldquo;{seed}&rdquo;</Button>
                    </form>
                    <Link
                      href="/start"
                      className="text-[length:var(--text-label-size)] text-ink-muted underline underline-offset-4 hover:text-ink"
                    >
                      {heldSubject
                        ? `Carry on with ${heldSubject}`
                        : "Carry on where I was"}
                    </Link>
                  </div>
                </Card>
              ) : null}

              <ol className="flex list-none flex-col gap-4 p-0 m-0">
                {intake.messages.map((message, i) => (
                  <li
                    key={i}
                    /*
                     * Every turn redirects to #latest so the browser opens the
                     * page on the newest question. Without it the composer,
                     * now pinned to the bottom, covers the very question its
                     * chips are answering — the screen loads showing four
                     * answers to something you cannot read.
                     */
                    id={i === intake.messages.length - 1 ? LATEST : undefined}
                    className={cx(
                      "scroll-mt-8",
                      message.r === "l" ? LEARNER_BUBBLE : ANALYZER_BUBBLE,
                    )}
                  >
                    <span className="sr-only">
                      {message.r === "l" ? "You said" : "We asked"}:{" "}
                    </span>
                    {message.t}
                  </li>
                ))}
              </ol>

              {intake.done ? (
                <Card className="flex flex-col items-start gap-4">
                  <form action={buildFromConversationAction}>
                    <Button type="submit">Build my plan</Button>
                  </form>
                  <form action={restartAction}>
                    <button
                      type="submit"
                      className="text-[length:var(--text-meta-size)] text-ink-faint underline underline-offset-4 hover:text-ink"
                    >
                      Start over
                    </button>
                  </form>
                </Card>
              ) : (
                /*
                 * Pinned to the bottom of the viewport, and the one part of
                 * this screen that takes client JavaScript.
                 *
                 * Two problems, one place. In normal flow the answer box was
                 * the thing needed on every turn and the thing that had
                 * scrolled off the bottom. And with no scripting at all there
                 * was nothing to see for the several seconds the analyzer
                 * takes, so a sent answer read as a frozen page.
                 *
                 * Keyed by the turn count so the optimistic echo inside it is
                 * dropped the moment the real turn arrives above.
                 */
                <Composer
                  key={intake.messages.length}
                  chips={intake.chips}
                  asked={asked}
                  maxTurns={MAX_TURNS}
                  reply={replyAction}
                  restart={restartAction}
                />
              )}
            </>
          )}
        </div>

        {/* ── What we have so far ──────────────────────────────────────────── */}
        {/* Follows the conversation down rather than scrolling away from it —
            a running summary is only worth the column if it is still on screen
            when the answer it summarises is being typed. */}
        <Card
          className="rise w-full md:sticky md:top-8 md:w-72 md:shrink-0"
          style={stagger(2)}
        >
          <div className="flex flex-col">
            <Title className="pb-3 text-[length:var(--text-label-size)]">
              What we have so far
            </Title>
            <Captured label="Subject" value={captured?.subject ?? null} />
            {/* Their words first, ours only when they never said it — see
                captured-display.ts for what this card got wrong before. */}
            <Captured label="Level" value={displayLevel(captured)} />
            <Captured label="Time" value={displayHours(captured)} />
            <Captured label="Deadline" value={displayDeadline(captured)} />
            <Captured
              label="For"
              value={
                captured?.outcomeType ? OUTCOMES[captured.outcomeType]! : null
              }
            />
            {captured?.matchedPack ? (
              <div className="pt-4">
                <Status tone="verified">We cover this one already</Status>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      {/*
       * Only before the conversation starts, for two reasons. Offering the
       * form to someone four questions in is offering to throw away the four
       * answers. And anything rendered after the composer extends the page
       * past it, so scrolling to the end left the bar floating mid-screen with
       * a strip of dead page underneath — the composer stops feeling pinned
       * exactly when you have scrolled to reach it.
       */}
      {started ? null : (
        <Meta tone="muted">
          Would rather fill in a form?{" "}
          <Link href="/start/form" className="underline underline-offset-4">
            Do that instead
          </Link>
          .
        </Meta>
      )}
    </AppFrame>
  );
}
