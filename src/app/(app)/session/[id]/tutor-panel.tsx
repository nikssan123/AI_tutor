"use client";

import { useState } from "react";

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
}: {
  sessionId: string;
  initialTurns: Turn[];
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [pending, setPending] = useState(false);

  async function ask(message: string) {
    if (pending || message.trim() === "") return;
    setPending(true);
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
          placeholder="Ask anything about this"
          aria-label="Ask the tutor"
          disabled={pending}
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-hairline bg-ground px-4 py-2.5 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] bg-accent px-4 py-2.5 font-[550] text-on-accent disabled:opacity-60"
        >
          Ask
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {/* §8 screen 7's two named interactions, as one click each. */}
        <button
          type="button"
          disabled={pending}
          onClick={() => void ask("I don't understand this. Explain it a different way.")}
          className="rounded-[var(--radius-pill)] border border-hairline px-3 py-1.5 text-[length:var(--text-meta-size)] text-ink-muted hover:text-ink disabled:opacity-60"
        >
          I don&rsquo;t understand
        </button>
        <button
          type="button"
          disabled={pending}
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
