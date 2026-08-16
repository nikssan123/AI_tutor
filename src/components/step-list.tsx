import { TickIcon } from "@/components/icons";
import { cx, Meta } from "@/components/ui";

/**
 * The phases of a run, marked off as it reaches them.
 *
 * Extracted when the second wait screen arrived. `/start/building` worked this
 * out for pack authoring — a marker per phase, a thread down the left, one
 * thing pulsing — and `/path` needs exactly the same thing for a curriculum
 * build. Two hand-rolled copies of a list this fiddly is how one of them ends
 * up without the `sr-only` prefixes, which is the half that makes the markers
 * mean anything to somebody who cannot see them.
 *
 * It draws states; it does not decide them. Where a run has got to is read from
 * a row in the database by whoever owns the run, because a step is done when
 * the pipeline says so and never because enough seconds have passed.
 */

export type StepState = "done" | "running" | "waiting";

export interface Step {
  /** What is happening, in five words at the top of a row. */
  title: string;
  /** What that means for what they will get. */
  note: string;
}

/**
 * Where each step stands, given the phase the row says the run is in.
 *
 * A null stage — the row is written before the worker picks it up — leaves
 * every step waiting rather than lighting the first one. The difference is
 * small on screen and is the whole point: a queued run has not started, and
 * saying it has is the sort of small lie that makes the rest of the screen
 * worth nothing.
 *
 * A stage that is not in the list reads the same way, which is what a row
 * written by an older deployment looks like from here.
 */
export function stepStatesFor<Stage extends string>(
  stages: readonly Stage[],
  stage: Stage | null,
): StepState[] {
  const at = stage === null ? -1 : stages.indexOf(stage);

  return stages.map((_, i) =>
    i < at ? "done" : i === at ? "running" : "waiting",
  );
}

/** The disc at the head of a step: filled, ringed, or empty. */
const MARKER: Record<StepState, string> = {
  done: "bg-accent text-on-accent",
  running: "border-2 border-accent bg-accent-weak",
  waiting: "border border-hairline",
};

/**
 * What the marker means, for a reader who cannot see it.
 *
 * §8.5.5 bans colour as the sole carrier of meaning, and a tick against a teal
 * disc is exactly that. The same rule the `Status` dot follows by always
 * carrying its word.
 */
const SAID: Record<StepState, string> = {
  done: "Done: ",
  running: "Happening now: ",
  waiting: "Still to come: ",
};

const LABEL: Record<StepState, string> = {
  done: "text-ink font-[550]",
  running: "text-ink font-[650]",
  waiting: "text-ink-faint font-[550]",
};

export function StepList({
  steps,
  states,
}: {
  steps: readonly Step[];
  /** One per step, in the same order — see `stepStatesFor`. */
  states: readonly StepState[];
}) {
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {steps.map((step, i) => {
        const state = states[i] ?? "waiting";

        return (
          <li key={step.title} className="relative flex gap-4 pb-5 last:pb-0">
            {/* The thread between the markers, drawn behind them and stopped
                short of the last one so the list ends rather than trailing
                off. */}
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-7 bottom-0 left-3 w-px -translate-x-1/2 bg-hairline"
              />
            ) : null}

            <span
              className={cx(
                "relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                MARKER[state],
              )}
            >
              {state === "done" ? <TickIcon className="size-3.5" /> : null}
              {/* The only moving thing on the screen, and it moves for as long
                  as the step does. Reduced motion stops it at one cycle — see
                  the global clamp in tokens.css. */}
              {state === "running" ? (
                <span
                  aria-hidden="true"
                  className="size-2 animate-pulse rounded-full bg-accent"
                />
              ) : null}
            </span>

            <div className="flex min-w-0 flex-col gap-1">
              <span
                className={cx("text-[length:var(--text-label-size)]", LABEL[state])}
              >
                <span className="sr-only">{SAID[state]}</span>
                {step.title}
              </span>
              <Meta>{step.note}</Meta>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
