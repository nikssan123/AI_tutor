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
import { withDestination } from "@/lib/account/next-url";
import { loadIntake } from "@/lib/goals/intake-store";
import {
  Button,
  Card,
  cx,
  DisplayTitle,
  Lead,
  Meta,
  Status,
  Title,
  stagger,
} from "@/components/ui";
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

type Props = { searchParams: Promise<{ error?: string; topic?: string }> };

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
  const { error, topic } = await searchParams;

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    // The typed subject comes back with them. Without this, someone who asked
    // us to build a subject signs in and is asked what they want all over
    // again — on the one screen whose whole job is not to lose that answer.
    redirect(withDestination("/sign-in", customPathHref(topic ?? "")));
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

  /*
   * They arrived asking for one subject and there is already a conversation
   * about another. The screen used to render the old one and say nothing —
   * `/start?topic=javascript` showed a half-finished conversation about
   * Japanese, which reads as the product having invented both the subject and
   * the answers.
   *
   * Compared loosely because the stored subject is the analyzer's wording and
   * the topic is theirs: "JavaScript" and "javascript" are not two subjects.
   */
  const heldSubject = captured?.subject ?? null;
  const collides =
    seed.length > 0 &&
    started &&
    heldSubject?.trim().toLowerCase() !== seed.toLowerCase();

  return (
    /* §8.5.9 — a task screen. The sidebar earns the wider column here because
       it is the thing that makes the conversation feel like progress rather
       than a chat window; it stacks below on narrow screens. */
    <main
      className={cx(
        "mx-auto flex w-full max-w-4xl flex-col gap-10 px-6",
        // Once there is a conversation the top of the page is no longer the
        // point of the page, so it stops taking the room of one.
        started ? "pt-8 pb-0" : "pt-16 pb-28",
      )}
    >
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
        <div className="rise flex flex-col gap-5">
          <DisplayTitle>What do you want to get good at?</DisplayTitle>
          <Lead>
            Tell us in your own words. Anything — if we don&rsquo;t already
            cover it, we&rsquo;ll build it.
          </Lead>
        </div>
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
    </main>
  );
}
