import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { collectChat, streamChat } from "@/lib/ai/chat";
import { MODELS } from "@/lib/ai/models";

/**
 * The streamed call. The SDK is stubbed, because what needs testing is the
 * behaviour around the stream — the cache breakpoint, the usage arithmetic
 * across two events, the refusal — and none of that is a property of the wire.
 */

type Event = Record<string, unknown>;

function events(over: { text?: string[]; cacheRead?: number; stop?: string } = {}) {
  return [
    {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 1_200,
          output_tokens: 0,
          cache_read_input_tokens: over.cacheRead ?? 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
    ...(over.text ?? ["Hello", " there"]).map((text) => ({
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    })),
    // A block that is not text — thinking, say — must not reach the reader.
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "…" } },
    {
      type: "message_delta",
      delta: { stop_reason: over.stop ?? "end_turn" },
      usage: { output_tokens: 42 },
    },
  ] satisfies Event[];
}

function stub(list: Event[] = events()) {
  const create = vi.fn(async (_body: Record<string, unknown>) => ({
    async *[Symbol.asyncIterator]() {
      for (const event of list) yield event;
    },
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const call = {
  step: "tutor" as const,
  prompt: { name: "tutor", version: 1 },
  system: "frozen instructions",
  messages: [{ role: "user" as const, content: "why?" }],
};

describe("streamChat", () => {
  it("yields text as it arrives and returns the accounting", async () => {
    const { client } = stub();
    const chunks: string[] = [];
    const stream = streamChat(client, call, () => 0);

    let next = await stream.next();
    while (!next.done) {
      chunks.push(next.value);
      next = await stream.next();
    }

    expect(chunks).toEqual(["Hello", " there"]);
    expect(next.value.text).toBe("Hello there");
    expect(next.value.refused).toBe(false);
    expect(next.value.meta.model).toBe(MODELS.standard);
    expect(next.value.meta.usage.inputTokens).toBe(1_200);
    // Only `message_delta` reports the real output count; `message_start`
    // reports zero and would under-report every call if it were trusted.
    expect(next.value.meta.usage.outputTokens).toBe(42);
  });

  it("puts the cache breakpoint on the frozen prefix", async () => {
    const { client, create } = stub();
    await collectChat(streamChat(client, call));

    const body = create.mock.calls[0]![0] as unknown as {
      system: Array<{ text: string; cache_control?: unknown }>;
      messages: unknown[];
    };
    expect(body.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[0]!.text).toBe("frozen instructions");
    expect(body.messages).toEqual(call.messages);
  });

  it("reports the cache read, which is how a silent miss becomes visible", async () => {
    const { client } = stub(events({ cacheRead: 1_150 }));
    const outcome = await collectChat(streamChat(client, call));
    expect(outcome.meta.usage.cacheReadInputTokens).toBe(1_150);
    expect(outcome.meta.uncachedCostCents).not.toBe(outcome.meta.costCents);
  });

  it("reads absent cache counters as zero", async () => {
    // Older responses omit the fields entirely rather than sending zero, and a
    // NaN here would poison every cost figure downstream.
    const { client } = stub([
      {
        type: "message_start",
        message: { usage: { input_tokens: 5, output_tokens: 0 } },
      },
      { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 1 },
      },
    ]);

    const outcome = await collectChat(streamChat(client, call));
    expect(outcome.meta.usage.cacheReadInputTokens).toBe(0);
    expect(outcome.meta.usage.cacheCreationInputTokens).toBe(0);
  });

  it("records a refusal without throwing", async () => {
    const { client } = stub(events({ stop: "refusal" }));
    const outcome = await collectChat(streamChat(client, call));
    expect(outcome.refused).toBe(true);
  });

  it("omits adaptive thinking on models that reject it", async () => {
    const { client, create } = stub();
    await collectChat(
      streamChat(client, { ...call, step: "coherenceCheck" as const }),
    );

    const body = create.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(body.model).toBe(MODELS.fast);
    expect(body.thinking).toBeUndefined();
  });

  it("does not make the tutor think before it answers", async () => {
    // §14.9.3 puts the tutor on "none", and a tutor that thinks before every
    // reply is a tutor nobody waits for.
    const { client, create } = stub();
    await collectChat(streamChat(client, call));
    const body = create.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(body.thinking).toBeUndefined();
  });

  it("sends thinking on a step the plan asked for it on", async () => {
    const { client, create } = stub();
    await collectChat(
      streamChat(client, { ...call, step: "rubricGrader" as const }),
    );
    const body = create.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("degrades the model when the caller says the cap is hit", async () => {
    const { client, create } = stub();
    await collectChat(
      streamChat(client, { ...call, step: "rubricGrader" as const, degraded: true }),
    );
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe(
      MODELS.standard,
    );
  });

  it("measures latency from the injected clock", async () => {
    const { client } = stub();
    let t = 0;
    const outcome = await collectChat(
      streamChat(client, call, () => (t += 250)),
    );
    expect(outcome.meta.latencyMs).toBeGreaterThan(0);
  });
});
