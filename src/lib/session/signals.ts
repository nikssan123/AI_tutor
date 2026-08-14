import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, type CallResult } from "@/lib/ai/call";
import { logCall } from "@/lib/ai/runlog";
import type { Db } from "@/db";
import type { SessionBlock } from "@/lib/engine";
import { recordMisconception, recordTutorSignal } from "./store";

/**
 * §14.2's Tutor, made useful to the rest of the system (PLAN-ADAPTATION step 3).
 *
 * The tutor is forbidden from marking work, moving mastery, or telling a learner
 * they have got something, and all of that stays true. What it may do is *notice*
 * — and until now everything it noticed was thrown away, which is the difference
 * between a very good explainer and a tutor.
 *
 * So one cheap classification per turn, into a closed set, routed only to places
 * that are **not** mastery claims:
 *
 * - `stuck` raises the next lesson's support level and nudges the planner's
 *   frustration damper. Both already existed; neither had a way to hear about a
 *   learner who was struggling out loud rather than failing a check.
 * - `misconception` is written to the same table the grader writes to, so a wrong
 *   belief said in chat is revisited exactly like one caught in an answer.
 * - `already_knows` is recorded and, for now, does nothing. It is the input to
 *   the prove-it-and-skip offer, which is deliberately a later step: an offer
 *   that skipped a skill without evidence would be a second path to mastery
 *   that bypasses the ledger.
 *
 * **No confidence score.** A model asked for a calibrated probability produces
 * its worst output — the pack generator learned this and computes its priors
 * instead of asking. The prompt asks for `none` unless the signal is obvious,
 * which puts the uncertainty in the decision rather than in a number nobody can
 * trust.
 */

/**
 * Pace folds into the other two on purpose. "Too fast for me" is `stuck` and
 * "too slow for me" is `already_knows`; they carry no information the receptors
 * would treat differently, and a fifth value with nothing reading it is a field
 * that rots.
 */
export const TUTOR_SIGNALS = [
  "none",
  "stuck",
  "already_knows",
  "misconception",
] as const;

export const TutorSignalKind = z.enum(TUTOR_SIGNALS);
export type TutorSignalKind = z.infer<typeof TutorSignalKind>;

export const TutorSignal = z.object({
  signal: TutorSignalKind,
  /** Present only for `misconception`: the wrong belief, in one short phrase. */
  note: z.string().max(300).nullable(),
});
export type TutorSignal = z.infer<typeof TutorSignal>;

export const SIGNAL_PROMPT = {
  name: "tutor_signal",
  version: 1,
  text: `You read one exchange between a learner and their tutor and label what it shows about the learner. You return the label through a tool call.

The labels:

- "stuck" — they have said they do not understand, asked the same thing again, or their question shows the explanation has not landed.
- "already_knows" — they have said this is too easy or already familiar, or their question is about something well beyond what is being taught.
- "misconception" — the learner's own words reveal a specific wrong belief about how something works. Not a gap, not a half-answer: a mistaken model. Put it in "note" as one short phrase describing what they believe.
- "none" — anything else.

"none" is the right answer most of the time. An ordinary question is not being stuck, and a learner who follows an explanation and asks the next thing is making progress. Label the exchange only when it is obvious from what the learner wrote; when you are weighing it up, the answer is "none".

Judge the learner's words, not the tutor's. A tutor who explains something twice has not told you the learner was stuck.

Set "note" to null for every label except "misconception".`,
} as const;

export const SIGNAL_TOOL_SCHEMA = {
  type: "object",
  properties: {
    signal: {
      type: "string",
      enum: [...TUTOR_SIGNALS],
      description: "What this exchange shows about the learner.",
    },
    note: {
      type: ["string", "null"],
      description:
        "For 'misconception' only: the wrong belief, in one short phrase.",
    },
  },
  required: ["signal", "note"],
  additionalProperties: false,
} as const;

/**
 * The exchange, as the classifier sees it.
 *
 * The learner's message comes last and is labelled, because that is the thing
 * being judged — the tutor's answer is context for what the question was
 * responding to, not evidence about the learner.
 */
export function buildSignalPrompt(input: {
  block: SessionBlock | undefined;
  question: string;
  answer: string;
}): string {
  return [
    `The learner is working on: ${describeFocus(input.block)}`,
    "",
    "Tutor said:",
    input.answer.slice(0, 2_000),
    "",
    "Learner said:",
    input.question.slice(0, 2_000),
  ].join("\n");
}

function describeFocus(block: SessionBlock | undefined): string {
  if (!block) return "nothing in particular — the session's blocks are done.";
  switch (block.type) {
    case "explain":
      return `a lesson on ${block.skillId}.`;
    case "check":
      return `a question: ${block.prompt}`;
    case "apply":
      return `a piece of work: ${block.brief}`;
    case "review":
      return `reviewing earlier work: ${block.focus}`;
    case "reflect":
      return `a reflection: ${block.prompt}`;
  }
}

/**
 * The skill a signal is about, or none.
 *
 * Read off the block the learner is looking at rather than asked for, so the
 * model has no opportunity to name a skill that does not exist. A `review` or
 * `reflect` block is not about one skill, and a signal there attaches to
 * nothing — which is correct, and is why the column is nullable.
 */
export function signalSkillFor(block: SessionBlock | undefined): string | null {
  if (!block) return null;
  if (block.type === "review" || block.type === "reflect") return null;
  return block.skillId;
}

export async function classifyTurn(
  client: Anthropic,
  input: { block: SessionBlock | undefined; question: string; answer: string },
  options: { degraded?: boolean } = {},
): Promise<CallResult<TutorSignal>> {
  return callStructured(client, {
    step: "tutorSignal",
    prompt: SIGNAL_PROMPT,
    system: SIGNAL_PROMPT.text,
    user: buildSignalPrompt(input),
    tool: {
      name: "submit_signal",
      description: "Submit the label for this exchange.",
      inputSchema: SIGNAL_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = TutorSignal.safeParse(raw);
      return result.success
        ? { ok: true, value: result.data }
        : {
            ok: false,
            error: result.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          };
    },
    degraded: options.degraded ?? false,
    maxTokens: 200,
  });
}

/**
 * A `misconception` with no note is a label the receptor cannot use — the
 * misconception table's `description` is not nullable, and "something is wrong"
 * helps nobody. Downgraded rather than dropped, so the turn still counts as
 * ordinary rather than being silently discarded.
 */
export function normaliseSignal(signal: TutorSignal): TutorSignal {
  if (signal.signal === "misconception" && !signal.note?.trim()) {
    return { signal: "none", note: null };
  }
  return signal.signal === "misconception"
    ? signal
    : { signal: signal.signal, note: null };
}

/**
 * Classify one turn and file the result. Never throws.
 *
 * This is the whole of step 3's write path, and the swallow is the important
 * part: it runs after the tutor's answer has already streamed to the learner,
 * so there is no response left to fail. A classification that errors, refuses,
 * or comes back unparseable leaves the system exactly as it was — which is the
 * state it was in before signals existed, and a perfectly good one.
 *
 * A `misconception` is written to the misconception table rather than here, so
 * a wrong belief said out loud is revisited by the same machinery that handles
 * one caught in a graded answer. There is no second list for the tutor's
 * version of the same thing.
 */
export async function noteTurn(
  db: Db,
  client: Anthropic,
  input: {
    userId: string;
    sessionId: string;
    packSlug: string;
    block: SessionBlock | undefined;
    question: string;
    answer: string;
    now: Date;
  },
): Promise<TutorSignalKind> {
  try {
    const result = await logCall(
      db,
      input.userId,
      await classifyTurn(client, {
        block: input.block,
        question: input.question,
        answer: input.answer,
      }),
    );
    if (result.status !== "ok") return "none";

    const signal = normaliseSignal(result.value);
    if (signal.signal === "none") return "none";

    const skillSlug = signalSkillFor(input.block);

    if (signal.signal === "misconception" && signal.note && skillSlug) {
      await recordMisconception(db, {
        userId: input.userId,
        packSlug: input.packSlug,
        skillSlug,
        description: signal.note,
        now: input.now,
      });
    }

    await recordTutorSignal(db, {
      userId: input.userId,
      sessionId: input.sessionId,
      packSlug: input.packSlug,
      skillSlug,
      signal: signal.signal,
      now: input.now,
    });

    return signal.signal;
  } catch {
    return "none";
  }
}
