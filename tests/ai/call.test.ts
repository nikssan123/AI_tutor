import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  callStructured,
  MAX_PAUSE_RESUMES,
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
import { MODELS, supportsAdaptiveThinking } from "@/lib/ai/models";

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
  prompt: { name: "test_prompt", version: 3 },
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

  it("knows which models take adaptive thinking, and assumes not for the rest", () => {
    expect(supportsAdaptiveThinking(MODELS.deep)).toBe(true);
    expect(supportsAdaptiveThinking(MODELS.standard)).toBe(true);
    expect(supportsAdaptiveThinking(MODELS.fast)).toBe(false);
    // An unrecognised model gets the conservative answer: omitting the
    // parameters costs a little quality, sending them costs the whole call.
    expect(supportsAdaptiveThinking("some-future-model")).toBe(false);
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
      // No server tools on this call, so nothing to bill per request.
      webSearchRequests: 0,
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

  it("takes its effort from §14.9.3's table, not from a default", async () => {
    // The plan gives extended thinking to three steps and writes "none" against
    // every other one. That column had never been read: every call was sent at
    // `high`, which a live lesson generation paid for in seconds and cents.
    const { client, create } = stub([reply(), reply(), reply()]);

    await callStructured(client, call);
    const architect = create.mock.calls[0]![0];
    expect(architect.thinking).toBeUndefined();
    expect(architect.output_config).toBeUndefined();
    expect(architect.max_tokens).toBe(16_000);

    await callStructured(client, { ...call, step: "curriculumValidator" });
    const validator = create.mock.calls[1]![0];
    expect(validator.thinking).toEqual({ type: "adaptive" });
    expect(validator.output_config).toEqual({ effort: "high" });

    await callStructured(client, { ...call, effort: "low", maxTokens: 2048 });
    const overridden = create.mock.calls[2]![0];
    expect(overridden.output_config).toEqual({ effort: "low" });
    expect(overridden.max_tokens).toBe(2048);
  });

  it("lets a caller force thinking off for a step the table thinks on", async () => {
    const { client, create } = stub([reply()]);
    await callStructured(client, {
      ...call,
      step: "curriculumValidator",
      effort: null,
    });
    expect(create.mock.calls[0]![0].thinking).toBeUndefined();
  });

  it("returns the cost, latency and prompt version an AgentRun row needs", async () => {
    const { client } = stub([
      reply({
        usage: usage({ input_tokens: 1_000_000, output_tokens: 0 }),
      } as Partial<Anthropic.Message>),
    ]);

    // A fake clock, so latency is a fact rather than a race.
    let tick = 1_000;
    const result = await callStructured(client, call, () => (tick += 250));

    expect(result.promptName).toBe("test_prompt");
    expect(result.promptVersion).toBe(3);
    expect(result.latencyMs).toBe(250);
    // 1M Sonnet input tokens at $3/MTok.
    expect(result.costCents).toBeCloseTo(300, 6);
  });

  it("costs a failed call too — a refusal is still billed", async () => {
    const { client } = stub([
      reply({
        stop_reason: "refusal",
        content: [],
        usage: usage({ input_tokens: 1_000_000, output_tokens: 0 }),
      } as Partial<Anthropic.Message>),
    ]);

    const result = await callStructured(client, call);
    expect(result.status).toBe("refused");
    expect(result.costCents).toBeCloseTo(300, 6);
    expect(result.attempts).toBe(1);
  });

  it("omits thinking and effort on a model that rejects them", async () => {
    // Found by a live call, not a double: Haiku 4.5 returns a 400 for either
    // parameter, so sending them unconditionally breaks the whole fast tier.
    const { client, create } = stub([reply()]);
    await callStructured(client, { ...call, step: "artifactIngestor" });

    const body = create.mock.calls[0]![0];
    expect(body.model).toBe(MODELS.fast);
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    // The rest of the request is unchanged — it is the two params, not the call.
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit" });
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

describe("server tools", () => {
  const searching = {
    ...call,
    serverTools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 8 },
    ] as Anthropic.ToolUnion[],
  };

  it("declares them ahead of the submit tool and stops forcing a choice", async () => {
    /*
     * Two halves of one fact. A forced `tool_choice` obliges the model to call
     * that tool first, so it could never search — declaring a server tool and
     * pinning the submit tool would quietly return the schema with none of the
     * research in it. Order matters too: tools render before the cached system
     * prompt, so the server tool has to be a stable prefix.
     */
    const { client, create } = stub([reply()]);
    await callStructured(client, searching);

    const body = create.mock.calls[0]![0];
    expect((body.tools as Array<{ type?: string }>)[0]!.type).toBe(
      "web_search_20260209",
    );
    expect((body.tools as Array<{ name: string }>)[1]!.name).toBe("submit");
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("keeps forcing the tool on every call that declares none", async () => {
    const { client, create } = stub([reply()]);
    await callStructured(client, { ...call, serverTools: [] });
    expect(create.mock.calls[0]![0].tool_choice).toEqual({
      type: "tool",
      name: "submit",
    });
  });

  it("counts the searches the server ran", async () => {
    const { client } = stub([
      reply({
        usage: usage({
          server_tool_use: { web_search_requests: 5, web_fetch_requests: 0 },
        }),
      } as Partial<Anthropic.Message>),
    ]);
    const result = await callStructured(client, searching);
    expect(result.usage.webSearchRequests).toBe(5);
  });

  it("resumes a paused turn instead of treating it as an answer", async () => {
    /*
     * A server tool that runs long comes back `pause_turn`: a real turn, with
     * real usage on it, that has not finished. Re-sending with the partial
     * assistant turn appended is how the server picks up where it stopped.
     */
    const paused = reply({
      stop_reason: "pause_turn",
      content: [
        { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} },
      ],
    } as Partial<Anthropic.Message>);
    const { client, create } = stub([paused, reply()]);

    const result = await callStructured(client, searching);

    expect(result.status).toBe("ok");
    expect(create).toHaveBeenCalledTimes(2);
    // The resume carries the partial turn, and adds no "continue" of its own —
    // the trailing tool use is the signal, and a user message would be read as
    // an instruction.
    const resumed = create.mock.calls[1]![0].messages;
    expect(resumed).toHaveLength(2);
    expect(resumed[1]!.role).toBe("assistant");
  });

  it("bills every leg of a paused turn, not just the one that answered", async () => {
    const paused = reply({
      stop_reason: "pause_turn",
      usage: usage({
        server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 },
      }),
    } as Partial<Anthropic.Message>);
    const { client } = stub([
      paused,
      reply({
        usage: usage({
          server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
        }),
      } as Partial<Anthropic.Message>),
    ]);

    const result = await callStructured(client, searching);
    expect(result.usage.webSearchRequests).toBe(5);
    expect(result.usage.inputTokens).toBe(200);
  });

  it("gives up on a turn that will not stop pausing", async () => {
    // Every resume re-sends the whole transcript, so the cost of waiting grows
    // while the odds do not.
    const paused = () =>
      reply({
        stop_reason: "pause_turn",
        // Mid-search: no submit call yet. A paused turn that *had* already
        // emitted one would be an answer, and is taken as one.
        content: [
          { type: "server_tool_use", id: "srv", name: "web_search", input: {} },
        ],
      } as Partial<Anthropic.Message>);
    const { client, create } = stub(
      Array.from({ length: 20 }, paused),
    );

    const result = await callStructured(client, searching);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.detail).toContain("resumes");
    // Two schema attempts, each spending its own resume budget.
    expect(create.mock.calls.length).toBe(
      MAX_SCHEMA_ATTEMPTS * (MAX_PAUSE_RESUMES + 1),
    );
  });
});
