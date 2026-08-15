"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { replyPart, turnFailed } from "@/lib/goals/intake-protocol";
import { Button, cx, Meta, Status } from "@/components/ui";
import { ANALYZER_BUBBLE, LEARNER_BUBBLE } from "./bubbles";

/**
 * The answer box, and the half-second of honesty around it.
 *
 * Every turn on this screen is a form POST that ends in a redirect, and the
 * server action in the middle calls a model — which takes seconds. Without
 * scripting there is nothing at all to see for that whole time: the tapped chip
 * stays looking untapped, the conversation does not move, and the screen reads
 * as frozen. Reported as exactly that, and reloaded, which is the reasonable
 * thing to do to a page that appears to have died.
 *
 * So this is a progressive enhancement and nothing more. **The forms below are
 * the same forms, with the same server actions, and they still post and
 * redirect with scripting turned off** — which is the property this screen has
 * always had and the reason it has it: the gap between signing up and having a
 * plan is no place to require a bundle. What scripting adds is feedback. Your
 * message appears the moment you send it, the reply gets a thinking indicator,
 * and the controls stop accepting a second answer to a question already on its
 * way.
 *
 * State resets because the server remounts this on every turn — `page.tsx`
 * keys it by the number of messages. Nothing here has to work out when the
 * echo becomes real; it stops existing and the real one is already rendered.
 */

/**
 * How far along the turn is — and the whole reason this is three values rather
 * than a boolean.
 *
 * `reply` is the first field in the analyzer's tool schema, so it lands well
 * before the turn is over: `captured`, `chips`, `clarity` and `done` are still
 * being written after the sentence is complete on screen, and then the turn has
 * to be stored and the page re-rendered before there is a new question to
 * answer. For those several seconds the screen showed a finished-looking
 * question above a box that silently refused to take a word — reported as the
 * site being laggy, which is the right reading of a control that neither works
 * nor says why.
 *
 * So the wait is named instead of hidden. `asking` is the model still writing;
 * `settling` starts when the stream closes and the page is catching up. Both
 * lock the controls, and both say so.
 */
type Phase = "idle" | "asking" | "settling";

/**
 * Three pulsing dots. Decoration only — every place it is used carries the
 * words as well, because an animation is not an announcement.
 */
function Dots() {
  return (
    <span className="inline-flex items-center gap-1.5">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full bg-ink-faint motion-reduce:animate-none"
          style={{ animationDelay: `${dot * 160}ms` }}
        />
      ))}
    </span>
  );
}

/** Ties the locked box to the line that explains why it is locked. */
const STATUS_ID = "reply-status";
export function Composer({
  chips,
  asked,
  maxTurns,
  reply,
  restart,
}: {
  chips: string[];
  asked: number;
  maxTurns: number;
  reply: (formData: FormData) => Promise<void>;
  restart: () => Promise<void>;
}) {
  const router = useRouter();

  /** What they just said, held only until the server sends back the real turn. */
  const [said, setSaid] = React.useState<string | null>(null);
  /** The reply so far, as it is typed. Empty until the first fragment lands. */
  const [arriving, setArriving] = React.useState("");
  /** Set only when the request never reached the server at all. */
  const [failed, setFailed] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const sending = said !== null;

  /**
   * Sends the turn and reads the reply as it is written.
   *
   * The form underneath still posts to `replyAction` when this does not run —
   * scripting off, or the fetch failing outright. What this adds is that the
   * answer appears a word at a time instead of after the whole call, which on
   * this screen is the difference between a few seconds of writing and a few
   * seconds of nothing.
   */
  async function send(message: string) {
    setSaid(message);
    setArriving("");
    setPhase("asking");

    let response: Response;
    try {
      response = await fetch("/api/goal-intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reply: message }),
      });
      if (!response.ok || !response.body) throw new Error(response.statusText);
    } catch {
      // Nothing was saved, so the honest thing is to hand the answer back
      // rather than pretend it went somewhere.
      setSaid(null);
      setPhase("idle");
      setFailed(true);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Everything before the separator is the reply; what follows is how the
      // turn ended, and is for the navigation below rather than the screen.
      setArriving(replyPart(buffer));
    }

    // The stream is closed, so the model has stopped writing and the turn is
    // stored — but the new question is not on screen until the page has been
    // re-rendered, and the controls stay locked until it is. A different wait
    // with a different sentence, rather than the same silence continuing.
    setPhase("settling");

    // The server is the record either way: refreshing swaps this echo for the
    // stored turn, and `page.tsx` keys this component by the message count, so
    // the swap also clears everything above.
    if (turnFailed(buffer)) router.push("/start?error=analyzer");
    else router.refresh();
  }

  /*
   * The echo lands under the composer, which is pinned over it — so on its own
   * it is feedback you cannot see without scrolling for it, which is no better
   * than none. The page ends at the composer, so its full height is the bottom
   * of the conversation: exactly where a chat puts you after you send.
   */
  React.useEffect(() => {
    if (said === null) return;
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [said]);

  const input =
    "min-h-[var(--touch-min)] w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink placeholder:text-ink-faint focus:border-accent transition-colors duration-[var(--dur-fast)]";

  return (
    <>
      {/*
       * The echo, in the same shapes the server uses, sitting exactly where the
       * server-rendered turn will appear. Outside the <ol> deliberately: it is
       * not part of the record until the server says so, and a live region is
       * what tells a screen reader the send actually happened.
       */}
      {sending ? (
        <div
          aria-live="polite"
          className="flex flex-col gap-4"
        >
          <div className={LEARNER_BUBBLE}>
            <span className="sr-only">You said: </span>
            {said}
          </div>
          {/* Dots only until the first fragment lands — after that the reply
              writes itself into the same bubble it will end up in. */}
          {arriving === "" ? (
            <div className={cx(ANALYZER_BUBBLE, "flex items-center gap-1.5")}>
              <span className="sr-only">Thinking…</span>
              <Dots />
            </div>
          ) : (
            <div className={ANALYZER_BUBBLE}>
              {arriving}
              {/* Kept alongside the sentence while the model is still writing.
                  The question is readable seconds before the turn is finished,
                  and a complete-looking question with no sign of anything left
                  to come is what made the locked box below read as a fault. */}
              {phase === "asking" ? (
                <>
                  {" "}
                  <Dots />
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-6 flex flex-col gap-3 border-t border-hairline bg-ground px-6 pt-4 pb-6 max-lg:pb-24">
        {/* Only for a request that never reached the server. Anything the
            server did receive it has already stored, and says so on reload. */}
        {failed ? (
          <Status tone="problem">
            That didn&rsquo;t send. Your answer is still in the box — try again.
          </Status>
        ) : null}

        {/*
         * The lock, in words, next to the thing that is locked.
         *
         * Everything in this bar stops taking input the moment an answer is
         * sent, and until now the only sign of it was the box going faint —
         * which is indistinguishable from a page that has stopped working, and
         * was read as exactly that. It is the description of the input rather
         * than a second live region: the echo above already announces the send,
         * and a screen reader landing on the box should hear why it will not
         * take anything.
         */}
        {sending ? (
          <p
            id={STATUS_ID}
            className="flex items-center gap-2 text-[length:var(--text-meta-size)] text-ink-muted"
          >
            <Dots />
            {phase === "settling"
              ? "Bringing in the next question…"
              : "Working on your answer — you can type again when the next question arrives."}
          </p>
        ) : null}

        {/* Chips are submit buttons carrying their own answer, which is how one
            tap works with no JavaScript at all. */}
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <form
                action={reply}
                key={chip}
                onSubmit={(event) => {
                  // Prevented so the streamed path runs instead of the POST.
                  // With scripting off this never fires and the action does.
                  event.preventDefault();
                  void send(chip);
                }}
              >
                <input type="hidden" name="reply" value={chip} />
                <button
                  type="submit"
                  disabled={sending}
                  className="min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-[length:var(--text-label-size)] transition-colors duration-[var(--dur-fast)] hover:border-accent hover:bg-accent-weak disabled:opacity-50 disabled:pointer-events-none"
                >
                  {chip}
                </button>
              </form>
            ))}
          </div>
        ) : null}

        <form
          action={reply}
          onSubmit={(event) => {
            event.preventDefault();
            // No fallback for a missing field: this handler is only ever
            // attached to the form below, whose `reply` input is always
            // rendered and `required`, so the browser will not submit without
            // it. A branch for the impossible case is a branch nothing can
            // test.
            void send(String(new FormData(event.currentTarget).get("reply")));
          }}
          className="flex flex-col gap-3"
        >
          <label htmlFor="reply" className="sr-only">
            Your answer
          </label>
          {/*
           * `readOnly` rather than `disabled` while a turn is in flight: a
           * disabled control is left out of the FormData, so disabling this one
           * would send the answer it is showing as an empty string.
           */}
          <input
            id="reply"
            name="reply"
            maxLength={500}
            required
            autoComplete="off"
            readOnly={sending}
            aria-describedby={sending ? STATUS_ID : undefined}
            placeholder="Type your answer…"
            // `cursor-not-allowed` because clicking into a box and typing is
            // how anyone finds out this one is closed. Faintness alone reads
            // as a style, not as a state.
            className={cx(input, sending && "opacity-50 cursor-not-allowed")}
          />
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={sending}>
              {sending ? "Sending…" : "Send"}
            </Button>
            <Meta tone="muted">
              {asked} of {maxTurns} questions
            </Meta>
          </div>
        </form>

        {/* Inside the bar rather than after it. A sibling below a sticky
            element gets overlapped by it on the way down, which would leave
            this as a half-covered link. */}
        <form action={restart} className="self-end">
          <button
            type="submit"
            disabled={sending}
            className="text-[length:var(--text-meta-size)] text-ink-faint underline underline-offset-4 hover:text-ink disabled:opacity-50 disabled:pointer-events-none"
          >
            Start over
          </button>
        </form>
      </div>
    </>
  );
}
