import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  agentRequest,
  MAX_AGENT_STEPS,
  parseInput,
  runTool,
  streamAgent,
  type AgentFrame,
  type AgentTool,
} from "@/lib/ai/agent";
import { MODELS } from "@/lib/ai/models";

/**
 * The tool loop.
 *
 * The SDK is stubbed for the same reason `chat.test.ts` stubs it: what needs
 * testing is the behaviour around the stream, and none of it is a property of
 * the wire. What is new here is that a "call" is now several requests, so most
 * of these assertions are about what the *second* request carried — whether the
 * tool result got back to the model, and in what shape.
 */

type Event = Record<string, unknown>;

const start = (over: { cacheRead?: number } = {}): Event => ({
  type: "message_start",
  message: {
    usage: {
      input_tokens: 100,
      output_tokens: 0,
      cache_read_input_tokens: over.cacheRead ?? 0,
      cache_creation_input_tokens: 0,
    },
  },
});

const text = (value: string, index = 0): Event => ({
  type: "content_block_delta",
  index,
  delta: { type: "text_delta", text: value },
});

const opensText = (index = 0): Event => ({
  type: "content_block_start",
  index,
  content_block: { type: "text", text: "" },
});

const opensTool = (index: number, id: string, name: string): Event => ({
  type: "content_block_start",
  index,
  content_block: { type: "tool_use", id, name, input: {} },
});

const toolJson = (index: number, partial: string): Event => ({
  type: "content_block_delta",
  index,
  delta: { type: "input_json_delta", partial_json: partial },
});

const end = (stop = "end_turn"): Event => ({
  type: "message_delta",
  delta: { stop_reason: stop },
  usage: { output_tokens: 20 },
});

/** Each argument is one request's worth of events, in order. */
function stub(...lists: Event[][]) {
  const queue = [...lists];
  const create = vi.fn(async (_body: Record<string, unknown>) => {
    const list = queue.shift() ?? [];
    return {
      async *[Symbol.asyncIterator]() {
        for (const event of list) yield event;
      },
    };
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

function tool(over: Partial<AgentTool> = {}): AgentTool {
  return {
    name: "find_page",
    description: "finds a page",
    label: "Looking that up…",
    inputSchema: { type: "object", properties: {} },
    run: async () => ({ forModel: "Billing (/account/billing)", forView: null }),
    ...over,
  };
}

const call = {
  step: "assistant" as const,
  prompt: { name: "assistant", version: 1 },
  system: "frozen instructions",
  messages: [{ role: "user" as const, content: "where do I cancel?" }],
  tools: [tool()],
};

async function collect(stream: ReturnType<typeof streamAgent>) {
  const frames: AgentFrame[] = [];
  let next = await stream.next();
  while (!next.done) {
    frames.push(next.value);
    next = await stream.next();
  }
  return { frames, outcome: next.value };
}

describe("agentRequest", () => {
  it("puts the cache breakpoint on the frozen prefix and lets the model choose", () => {
    const body = agentRequest(call, call.messages);

    expect(body.system).toEqual([
      {
        type: "text",
        text: "frozen instructions",
        cache_control: { type: "ephemeral" },
      },
    ]);
    // Auto, not forced. A pinned tool would make "what can you do?" run a
    // query to answer a question about itself.
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.stream).toBe(true);
  });

  it("declares every registered tool by name and schema", () => {
    const body = agentRequest(call, call.messages);
    expect(body.tools).toEqual([
      {
        name: "find_page",
        description: "finds a page",
        input_schema: { type: "object", properties: {} },
      },
    ]);
  });

  /** §14.9.3 writes "none" against the assistant, and sending it anyway is not
      free — it is latency multiplied by the step count. */
  it("sends no thinking parameters, because the step asks for none", () => {
    const body = agentRequest(call, call.messages) as unknown as Record<string, unknown>;
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  /** The other half of that rule: a step whose row in `STEP_EFFORT` asks for
      thinking still gets it, so the loop is not quietly cheaper than the
      table says. */
  it("sends them for a step that does ask", () => {
    const body = agentRequest({ ...call, step: "packAuthor" }, call.messages) as
      unknown as Record<string, unknown>;

    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });
});

describe("streamAgent", () => {
  it("answers without a tool when the question needs none", async () => {
    const { client, create } = stub([start(), text("I can look "), text("things up."), end()]);

    const { frames, outcome } = await collect(streamAgent(client, call, () => 0));

    expect(frames).toEqual([
      { t: "text", v: "I can look " },
      { t: "text", v: "things up." },
    ]);
    expect(outcome.text).toBe("I can look things up.");
    expect(outcome.stopped).toBe("end");
    expect(outcome.steps).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("runs a tool, says so, and feeds the result back to the model", async () => {
    const { client, create } = stub(
      [
        start(),
        opensTool(0, "tu_1", "find_page"),
        toolJson(0, '{"topic":'),
        toolJson(0, '"cancel"}'),
        end("tool_use"),
      ],
      [start(), text("Billing does that."), end()],
    );

    const { frames, outcome } = await collect(streamAgent(client, call, () => 0));

    // The label is the tool's own words, not the model's.
    expect(frames).toContainEqual({ t: "tool", label: "Looking that up…" });
    expect(outcome.text).toBe("Billing does that.");
    expect(outcome.stopped).toBe("end");

    // Two requests, so two ledger rows (§10).
    expect(outcome.steps).toHaveLength(2);

    const second = create.mock.calls[1]![0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    // The assistant's own turn, then the result — the model cannot read a
    // tool_result that is not answering a tool_use it can see.
    expect(second.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "tool_use", id: "tu_1", name: "find_page", input: { topic: "cancel" } },
      ],
    });
    expect(second.messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_1",
          content: "Billing (/account/billing)",
          is_error: false,
        },
      ],
    });
  });

  it("keeps the model's own words beside the tool it called", async () => {
    const { client, create } = stub(
      [
        start(),
        opensText(0),
        text("Let me check.", 0),
        opensTool(1, "tu_1", "find_page"),
        toolJson(1, "{}"),
        end("tool_use"),
      ],
      [start(), text("Billing."), end()],
    );

    await collect(streamAgent(client, call, () => 0));

    const second = create.mock.calls[1]![0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(second.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "tu_1", name: "find_page", input: {} },
      ],
    });
  });

  it("puts a tool's view on screen without showing the model its contents", async () => {
    const widget = tool({
      run: async () => ({
        forModel: "Rendered September: 3 checkpoints.",
        forView: { widget: "calendar_month", payload: { label: "September" } },
      }),
    });
    const { client, create } = stub(
      [start(), opensTool(0, "tu_1", "find_page"), toolJson(0, "{}"), end("tool_use")],
      [start(), text("There it is."), end()],
    );

    const { frames } = await collect(
      streamAgent(client, { ...call, tools: [widget] }, () => 0),
    );

    expect(frames).toContainEqual({
      t: "widget",
      name: "calendar_month",
      payload: { label: "September" },
    });

    // §2.1 — the model gets the summary, never the payload.
    const second = create.mock.calls[1]![0] as {
      messages: Array<{ role: string; content: Array<{ content: string }> }>;
    };
    expect(second.messages[2]!.content[0]!.content).toBe(
      "Rendered September: 3 checkpoints.",
    );
  });

  /** A name the registry does not have. Said back rather than thrown: the
      model can recover in the next step, and a learner should never see a
      turn die over one. */
  it("tells the model when it asks for a tool that does not exist", async () => {
    const { client, create } = stub(
      [start(), opensTool(0, "tu_1", "read_minds"), toolJson(0, "{}"), end("tool_use")],
      [start(), text("Sorry."), end()],
    );

    const { frames, outcome } = await collect(streamAgent(client, call, () => 0));

    // No label, because nothing ran.
    expect(frames.some((frame) => frame.t === "tool")).toBe(false);
    expect(outcome.stopped).toBe("end");

    const second = create.mock.calls[1]![0] as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    expect(second.messages[2]!.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "There is no tool called read_minds.",
      is_error: true,
    });
  });

  it("turns a thrown tool into a result the model can answer around", async () => {
    const angry = tool({
      run: async () => {
        throw new Error("the database is asleep");
      },
    });
    const { client, create } = stub(
      [start(), opensTool(0, "tu_1", "find_page"), toolJson(0, "{}"), end("tool_use")],
      [start(), text("I couldn't read that."), end()],
    );

    const { outcome } = await collect(
      streamAgent(client, { ...call, tools: [angry] }, () => 0),
    );

    expect(outcome.stopped).toBe("end");
    const second = create.mock.calls[1]![0] as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    expect(second.messages[2]!.content[0]!.content).toContain("the database is asleep");
    expect(second.messages[2]!.content[0]!.is_error).toBe(true);
  });

  it("stops after the step cap rather than looping", async () => {
    const asking = () => [
      start(),
      opensTool(0, "tu_1", "find_page"),
      toolJson(0, "{}"),
      end("tool_use"),
    ];
    const { client, create } = stub(asking(), asking(), asking(), asking(), asking());

    const { outcome } = await collect(streamAgent(client, call, () => 0));

    expect(create).toHaveBeenCalledTimes(MAX_AGENT_STEPS);
    expect(outcome.steps).toHaveLength(MAX_AGENT_STEPS);
    expect(outcome.stopped).toBe("steps");
  });

  it("honours a lower step cap when one is given", async () => {
    const asking = () => [
      start(),
      opensTool(0, "tu_1", "find_page"),
      toolJson(0, "{}"),
      end("tool_use"),
    ];
    const { client, create } = stub(asking(), asking());

    const { outcome } = await collect(
      streamAgent(client, { ...call, maxSteps: 1 }, () => 0),
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(outcome.stopped).toBe("steps");
  });

  /**
   * The clock is asked fresh every pass, because the whole point is that it
   * moves. A budget read once at the top would let the last step start with
   * the budget the first one had.
   */
  it("stops when the budget runs out, before spending another request", async () => {
    const asking = () => [
      start(),
      opensTool(0, "tu_1", "find_page"),
      toolJson(0, "{}"),
      end("tool_use"),
    ];
    const { client, create } = stub(asking(), asking());

    let now = 0;
    const { outcome } = await collect(
      streamAgent(client, { ...call, budgetMs: 100 }, () => {
        const value = now;
        now += 90;
        return value;
      }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(outcome.stopped).toBe("budget");
  });

  it("never starts at all on a budget that was already gone", async () => {
    const { client, create } = stub([start(), text("hi"), end()]);

    const { outcome } = await collect(
      streamAgent(client, { ...call, budgetMs: 0 }, () => 0),
    );

    expect(create).not.toHaveBeenCalled();
    expect(outcome.steps).toEqual([]);
    expect(outcome.stopped).toBe("budget");
  });

  /** §14.9.5 — a refusal is never retried, and here it also ends the loop:
      running the tools of a turn that has already finished is spending for
      nothing. */
  it("stops on a refusal without running the tools it asked for", async () => {
    const { client, create } = stub([
      start(),
      opensTool(0, "tu_1", "find_page"),
      toolJson(0, "{}"),
      end("refusal"),
    ]);

    const { frames, outcome } = await collect(streamAgent(client, call, () => 0));

    expect(outcome.refused).toBe(true);
    expect(outcome.stopped).toBe("refusal");
    expect(frames.some((frame) => frame.t === "tool")).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("prices and times every step separately", async () => {
    const { client } = stub(
      [start(), opensTool(0, "tu_1", "find_page"), toolJson(0, "{}"), end("tool_use")],
      [start(), text("done"), end()],
    );

    let now = 0;
    const { outcome } = await collect(
      streamAgent(client, call, () => {
        now += 5;
        return now;
      }),
    );

    expect(outcome.steps).toHaveLength(2);
    for (const step of outcome.steps) {
      expect(step.model).toBe(MODELS.standard);
      expect(step.promptName).toBe("assistant");
      expect(step.usage.inputTokens).toBe(100);
      expect(step.usage.outputTokens).toBe(20);
      expect(step.costCents).toBeGreaterThan(0);
    }
  });

  it("ignores deltas for blocks that never opened", async () => {
    // Not something the API does — but a lookup that resolves to nothing must
    // not take the turn down, and the text still has to reach the reader.
    const { client } = stub([
      start(),
      text("stray"),
      toolJson(9, '{"topic":"x"}'),
      end(),
    ]);

    const { frames, outcome } = await collect(streamAgent(client, call, () => 0));

    expect(frames).toEqual([{ t: "text", v: "stray" }]);
    expect(outcome.text).toBe("stray");
  });

  /**
   * Everything on the stream that is not this loop's business: a thinking
   * block, its deltas, the stop events between blocks, and a usage report that
   * simply omits the cache counters. None of it may reach the reader, and none
   * of it may derail the step.
   */
  it("ignores the parts of the stream that are not text or a tool", async () => {
    const { client } = stub([
      {
        type: "message_start",
        message: { usage: { input_tokens: 100, output_tokens: 0 } },
      },
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "hmm" },
      },
      { type: "content_block_stop", index: 0 },
      opensText(1),
      text("Billing.", 1),
      { type: "content_block_stop", index: 1 },
      end(),
    ]);

    const { frames, outcome } = await collect(streamAgent(client, call, () => 0));

    expect(frames).toEqual([{ t: "text", v: "Billing." }]);
    expect(outcome.text).toBe("Billing.");
    // A usage report with no cache counters reads as no cache, never as NaN.
    expect(outcome.steps[0]!.usage.cacheReadInputTokens).toBe(0);
    expect(outcome.steps[0]!.usage.cacheCreationInputTokens).toBe(0);
  });

  it("carries the cache read count through to the ledger", async () => {
    const { client } = stub([start({ cacheRead: 900 }), text("hi"), end()]);
    const { outcome } = await collect(streamAgent(client, call, () => 0));
    expect(outcome.steps[0]!.usage.cacheReadInputTokens).toBe(900);
  });
});

describe("runTool", () => {
  it("passes a result straight through", async () => {
    const outcome = await runTool(tool(), {});
    expect(outcome.forModel).toBe("Billing (/account/billing)");
    expect(outcome.failed).toBeUndefined();
  });

  it("names what went wrong, for a model that has to say something", async () => {
    const outcome = await runTool(
      tool({
        run: async () => {
          throw new Error("timeout");
        },
      }),
      {},
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.forModel).toContain("timeout");
    expect(outcome.forView).toBeNull();
  });

  it("survives a tool that throws something that is not an error", async () => {
    const outcome = await runTool(
      tool({
        run: async () => {
          throw "nope";
        },
      }),
      {},
    );

    expect(outcome.forModel).toContain("unknown error");
  });
});

describe("parseInput", () => {
  it("reads the arguments the model streamed", () => {
    expect(parseInput('{"topic":"billing"}')).toEqual({ topic: "billing" });
  });

  /** A tool called with no arguments gets no deltas at all — not an empty
      object — so empty has to mean the same thing. */
  it("treats no arguments as no arguments", () => {
    expect(parseInput("")).toEqual({});
  });

  it("treats JSON that did not finish arriving as nothing usable", () => {
    expect(parseInput('{"topic":')).toEqual({});
  });
});
