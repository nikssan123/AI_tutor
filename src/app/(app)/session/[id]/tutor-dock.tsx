"use client";

import { useEffect, useRef, useState } from "react";
import { TUTOR_TURN_WARNING_MARGIN } from "@/lib/session/tutor";
import { GeneratedProse } from "@/components/generated-prose";
import { cx, Meta } from "@/components/ui";

/**
 * The tutor, docked along the bottom of the session.
 *
 * §8 screen 7 asks for a persistent chat, and §14.9.3 asks for it streamed,
 * which is the one requirement a Server Action cannot meet: an action returns
 * when it is finished, and the point of streaming is that the answer starts
 * arriving before it exists. So it is scoped as tightly as possible — every
 * other part of a session is a form POST that works with scripting off.
 *
 * **Why a dock and not the rail it was.** A tutor that answers a .NET question
 * with three fenced commands needs width, and a sticky 22rem rail beside the
 * lesson could not give it any: the two columns were competing for one 1024px
 * row and both lost. A dock does not compete. At rest it is a single line — the
 * box you type in, pinned where your hands are, reachable from any scroll
 * position rather than only when you have scrolled the rail back into view. It
 * grows upward only once there is something to read, and then the answer has
 * the whole column instead of a third of it.
 *
 * The cost is that an open dock covers the lesson, which is the trade that was
 * chosen deliberately: you do not read a paragraph and the answer to it at the
 * same instant, and being able to *reach* the tutor mattered more than being
 * able to see both at once.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** How tall the transcript may grow before it scrolls inside itself. */
const TRANSCRIPT = "max-h-[55vh]";

/**
 * Where the dock sits, exported so the page's loading state can sit there too.
 *
 * `pointer-events-none` on the strip and back on for the panel itself: the
 * strip spans the viewport so the panel can centre on the same column the
 * lesson uses, and without this it would also swallow every click in the
 * margins either side of it.
 *
 * It clears the mobile bar rather than sitting under it. That bar is
 * `min-h-[var(--touch-min)]` plus `py-2`, so 60px, and it owns `z-30`; above
 * `lg` it is not rendered at all and the dock goes to the floor.
 */
export const DOCK_OUTER = [
  "pointer-events-none fixed left-0 right-0 z-20",
  // `lg:left-56` clears the desktop nav rail (`lg:w-56`, sticky rather than
  // fixed, so it is a flex sibling of the content and not something the
  // viewport knows about). Without it the dock centres on the *window* while
  // the lesson centres on the content area, and the two sit 112px apart.
  // Written as `left-0 … lg:left-56` rather than `inset-x-0 lg:left-56`,
  // because `inset-x` and `left` set the same property and would resolve by
  // emission order; a responsive variant of the same utility always wins.
  "lg:left-56",
  "bottom-[calc(60px+env(safe-area-inset-bottom))] lg:bottom-0",
].join(" ");

/**
 * The width of the session — the lesson, and the dock under it.
 *
 * One constant because the two have to agree: a dock of any other width reads
 * as a bar that happens to be near the page rather than the foot of it. The
 * page imports this rather than repeating the literal.
 *
 * 52rem, up from 46: at 19px the prose caps itself at `--measure` well before
 * this, so what the extra 96px widens is the listings and the answers, and what
 * it narrows is the empty margin either side of them.
 */
export const SESSION_COLUMN = "max-w-[52rem]";

export const DOCK_INNER = `mx-auto w-full ${SESSION_COLUMN} px-6`;

/** The panel's own surface — shared with the loading state for the same reason. */
export const DOCK_PANEL = [
  "pointer-events-auto flex flex-col overflow-hidden",
  "rounded-t-[var(--radius-card)] border border-b-0 border-hairline",
  "bg-surface shadow-[var(--shadow-lifted)]",
].join(" ");

export function TutorDock({
  sessionId,
  initialTurns,
  turnsTaken,
  turnLimit,
  quiet = false,
}: {
  sessionId: string;
  initialTurns: Turn[];
  /**
   * How many questions this learner has already asked in this session.
   *
   * Counted on the server and handed in, rather than derived from
   * `initialTurns`: that list stops at `TRANSCRIPT_DEPTH`, so a long
   * conversation would report twenty for ever.
   */
  turnsTaken: number;
  /** §14.9.7 limit 4, from the plan — 15 on free, 30 on everything paid. */
  turnLimit: number;
  /**
   * Suppress the soft warning because the screen is already asking for money.
   *
   * "You are running out" and "please pay" arriving together is what turns a
   * limit into a grievance, and it is the thing `nudge.ts`'s own rules exist to
   * avoid — one prompt at a time, at a wall the learner has actually hit. The
   * warning is the one that yields: it is advisory, it costs nothing to see
   * next session, and the nudge is attached to a wall they have already met.
   *
   * The **stop** is never suppressed. A disabled box with no explanation is
   * worse than any amount of crowding.
   */
  quiet?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [pending, setPending] = useState(false);
  /*
   * The server's count plus whatever has been sent since this mounted.
   *
   * Incremented optimistically, on send rather than on a successful reply: a
   * question that failed still reached the route and still counted there, so
   * decrementing on error would drift the panel above the truth and let
   * somebody past a stop the server will enforce anyway.
   */
  const [asked, setAsked] = useState(turnsTaken);
  /*
   * Closed on arrival, even when there is a transcript waiting.
   *
   * Somebody returning to a session came back to the lesson, not to what they
   * asked about it yesterday — opening over the top of it would be the dock
   * taking the screen for itself before being asked to.
   */
  const [open, setOpen] = useState(false);

  const left = Math.max(0, turnLimit - asked);
  const spent = left === 0;

  /*
   * Keep the newest words in view as they stream.
   *
   * The transcript is a capped scroll box, so without this an answer arrives
   * below the fold of its own panel: you ask a question, the box stays showing
   * the top of the conversation, and the reply appears to have gone nowhere.
   * Pinned on every change rather than only on a new turn, because a streamed
   * answer grows one chunk at a time and each chunk is what pushes the last
   * line out of sight.
   */
  const thread = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, open]);

  /*
   * Escape closes it, because a panel that covers what you were reading has to
   * be dismissible without aiming at a target. The listener is on the document
   * rather than the panel: the dock is non-modal and does not hold focus, so by
   * the time somebody wants it gone their cursor is usually back in the lesson.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function ask(message: string) {
    if (pending || spent || message.trim() === "") return;
    setPending(true);
    setOpen(true);
    setAsked((n) => n + 1);
    setTurns((prior) => [
      ...prior,
      { role: "user", content: message },
      { role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setTurns((prior) => appendToLast(prior, chunk));
      }
    } catch (error) {
      // A failed request must not leave an empty bubble sitting there looking
      // like the tutor is still thinking.
      setTurns((prior) =>
        appendToLast(
          prior,
          `Couldn't reach the tutor: ${error instanceof Error ? error.message : "unknown error"}`,
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={DOCK_OUTER}>
      <div className={DOCK_INNER}>
        <div className={DOCK_PANEL}>
          <noscript>
            <p className="px-5 py-3 text-[length:var(--text-meta-size)] text-ink-muted">
              The tutor needs JavaScript. Everything else on this page works
              without it.
            </p>
          </noscript>

          {open ? (
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-2.5">
              <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-ink-faint">
                Tutor
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-expanded={true}
                className="rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-meta-size)] text-ink-muted hover:text-ink"
              >
                Hide
              </button>
            </div>
          ) : null}

          {open && turns.length > 0 ? (
            <ul
              ref={thread}
              className={cx(
                "flex list-none flex-col gap-0 overflow-y-auto p-0 m-0 px-5",
                TRANSCRIPT,
              )}
            >
              {/*
               * One `<li>` per *exchange*, not per turn.
               *
               * A turn-per-row list gave a question and its answer the same
               * standing and the same gap as the gap to the next question, so a
               * conversation of three read as six unrelated blocks. Pairing them
               * is what lets a rule between exchanges mean something.
               */}
              {exchanges(turns).map((pair, i) => (
                <li
                  key={i}
                  className={cx(
                    "flex flex-col gap-3 py-5",
                    i > 0 && "border-t border-hairline",
                  )}
                >
                  {pair.question === undefined ? null : (
                    /*
                     * The question, on its own field.
                     *
                     * Twice this was tried as a mark rather than a panel — a
                     * quoted rule, then an accent tick — on the theory that the
                     * answer is the part with the code in it and should get the
                     * height. Both were invisible in practice: an answer runs to
                     * forty lines of prose, headings and listings, and one line
                     * of slightly-different text in front of it does not read as
                     * a different speaker. It reads as the first line of the
                     * answer.
                     *
                     * `--accent-weak` is the design's "this one is yours" field,
                     * and it is neither `--surface` (the panel) nor `--ground`
                     * (the listings inside the answer), so it is the one fill
                     * here that cannot be confused with something else.
                     */
                    <div className="flex flex-col gap-1.5 rounded-[var(--radius-control)] bg-accent-weak px-4 py-3">
                      {/* `muted`, not `faint`: 13px on the accent field is held
                          to 4.5:1 and `--ink-faint` does not clear it (§8.5.4). */}
                      <Meta tone="muted">You asked</Meta>
                      <p className="text-[length:var(--text-label-size)] font-[550] text-ink">
                        {pair.question}
                      </p>
                    </div>
                  )}

                  {pair.answer === "" ? (
                    <span className="text-[length:var(--text-label-size)] text-ink-muted">
                      Thinking&hellip;
                    </span>
                  ) : (
                    /*
                     * The tutor writes markdown — `**bold**` run-ins, fenced
                     * blocks of the very commands the lesson is about, numbered
                     * steps — and every one of them used to reach the learner as
                     * the literal characters. Same renderer as the lesson, one
                     * size down.
                     */
                    <GeneratedProse variant="compact" text={pair.answer} />
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            §14.9.7 limit 4's soft warning, and then the stop.

            The stop is enforced by the route regardless — a route handler is a
            public URL and the dock's state is not a property of the request that
            arrives at it. This is so it is not a surprise: a learner who knows
            they have five left asks the five they most want answered.
          */}
          {spent ? (
            <p
              role="status"
              className="border-b border-hairline px-5 py-2.5 text-[length:var(--text-meta-size)] text-ink-muted"
            >
              That&rsquo;s this session&rsquo;s questions. Finish the block — the
              next session starts fresh.
            </p>
          ) : left <= TUTOR_TURN_WARNING_MARGIN && !quiet ? (
            <p
              role="status"
              className="border-b border-hairline px-5 py-2.5 text-[length:var(--text-meta-size)] text-ink-muted"
            >
              {left === 1 ? "One question left" : `${left} questions left`} in
              this session.
            </p>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              // Read off the form rather than through a ref: the field is inside
              // this form by construction, so a ref would add two null branches
              // nothing can reach.
              const input = event.currentTarget.elements.namedItem(
                "message",
              ) as HTMLInputElement;
              const value = input.value;
              input.value = "";
              void ask(value);
            }}
            className="flex items-center gap-2 px-3 py-3"
          >
            <input
              name="message"
              placeholder={
                spent ? "No questions left in this session" : "Ask anything about this block"
              }
              aria-label="Ask the tutor"
              disabled={pending || spent}
              /* Focus opens it. Reaching for the box *is* the intent to use the
                 tutor, so making somebody press a second control to see what
                 they asked before — or to reach the two one-click asks — was a
                 step that existed only because the panel had a state. */
              onFocus={() => setOpen(true)}
              /* No `aria-expanded` here: the implicit role of an `input` is
                 `textbox`, which does not support it. The Hide button is the
                 control that owns the disclosure state, and it carries it. */
              className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-hairline bg-ground px-4 py-2.5 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <button
              type="submit"
              disabled={pending || spent}
              className="rounded-[var(--radius-control)] bg-accent px-4 py-2.5 font-[550] text-on-accent disabled:opacity-60"
            >
              Ask
            </button>
          </form>

          {/* §8 screen 7's two named interactions, as one click each.
              Only once the dock is open: at rest this is a single line you type
              into, and two pills under it made the resting state twice as tall
              for something nobody reaches for until they are already stuck. */}
          <div
            className={cx(
              "flex flex-wrap gap-2 px-3 pb-3",
              open ? "flex" : "hidden",
            )}
          >
            <button
              type="button"
              disabled={pending || spent}
              onClick={() => void ask("I don't understand this. Explain it a different way.")}
              className="rounded-[var(--radius-pill)] border border-hairline px-3 py-1.5 text-[length:var(--text-meta-size)] text-ink-muted hover:text-ink disabled:opacity-60"
            >
              I don&rsquo;t understand
            </button>
            <button
              type="button"
              disabled={pending || spent}
              onClick={() => void ask("This is too easy. What's the harder version of it?")}
              className="rounded-[var(--radius-pill)] border border-hairline px-3 py-1.5 text-[length:var(--text-meta-size)] text-ink-muted hover:text-ink disabled:opacity-60"
            >
              Too easy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A question and the answer to it — the unit a transcript is actually read in. */
export interface Exchange {
  /** Absent only for a transcript that opens on an answer, which a truncated
   *  one can: `transcriptFor` stops at `TRANSCRIPT_DEPTH` mid-conversation. */
  question?: string;
  answer: string;
}

/**
 * Pairs a flat list of turns into exchanges.
 *
 * A user turn opens a new pair; an assistant turn fills the open one, or opens
 * a questionless pair if the list began mid-conversation. Two answers in a row
 * cannot happen — the route writes them alternately — but if one ever did, the
 * second starts its own pair rather than overwriting the first.
 */
export function exchanges(turns: Turn[]): Exchange[] {
  const pairs: Exchange[] = [];

  for (const turn of turns) {
    const open = pairs[pairs.length - 1];
    if (turn.role === "user") pairs.push({ question: turn.content, answer: "" });
    else if (open && open.answer === "") open.answer = turn.content;
    else pairs.push({ answer: turn.content });
  }

  return pairs;
}

/** Appends a streamed chunk to the assistant turn in flight. */
export function appendToLast(turns: Turn[], chunk: string): Turn[] {
  const last = turns[turns.length - 1];
  if (!last) return turns;
  return [...turns.slice(0, -1), { ...last, content: last.content + chunk }];
}
