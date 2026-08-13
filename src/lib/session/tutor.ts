import { and, asc, eq } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { interaction } from "@/db/schema";
import { streamChat, type ChatOutcome } from "@/lib/ai/chat";
import type { CallMeta } from "@/lib/ai/call";
import { TutorTurn } from "@/lib/contracts/session";
import type { SessionBlock } from "@/lib/engine";

/**
 * §14.2 — the Tutor. Not an agent: "chat with cached learner-context prefix".
 *
 * The design decision that matters is what it is *not* allowed to do. It cannot
 * mark work, it cannot move mastery, and it cannot tell a learner they have got
 * something. Those are the grader's job and the evaluator's job, and a tutor
 * that congratulated its way through a session would put mastery on the board
 * that no evidence supports (§4.2 law 1). It is a very good explainer with the
 * whole learner history in front of it, and nothing more.
 */

export const TUTOR_PROMPT = {
  name: "tutor",
  version: 1,
  text: `You are helping one adult learner through one block of one study session.

Everything you know about them is in the learner context above: what they are trying to do, what they have shown they can do, what they got wrong before. Use it. Do not recite it back at them.

How to answer:

- Answer the question asked. If they ask something small, the answer is small.
- Explain by example wherever an example exists. A worked case beats a description of the general rule.
- When they say they do not understand, do not repeat yourself in different words — change the level. Go concrete, use a smaller case, or start from what they already have evidence for.
- When they say it is too easy, believe them and move on to the harder thing rather than testing them first.
- If they ask you to do the work — write the query, take the photo, draft the email — do not. Show the shape of it on a different example and hand it back. They are here to be able to do it.

What you must never do:

- Tell them they have mastered something, or how far along they are. You are not the part of this system that decides that, and a number you invent here would contradict the record.
- Praise an answer you have not been shown.
- Pretend to know something about their work that is not in the context above.

Plain language, short paragraphs, second person, no emoji. If you are unsure of a fact, say so in the sentence rather than adding a caveat at the end.`,
} as const;

/**
 * The cached prefix: frozen instructions, then the learner context.
 *
 * Instructions first, context second. §14.9.4 puts the breakpoint after the
 * whole thing, and the invariant that matters is that nothing *volatile* follows
 * the block — which is why the current block is passed as a message rather than
 * appended here.
 */
export function buildTutorSystem(learnerContext: string): string {
  return `${TUTOR_PROMPT.text}\n\n---\n\n${learnerContext}`;
}

/**
 * What the learner is looking at, as one line. Volatile, so it goes in the
 * conversation rather than in the cached prefix.
 */
export function describeBlock(block: SessionBlock | undefined): string {
  if (!block) return "They have finished the session's blocks.";
  switch (block.type) {
    case "explain":
      return `They are reading the lesson for ${block.skillId}.`;
    case "check":
      return `They are answering: ${block.prompt}`;
    case "apply":
      return `They are working on: ${block.brief}`;
    case "review":
      return `They are reviewing earlier work: ${block.focus}`;
    case "reflect":
      return `They are reflecting on: ${block.prompt}`;
  }
}

export interface TutorRequest {
  learnerContext: string;
  block: SessionBlock | undefined;
  /** Prior turns, oldest first. */
  history: TutorTurn[];
  message: string;
}

export function tutorMessages(
  request: TutorRequest,
): Array<{ role: "user" | "assistant"; content: string }> {
  return [
    ...request.history.map((turn) => ({ role: turn.role, content: turn.content })),
    {
      role: "user" as const,
      content: `[Where they are: ${describeBlock(request.block)}]\n\n${request.message}`,
    },
  ];
}

export function tutorStream(
  client: Anthropic,
  request: TutorRequest,
  options: { degraded?: boolean } = {},
): AsyncGenerator<string, ChatOutcome, undefined> {
  return streamChat(client, {
    step: "tutor",
    prompt: TUTOR_PROMPT,
    system: buildTutorSystem(request.learnerContext),
    messages: tutorMessages(request),
    maxTokens: 1_500,
    degraded: options.degraded ?? false,
  });
}

/** How much of a conversation is replayed. Older turns are in the context block. */
export const TRANSCRIPT_DEPTH = 20;

export async function transcriptFor(
  db: Db,
  sessionId: string,
  userId: string,
  depth = TRANSCRIPT_DEPTH,
): Promise<TutorTurn[]> {
  const rows = await db
    .select({ role: interaction.role, content: interaction.content })
    .from(interaction)
    .where(
      and(eq(interaction.sessionId, sessionId), eq(interaction.userId, userId)),
    )
    .orderBy(asc(interaction.createdAt))
    .limit(depth);

  // Rows are parsed rather than cast: they are replayed into a request, and a
  // row with an unexpected role would be sent to the API as one.
  return rows.flatMap((row) => {
    const parsed = TutorTurn.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface TurnRecord {
  userId: string;
  sessionId: string;
  question: string;
  answer: string;
  meta: CallMeta;
  now: Date;
}

/**
 * §24 E7 — "`Interaction` logging". Both halves of the turn, in one write.
 *
 * The cost columns hang off the assistant row because that is the row the call
 * produced; the question is logged as free. Splitting a single call's cost
 * across two rows would double-count it the moment anyone sums the column.
 */
export async function logTurn(db: Db, record: TurnRecord): Promise<void> {
  const { meta } = record;

  await db.insert(interaction).values([
    {
      userId: record.userId,
      sessionId: record.sessionId,
      role: "user",
      content: record.question,
      createdAt: record.now,
    },
    {
      userId: record.userId,
      sessionId: record.sessionId,
      role: "assistant",
      content: record.answer,
      tokensIn: meta.usage.inputTokens,
      tokensOut: meta.usage.outputTokens,
      cacheReadTokens: meta.usage.cacheReadInputTokens,
      model: meta.model,
      costCents: meta.costCents,
      latencyMs: meta.latencyMs,
      // One millisecond after the question, so `order by created_at` cannot
      // interleave a question and its answer when both land in the same tick.
      createdAt: new Date(record.now.getTime() + 1),
    },
  ]);
}
