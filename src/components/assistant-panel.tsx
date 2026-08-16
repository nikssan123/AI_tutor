"use client";

import { useEffect, useRef, useState } from "react";
import { AheadList } from "@/components/ahead-list";
import { CalendarMonth } from "@/components/calendar-month";
import type {
  AheadListPayload,
  CalendarMonthPayload,
  WidgetView,
} from "@/lib/assistant/widgets";

/**
 * The Assistant — `ASSISTANT-PLAN.md` §8.
 *
 * The second client component in the signed-in product, and it is scoped the
 * same way the first one is. It renders a button and nothing else until somebody
 * presses it; every answer it can give is reachable from a page without it; and
 * with scripting off it draws nothing at all. It is an accelerator, never a
 * dependency (§8.3).
 *
 * **Hand-rolled rather than a dialog primitive.** The plan called for
 * `@radix-ui/react-dialog` with `modal={false}`, and the package is installed —
 * but nothing in `src/` imports it today, so reaching for it here would put a
 * portal and a focus-trap implementation into the only bundle this product ships
 * to a signed-in learner, to get an Escape handler and two aria attributes. The
 * behaviour that mattered is kept: non-modal, because this is consulted *while*
 * reading a page and a focus trap would make it a detour; Escape closes; focus
 * returns to the launcher.
 */

/**
 * One turn is a sequence of prose and views, in the order they arrived.
 *
 * Not prose-with-views-appended, which was the tempting shape. A tool runs
 * *before* the sentence that introduces its result — the model asks, the view
 * lands, then it writes around it — so appending would put every calendar
 * underneath the words explaining it. §6.1 asks for arrival order, and arrival
 * order is the only order that reads correctly.
 */
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "view"; view: WidgetView };

interface Turn {
  role: "user" | "assistant";
  segments: Segment[];
  /** What a tool is doing right now. Cleared as soon as anything else lands. */
  note?: string;
}

/** What the route sends, as far as this panel is concerned (§3). */
export type PanelFrame =
  | { t: "text"; v: string }
  | { t: "tool"; label: string }
  | { t: "widget"; view: WidgetView }
  | { t: "done" }
  | { t: "error"; message: string };

/**
 * A widget frame's payload, checked before it is rendered.
 *
 * The panel gets `unknown` out of `JSON.parse`, and a route a deploy ahead can
 * send a widget this build has no component for — or the same widget with a
 * field this build's component reads and that one never sent. Both have to be a
 * missing view rather than a crashed thread (§6.1), so each widget is checked
 * for the shape its component actually indexes into.
 *
 * A few lines of structural check rather than a schema library: this is the one
 * bundle a signed-in learner receives, and `widgets.ts` explains why the
 * server-side types are not duplicated here as runtime schemas.
 */
export function readWidget(name: unknown, payload: unknown): WidgetView | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;

  if (name === "calendar_month") {
    if (typeof value.label !== "string") return null;
    if (!Array.isArray(value.weeks)) return null;
    if (typeof value.hasMarks !== "boolean") return null;
    return {
      widget: "calendar_month",
      payload: value as unknown as CalendarMonthPayload,
    };
  }

  if (name === "ahead_list") {
    if (typeof value.today !== "string") return null;
    if (!Array.isArray(value.entries)) return null;
    if (typeof value.hasCheckpoints !== "boolean") return null;
    return {
      widget: "ahead_list",
      payload: value as unknown as AheadListPayload,
    };
  }

  return null;
}

/** One view, rendered by the same component the page it came from renders. */
export function Widget({ view }: { view: WidgetView }) {
  switch (view.widget) {
    case "calendar_month":
      return (
        <CalendarMonth
          label={view.payload.label}
          weeks={view.payload.weeks}
          hasMarks={view.payload.hasMarks}
          // Back to `undefined`, which is what the component takes — see the
          // note on the payload for why the wire carries null.
          next={view.payload.next ?? undefined}
        />
      );
    case "ahead_list":
      return (
        <AheadList
          entries={view.payload.entries}
          today={view.payload.today}
          hasCheckpoints={view.payload.hasCheckpoints}
        />
      );
  }
}

/**
 * One NDJSON line, or nothing.
 *
 * Nothing covers three cases that all mean the same thing to a reader: a blank
 * line, a line that is not JSON, and a frame of a kind this version does not
 * know. The last is the one worth being deliberate about — a later route may
 * send frames this panel predates, and dropping them is how a deploy skew stays
 * a missing view rather than a crashed thread.
 */
export function parseFrame(raw: string): PanelFrame | null {
  if (raw.trim() === "") return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) return null;
  const frame = value as Record<string, unknown>;

  if (frame.t === "text" && typeof frame.v === "string") {
    return { t: "text", v: frame.v };
  }
  if (frame.t === "tool" && typeof frame.label === "string") {
    return { t: "tool", label: frame.label };
  }
  if (frame.t === "widget") {
    const view = readWidget(frame.name, frame.payload);
    return view ? { t: "widget", view } : null;
  }
  if (frame.t === "done") return { t: "done" };
  if (frame.t === "error" && typeof frame.message === "string") {
    return { t: "error", message: frame.message };
  }
  return null;
}

/**
 * Complete lines out of a chunk, and whatever is left over.
 *
 * The part the tutor's panel never had to do. A chunk boundary lands mid-object
 * regularly under real network conditions, and appending a half-object to the
 * transcript is how a thread fills with `{"t":"te`. What is incomplete is
 * carried to the next read.
 */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  // `split` always yields at least one element, and the last is by definition
  // whatever followed the final newline — complete only if it is empty.
  const rest = parts.pop()!;
  return { lines: parts, rest };
}

/**
 * Prose onto the end of a turn: extending the last passage if that is what it
 * is, opening a new one if a view came between.
 */
export function appendText(segments: Segment[], text: string): Segment[] {
  const last = segments[segments.length - 1];

  return last?.kind === "text"
    ? [...segments.slice(0, -1), { kind: "text", text: last.text + text }]
    : [...segments, { kind: "text", text }];
}

/** Applies one frame to the assistant turn in flight. */
export function applyFrame(turns: Turn[], frame: PanelFrame): Turn[] {
  const last = turns[turns.length - 1];
  if (!last) return turns;

  const replace = (over: Partial<Turn>): Turn[] => [
    ...turns.slice(0, -1),
    { ...last, ...over },
  ];

  switch (frame.t) {
    case "text":
      // Anything arriving means the lookup that preceded it is finished, so
      // the label goes. Leaving it up would report work already done.
      return replace({
        segments: appendText(last.segments, frame.v),
        note: undefined,
      });
    case "tool":
      return replace({ note: frame.label });
    case "widget":
      return replace({
        segments: [...last.segments, { kind: "view", view: frame.view }],
        note: undefined,
      });
    case "error":
      return replace({
        segments: appendText(
          last.segments,
          last.segments.length === 0 ? frame.message : `\n\n${frame.message}`,
        ),
        note: undefined,
      });
    case "done":
      return replace({ note: undefined });
  }
}

const OPENERS = [
  "What should I do next?",
  "Show me my calendar",
  "What am I paying?",
];

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);

  // Escape closes from anywhere, which is the one dialog affordance worth
  // keeping when there is no dialog: the panel sits over a page somebody is
  // reading, and the way out has to be the way out of everything else.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    setOpen(false);
    // Focus goes back where it came from, or it is lost at the top of the
    // document and the next Tab starts from the beginning of the page.
    launcher.current?.focus();
  }

  async function ask(message: string) {
    if (pending || message.trim() === "") return;
    setPending(true);
    setTurns((prior) => [
      ...prior,
      { role: "user", segments: [{ kind: "text", text: message }] },
      { role: "assistant", segments: [] },
    ]);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { lines, rest } = takeLines(buffer);
        buffer = rest;

        for (const raw of lines) {
          const frame = parseFrame(raw);
          if (frame) setTurns((prior) => applyFrame(prior, frame));
        }
      }
    } catch (error) {
      // A failed request must not leave an empty bubble sitting there looking
      // like the assistant is still thinking.
      setTurns((prior) =>
        applyFrame(prior, {
          t: "error",
          message:
            error instanceof Error ? error.message : "Couldn't reach the assistant.",
        }),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        ref={launcher}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls="assistant-panel"
        className="fixed bottom-6 right-6 z-30 rounded-[var(--radius-pill)] bg-accent px-5 py-3 font-[550] text-on-accent shadow-[var(--shadow-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Ask
      </button>

      {open ? (
        <aside
          id="assistant-panel"
          aria-label="Assistant"
          /* Non-modal on purpose: the page underneath stays readable and
             scrollable, because half the questions this answers are about what
             is on it. */
          className="fixed inset-x-4 bottom-24 z-30 flex max-h-[70vh] flex-col gap-4 rounded-[var(--radius-card)] border border-hairline bg-raised p-5 shadow-[var(--shadow-raised)] sm:inset-x-auto sm:right-6 sm:w-96"
        >
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-[650] text-ink">Ask about your account</p>
            <button
              type="button"
              onClick={close}
              className="text-[length:var(--text-meta-size)] text-ink-muted hover:text-ink"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {turns.length > 0 ? (
              <ul className="flex list-none flex-col gap-3 p-0 m-0">
                {turns.map((turn, i) => (
                  <li
                    key={i}
                    className={
                      turn.role === "user"
                        ? "rounded-[var(--radius-control)] bg-ground px-3.5 py-2.5"
                        : "flex flex-col gap-3 px-0.5"
                    }
                  >
                    {turn.segments.length === 0 ? (
                      <span className="text-ink-muted">
                        {turn.note ?? "Thinking…"}
                      </span>
                    ) : (
                      turn.segments.map((segment, s) =>
                        segment.kind === "text" ? (
                          <span key={s} className="whitespace-pre-wrap">
                            {segment.text}
                          </span>
                        ) : (
                          /* Capped and scrolling inside itself, so a month grid
                             cannot push the composer off the bottom of the
                             panel — §6.1. */
                          <div
                            key={s}
                            className="max-h-96 overflow-y-auto overflow-x-auto"
                          >
                            <Widget view={segment.view} />
                          </div>
                        ),
                      )
                    )}
                    {turn.note && turn.segments.length > 0 ? (
                      <span className="text-ink-muted">{turn.note}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <p className="text-[length:var(--text-meta-size)] text-ink-muted">
                  Where you are, what you are paying, where to find things. It
                  can look those up — it can&rsquo;t change them.
                </p>
                {OPENERS.map((opener) => (
                  <button
                    key={opener}
                    type="button"
                    onClick={() => void ask(opener)}
                    className="rounded-[var(--radius-pill)] border border-hairline px-3 py-1.5 text-[length:var(--text-meta-size)] text-ink-muted hover:text-ink"
                  >
                    {opener}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem(
                "message",
              ) as HTMLInputElement;
              const value = input.value;
              input.value = "";
              void ask(value);
            }}
            className="flex items-center gap-2"
          >
            <input
              name="message"
              placeholder="Ask about your account"
              aria-label="Ask the assistant"
              disabled={pending}
              className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-hairline bg-ground px-3.5 py-2 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-control)] bg-accent px-3.5 py-2 font-[550] text-on-accent disabled:opacity-60"
            >
              Ask
            </button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
