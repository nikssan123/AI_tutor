"use client";

import { useState } from "react";
import { TUTOR_TURN_WARNING_MARGIN } from "@/lib/session/tutor";

/**
 * The tutor panel — the only client component in the signed-in product.
 *
 * §8 screen 7 asks for a persistent chat, and §14.9.3 asks for it streamed,
 * which is the one requirement a Server Action cannot meet: an action returns
 * when it is finished, and the point of streaming is that the answer starts
 * arriving before it exists.
 *
 * So it is scoped as tightly as possible. It renders nothing until it mounts
 * beyond a `<noscript>` note, and every other part of a session — reading,
 * answering, being marked, finishing — is a form POST that works with scripting
 * turned off. The tutor is the thing you lose, not the session.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function TutorPanel({
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

  const left = Math.max(0, turnLimit - asked);
  const spent = left === 0;

  async function ask(message: string) {
    if (pending || spent || message.trim() === "") return;
    setPending(true);
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
    <div className="flex flex-col gap-4">
      <noscript>
        <p className="text-[length:var(--text-meta-size)] text-ink-muted">
          The tutor needs JavaScript. Everything else on this page works without
          it.
        </p>
      </noscript>

      {turns.length > 0 ? (
        <ul className="flex list-none flex-col gap-3 p-0 m-0">
          {turns.map((turn, i) => (
            <li
              key={i}
              className={
                turn.role === "user"
                  ? "rounded-[var(--radius-control)] bg-raised px-4 py-3"
                  : "px-1 whitespace-pre-wrap"
              }
            >
              {turn.content === "" ? (
                <span className="text-ink-muted">Thinking&hellip;</span>
              ) : (
                turn.content
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        §14.9.7 limit 4's soft warning, and then the stop.
        
        The stop is enforced by the route regardless — a route handler is a
        public URL and the panel's state is not a property of the request that
        arrives at it. This is so it is not a surprise: a learner who knows they
        have five left asks the five they most want answered.
      */}
      {spent ? (
        <p
          role="status"
          className="text-[length:var(--text-meta-size)] text-ink-muted"
        >
          That&rsquo;s this session&rsquo;s questions. Finish the block — the
          next session starts fresh.
        </p>
      ) : left <= TUTOR_TURN_WARNING_MARGIN && !quiet ? (
        <p
          role="status"
          className="text-[length:var(--text-meta-size)] text-ink-muted"
        >
          {left === 1 ? "One question left" : `${left} questions left`} in this
          session.
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
        className="flex flex-wrap items-center gap-2"
      >
        <input
          name="message"
          placeholder={spent ? "No questions left in this session" : "Ask anything about this"}
          aria-label="Ask the tutor"
          disabled={pending || spent}
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

      <div className="flex flex-wrap gap-2">
        {/* §8 screen 7's two named interactions, as one click each. */}
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
  );
}

/** Appends a streamed chunk to the assistant turn in flight. */
export function appendToLast(turns: Turn[], chunk: string): Turn[] {
  const last = turns[turns.length - 1];
  if (!last) return turns;
  return [...turns.slice(0, -1), { ...last, content: last.content + chunk }];
}
