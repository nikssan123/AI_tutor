import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  callStructured,
  MAX_SCHEMA_ATTEMPTS,
  modelFor,
  type ParseOutcome,
} from "@/lib/ai/call";
import {
  createAnthropic,
  getAnthropic,
  hasApiKey,
  resetAnthropic,
  resolveApiKey,
} from "@/lib/ai/client";
import { MODELS } from "@/lib/ai/models";

/**
 * The one place a model call is actually made.
 *
 * The SDK is stubbed here rather than called: what needs testing is the
 * behaviour §14.9.5 specifies around the call — the schema retry, the refusal
 * rule, the usage arithmetic — and none of that is a property of the network.
 * The prompt and schema themselves are verified against the real API, which is
 * a different kind of check and does not belong in a unit suite.
 */

const usage = (over: Partial<Anthropic.Usage> = {}) =>
  ({
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    ...over,
  }) as Anthropic.Usage;

function reply(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "tool_use", id: "toolu_1", name: "submit", input: { value: 42 } },
    ],
    ...over,
  } as Anthropic.Message;
}

/** A stub whose `messages.create` returns each queued reply in turn. */
function stub(replies: Anthropic.Message[]) {
  const create = vi.fn(
    async (_body: Anthropic.MessageCreateParamsNonStreaming) =>
      replies.shift() ?? reply(),
  );
  return {
    client: { messages: { create } } as unknown as Anthropic,
    create,
  };
}

const parseValue = (raw: unknown): ParseOutcome<number> => {
  const value = (raw as { value?: unknown }).value;
  return typeof value === "number"
    ? { ok: true, value }
    : { ok: false, error: "value must be a number" };
};

const call = {
  step: "curriculumArchitect" as const,
  system: "frozen system prompt",
  user: "volatile user content",
  tool: { name: "submit", description: "submit it", inputSchema: { type: "object" } },
  parse: parseValue,
};

afterEach(() => {
  resetAnthropic();
  vi.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("the client", () => {
  it("reports whether a key is configured", () => {
    expect(hasApiKey({ ANTHROPIC_API_KEY: "sk-test" })).toBe(true);
    expect(hasApiKey({ ANTHROPIC_API_KEY: "" })).toBe(false);
    expect(hasApiKey({})).toBe(false);
  });

  it("fails with an actionable message when the key is absent", () => {
    expect(() => resolveApiKey({})).toThrow(/ANTHROPIC_API_KEY is not set/);
    expect(() => resolveApiKey({})).toThrow(/\.env\.local/);
  });

  it("builds a client without calling anything", () => {
    expect(createAnthropic("sk-test")).toBeDefined();
    expect(resolveApiKey({ ANTHROPIC_API_KEY: "sk-test" })).toBe("sk-test");
  });

  it("caches the client and rebuilds it after a reset", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const first = getAnthropic();
    expect(getAnthropic()).toBe(first);
    resetAnthropic();
    expect(getAnthropic()).not.toBe(first);
  });
});

describe("model routing (§14.9.3)", () => {
  it("routes each step to its own tier", () => {
    expect(modelFor("curriculumArchitect")).toBe(MODELS.standard);
    expect(modelFor("curriculumValidator")).toBe(MODELS.deep);
    expect(modelFor("artifactIngestor")).toBe(MODELS.fast);
  });

  it("degrades deep to standard rather than overspending (§14.9.7 limit 1)", () => {
    expect(modelFor("curriculumValidator", true)).toBe(MODELS.standard);
    // Degrading something already cheap must not silently upgrade it.
    expect(modelFor("artifactIngestor", true)).toBe(MODELS.fast);
  });
});

describe("callStructured", () => {
  it("returns the parsed value on a first-attempt success", async () => {
    const { client, create } = stub([reply()]);
    const result = await callStructured(client, call);

    expect(result).toMatchObject({ status: "ok", value: 42, attempts: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("puts the cache breakpoint on the frozen system prompt (§14.9.4)", async () => {
    const { client, create } = stub([reply()]);
    await callStructured(client, call);

    const body = create.mock.calls[0]![0];
    expect(body.system).toEqual([
      {
        type: "text",
        text: "frozen system prompt",
        cache_control: { type: "ephemeral" },
      },
    ]);
    // Volatile content strictly after the breakpoint — the whole point of it.
    expect(body.messages[0]).toEqual({
      role: "user",
      content: "volatile user content",
    });
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit" });
  });

  it("retries once, naming what was wrong (§14.9.5)", async () => {
    const { client, create } = stub([
      reply({
        content: [
          { type: "tool_use", id: "t", name: "submit", input: { value: "forty-two" } },
        ],
      } as Partial<Anthropic.Message>),
      reply(),
    ]);

    const result = await callStructured(client, call);
    expect(result).toMatchObject({ status: "ok", value: 42, attempts: 2 });

    const second = create.mock.calls[1]![0];
    const retry = second.messages.at(-1)!;
    // Asking again and hoping is not a retry strategy; the error goes back.
    expect(String(retry.content)).toContain("value must be a number");
  });

  it("gives up after two schema failures rather than looping", async () => {
    const bad = reply({
      content: [{ type: "tool_use", id: "t", name: "submit", input: {} }],
    } as Partial<Anthropic.Message>);
    const { client, create } = stub([bad, bad]);

    const result = await callStructured(client, call);
    expect(result).toMatchObject({
      status: "invalid",
      attempts: MAX_SCHEMA_ATTEMPTS,
    });
    expect(create).toHaveBeenCalledTimes(MAX_SCHEMA_ATTEMPTS);
  });

  it("treats a missing tool call as a schema failure", async () => {
    const noTool = reply({
      content: [{ type: "text", text: "I'd rather explain", citations: null }],
    } as Partial<Anthropic.Message>);
    const { client } = stub([noTool, noTool]);

    const result = await callStructured(client, call);
    expect(result).toMatchObject({ status: "invalid" });
    expect(result.status === "invalid" && result.detail).toContain("no tool call");
  });

  it("never retries a refusal, and reads stop_reason before content", async () => {
    // §14.9.5 — "check stop_reason before reading content. Never retry the
    // identical prompt." A refused prompt refused for a reason.
    const { client, create } = stub([
      reply({
        stop_reason: "refusal",
        content: [],
        stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
      } as Partial<Anthropic.Message>),
    ]);

    const result = await callStructured(client, call);
    expect(result.status).toBe("refused");
    expect(result.status === "refused" && result.detail).toBe("declined");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain message when a refusal carries no explanation", async () => {
    const { client } = stub([
      reply({ stop_reason: "refusal", content: [] } as Partial<Anthropic.Message>),
    ]);
    const result = await callStructured(client, call);
    expect(result.status === "refused" && result.detail).toBe(
      "The model declined.",
    );
  });

  it("accumulates usage across attempts, including the cache counters", async () => {
    const bad = reply({
      content: [{ type: "tool_use", id: "t", name: "submit", input: {} }],
      usage: usage({ cache_creation_input_tokens: 900 }),
    } as Partial<Anthropic.Message>);
    const good = reply({
      usage: usage({ cache_read_input_tokens: 900 }),
    } as Partial<Anthropic.Message>);
    const { client } = stub([bad, good]);

    const result = await callStructured(client, call);
    expect(result.usage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      cacheCreationInputTokens: 900,
      // §14.9.4 — this is the number the caching assertion reads. A silent
      // cache miss triples the bill with no error and no log line.
      cacheReadInputTokens: 900,
    });
  });

  it("treats absent cache counters as zero rather than NaN", async () => {
    const { client } = stub([
      reply({
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        } as Anthropic.Usage,
      } as Partial<Anthropic.Message>),
    ]);

    const result = await callStructured(client, call);
    expect(result.usage.cacheReadInputTokens).toBe(0);
    expect(result.usage.cacheCreationInputTokens).toBe(0);
  });

  it("uses adaptive thinking and high effort by default, and honours overrides", async () => {
    const { client, create } = stub([reply(), reply()]);

    await callStructured(client, call);
    const first = create.mock.calls[0]![0];
    expect(first.thinking).toEqual({ type: "adaptive" });
    expect(first.output_config).toEqual({ effort: "high" });
    expect(first.max_tokens).toBe(16_000);

    await callStructured(client, { ...call, effort: "low", maxTokens: 2048 });
    const second = create.mock.calls[1]![0];
    expect(second.output_config).toEqual({ effort: "low" });
    expect(second.max_tokens).toBe(2048);
  });

  it("routes a degraded call to the cheaper model", async () => {
    const { client, create } = stub([reply()]);
    await callStructured(client, {
      ...call,
      step: "curriculumValidator",
      degraded: true,
    });

    const body = create.mock.calls[0]![0];
    expect(body.model).toBe(MODELS.standard);
  });
});
