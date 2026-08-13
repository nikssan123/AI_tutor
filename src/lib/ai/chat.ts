import type Anthropic from "@anthropic-ai/sdk";
import { STEP_EFFORT, supportsAdaptiveThinking, type STEP_MODELS } from "./models";
import { modelFor, type CallMeta, type CallUsage, type PromptRef } from "./call";
import { costCentsFor, uncachedCostCentsFor } from "./pricing";

/**
 * A streamed conversational call — the other half of §14.9.3's "sync only where
 * a human is waiting".
 *
 * `callStructured` covers every step that returns an object. This covers the two
 * that return prose to a person watching it appear: the tutor, and anything
 * after it that streams. They are separate functions rather than one with a
 * flag, because they differ in the thing that matters — a structured call can be
 * retried against its schema, and a stream that has already reached the reader
 * cannot be taken back.
 *
 * What is shared is everything §14.9.4 cares about: the cache breakpoint sits on
 * the frozen system prefix, and the same `CallMeta` comes back, so a tutor turn
 * lands in `AgentRun` beside a curriculum generation with the same fields.
 */

export interface ChatCall {
  step: keyof typeof STEP_MODELS;
  prompt: PromptRef;
  /**
   * The cached prefix: frozen instructions plus the Learner Context Block.
   * Everything volatile belongs in `messages`, strictly after this.
   */
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  degraded?: boolean;
}

export interface ChatOutcome {
  /** Everything that was streamed, joined. What gets stored as the turn. */
  text: string;
  meta: CallMeta;
  /** §14.9.5 — set when the model declined; `text` is then whatever preceded it. */
  refused: boolean;
}

const EMPTY_USAGE: CallUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/**
 * Yields text as it arrives and returns the accounting when it finishes.
 *
 * A generator rather than a callback so the route handler can pipe deltas
 * straight into a `ReadableStream` and still get a `CallMeta` to log — §14.8
 * wants the row written whatever happened, and a streamed call that nobody
 * accounted for is exactly the kind of spend that goes unnoticed.
 */
export async function* streamChat(
  client: Anthropic,
  call: ChatCall,
  clock: () => number = Date.now,
): AsyncGenerator<string, ChatOutcome, undefined> {
  const model = modelFor(call.step, call.degraded);
  const startedAt = clock();
  let usage = EMPTY_USAGE;
  let text = "";
  let refused = false;

  const stream = await client.messages.create({
    model,
    max_tokens: call.maxTokens ?? 2_000,
    // §14.9.3 puts the tutor on "none", and Haiku rejects the parameter
    // outright, so it is sent only where the plan asked for it and the model
    // has it. A tutor that thinks before every reply is a tutor nobody waits for.
    ...(supportsAdaptiveThinking(model) && STEP_EFFORT[call.step] !== null
      ? {
          thinking: { type: "adaptive" as const },
          output_config: { effort: STEP_EFFORT[call.step] },
        }
      : {}),
    system: [
      {
        type: "text",
        text: call.system,
        // §14.9.4 layer 1. The prefix is the frozen prompt plus the Learner
        // Context Block, which is why the context block may not carry a
        // timestamp: this breakpoint is the one that pays for itself.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: call.messages,
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "message_start") {
      usage = {
        inputTokens: event.message.usage.input_tokens,
        outputTokens: event.message.usage.output_tokens,
        cacheReadInputTokens: event.message.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens:
          event.message.usage.cache_creation_input_tokens ?? 0,
      };
      continue;
    }

    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
      yield event.delta.text;
      continue;
    }

    if (event.type === "message_delta") {
      // Output tokens are only final here; `message_start` reports them as 0.
      usage = { ...usage, outputTokens: event.usage.output_tokens };
      if (event.delta.stop_reason === "refusal") refused = true;
    }
  }

  return {
    text,
    refused,
    meta: {
      model,
      promptName: call.prompt.name,
      promptVersion: call.prompt.version,
      attempts: 1,
      usage,
      costCents: costCentsFor(model, usage),
      uncachedCostCents: uncachedCostCentsFor(model, usage),
      latencyMs: clock() - startedAt,
    },
  };
}

/** Drains a stream when the caller wants the whole answer rather than the parts. */
export async function collectChat(
  stream: AsyncGenerator<string, ChatOutcome, undefined>,
): Promise<ChatOutcome> {
  let next = await stream.next();
  while (!next.done) next = await stream.next();
  return next.value;
}
