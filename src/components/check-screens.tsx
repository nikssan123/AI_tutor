import { Button, Meta, stagger, Status, Title } from "@/components/ui";
import { MAX_ANSWER, needsSelfMark, type Marked } from "@/lib/check/session";
import type { DiagnosticItem } from "@/lib/engine/diagnostic";

/**
 * The three screens in the middle of a running check.
 *
 * Shared because there are two checks now — the broad one across a subject and
 * the deep one on a single skill (§24 E11's `/check/{skill}`) — and the middle
 * of both is identical by definition: a question, then either the marking or
 * the key to mark yourself against. What differs is the framing either side of
 * it, which is what each page still owns.
 *
 * Two copies of these would drift, and the direction is predictable: the copy
 * about what counts and what does not is exactly the copy nobody thinks to
 * update twice.
 */

/**
 * One vocabulary for a verdict, because both result screens print one and a
 * skill that reads "Likely known" on the subject check and something else on
 * its own page would be the same evidence described two ways.
 */
export const BAND_COPY = {
  "likely-known": { tone: "verified" as const, text: "Likely known" },
  unclear: { tone: "attention" as const, text: "Unclear" },
  gap: { tone: "problem" as const, text: "Gap" },
  "not-assessed": { tone: "neutral" as const, text: "Not assessed" },
};

interface Progress {
  /** How many questions have been answered so far. */
  asked: number;
  /** How many this check will ask at most. */
  budget: number;
}

/** A bound Server Action; each page binds its own check's identity into it. */
type Submit = (formData: FormData) => void | Promise<void>;

export function QuestionScreen({
  item,
  asked,
  budget,
  action,
}: Progress & { item: DiagnosticItem; action: Submit }) {
  const closed = !needsSelfMark(item);

  return (
    <>
      <Meta>
        Question {asked + 1} of {budget}
        {/* Neither promise is safe before the fact: an open answer is marked
            when the grader is reachable and inside the day's budget, and marked
            by the learner when it is not. The screen after this one says which
            happened. */}
        {closed ? " · marked automatically" : " · a written answer"}
      </Meta>
      <Title>{item.prompt}</Title>

      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="item" value={item.slug} />

        {closed ? (
          <ul className="flex list-none flex-col gap-0 p-0 m-0 rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-raised)] overflow-hidden">
            {/* The validator rejects any mcq with fewer than two options. */}
            {item.options!.map((option, i) => (
              <li
                key={option}
                className="rise border-b border-hairline last:border-b-0 hover:bg-accent-weak"
                style={stagger(i)}
              >
                <label className="flex cursor-pointer items-center gap-3 px-5 py-4">
                  <input
                    type="radio"
                    name="response"
                    value={String(i)}
                    required
                    className="accent-[var(--color-accent)]"
                  />
                  {option}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <textarea
            name="response"
            rows={6}
            /* The same bound the cookie enforces (`MAX_ANSWER`). Without it a
               long answer is truncated after the fact, or — before that bound
               was tightened — silently dropped the whole cookie and reset the
               check. Told up front instead. */
            maxLength={MAX_ANSWER}
            placeholder="Your answer"
            className="rounded-[var(--radius-control)] border border-hairline bg-surface p-4 text-ink placeholder:text-ink-faint"
          />
        )}

        <div>
          <Button type="submit">
            {/* "Show me a good answer" for an open item, until the grader
                existed. It promised the reveal-and-self-mark screen, which is
                now the fallback rather than the rule — and the button cannot
                know which it will get. One word covers both. */}
            Answer
          </Button>
        </div>
      </form>
    </>
  );
}

/**
 * What the grader said, before anything else happens.
 *
 * Ahead of the result screen on both checks: a marked answer can be the one
 * that finishes a check, and showing the result over the top of it would throw
 * away the only per-answer feedback a visitor gets for free.
 */
export function MarkingScreen({
  prompt,
  marked,
  asked,
  budget,
  action,
}: Progress & { prompt: string; marked: Marked; action: Submit }) {
  const right = marked.c === 1;

  return (
    <>
      <Meta>
        Question {asked} of {budget} · marked
      </Meta>
      <Title>{prompt}</Title>

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-raised)]">
        <Meta>What you wrote</Meta>
        <p className="whitespace-pre-wrap m-0">{marked.r}</p>
      </div>

      <div className="rise flex flex-col gap-3 rounded-[var(--radius-card)] bg-accent-weak p-6">
        <Status tone={right ? "verified" : "attention"}>
          {right ? "Counted as right" : "Not right yet"}
        </Status>
        {/* §8.5.4 — --ink-faint is under the small-text bar on this fill. */}
        <p className="m-0 max-w-[var(--measure)] text-[length:var(--text-label-size)] leading-[var(--text-body-line)] text-ink">
          {marked.f}
        </p>
      </div>

      <form action={action}>
        <Button type="submit">Next question</Button>
      </form>
    </>
  );
}

/** The fallback, for when nothing could mark the answer. §7.2 makes it Tier 5. */
export function SelfMarkScreen({
  prompt,
  response,
  concepts,
  asked,
  budget,
  action,
}: Progress & {
  prompt: string;
  response: string;
  concepts: string[];
  action: Submit;
}) {
  return (
    <>
      <Meta>
        Question {asked + 1} of {budget} · mark your own answer
      </Meta>
      <Title>{prompt}</Title>

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-raised)]">
        <Meta>What you wrote</Meta>
        <p className="whitespace-pre-wrap m-0">{response || "(left blank)"}</p>
      </div>

      <div className="rise flex flex-col gap-2 rounded-[var(--radius-card)] bg-accent-weak p-6">
        {/* §8.5.4 — --ink-faint is under the small-text bar on this fill. */}
        <Meta tone="muted">A good answer covers</Meta>
        <ul className="flex list-disc flex-col gap-1 pl-5 m-0">
          {concepts.map((concept) => (
            <li key={concept}>{concept}</li>
          ))}
        </ul>
      </div>

      <form action={action} className="flex gap-3">
        <Button type="submit" name="got" value="1">
          I had that
        </Button>
        <Button type="submit" name="got" value="0" variant="text">
          I did not
        </Button>
      </form>

      <Meta>Either way, this does not count. It is practice.</Meta>
    </>
  );
}
