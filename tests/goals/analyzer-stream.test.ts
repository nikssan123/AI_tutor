import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { analyzerStream, partialReply } from "@/lib/goals/analyzer-stream";

/**
 * Reading a sentence out of a JSON object that is still being typed.
 *
 * The tutor streams prose, so its bytes off the wire are its bytes on screen.
 * This is a tool call: what arrives is `{"reply":"Got it — start` and the
 * learner is waiting on one field inside it. Anything that insists on a
 * complete document shows nothing until there is nothing left to wait for.
 */
describe("partialReply", () => {
  it("reads a reply that is still being written", () => {
    expect(partialReply('{"reply":"Got it — start')).toBe("Got it — start");
  });

  it("stops at the closing quote and ignores the rest of the object", () => {
    expect(
      partialReply('{"reply":"All set.","captured":{"subject":"Rust"}}'),
    ).toBe("All set.");
  });

  it("shows nothing before the field has appeared", () => {
    expect(partialReply("")).toBe("");
    expect(partialReply('{"cap')).toBe("");
    expect(partialReply('{"reply"')).toBe("");
    expect(partialReply('{"reply":')).toBe("");
  });

  it("survives stopping midway through an escape", () => {
    // A naive slice puts a stray backslash on screen, or throws.
    expect(partialReply('{"reply":"line one\\')).toBe("line one");
    expect(partialReply('{"reply":"snowman \\u26')).toBe("snowman ");
  });

  it("decodes the escapes a reply actually contains", () => {
    expect(partialReply('{"reply":"one\\ntwo"')).toBe("one\ntwo");
    expect(partialReply('{"reply":"say \\"hi\\""')).toBe('say "hi"');
    expect(partialReply('{"reply":"back\\\\slash"')).toBe("back\\slash");
    expect(partialReply('{"reply":"a\\tb"')).toBe("a\tb");
    expect(partialReply('{"reply":"\\u2014 dash"')).toBe("— dash");
  });

  it("passes an unknown escape through rather than dropping it", () => {
    expect(partialReply('{"reply":"a\\qb"')).toBe("aqb");
  });

  it("is not confused by a reply that mentions the field name", () => {
    expect(partialReply('{"reply":"the \\"reply\\" field"')).toBe(
      'the "reply" field',
    );
  });
});

/** Enough of a stream to drive the generator. */
function events(...list: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of list) yield event;
    },
  };
}

const started = {
  type: "message_start",
  message: {
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
    },
  },
};

const json = (partial_json: string) => ({
  type: "content_block_delta",
  delta: { type: "input_json_delta", partial_json },
});

const finished = (stop_reason: string | null = "tool_use") => ({
  type: "message_delta",
  delta: { stop_reason },
  usage: { output_tokens: 25 },
});

const TURN = {
  reply: "How many hours a week do you have?",
  captured: {
    subject: "Rust",
    matchedPack: null,
    outcomeType: "career",
    statedLevel: "none",
    weeklyHours: null,
    deadline: null,
    motivation: null,
    constraints: [],
    existingAssets: [],
    // Null is a real answer here: it has not come up yet. `toGoalSpec` reads
    // that as "none", which is the lesson those learners already get.
    priorDomain: null,
    levelSaid: "Complete beginner",
    weeklyHoursSaid: null,
    deadlineSaid: null,
  },
  clarity: 0.4,
  done: false,
  chips: ["1-2 hrs"],
};

function clientFor(...list: unknown[]) {
  const create = vi.fn(
    async (body: Record<string, unknown>): Promise<unknown> => {
      void body;
      return events(...list);
    },
  );
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const input = {
  messages: [{ r: "l" as const, t: "Rust" }],
  catalogue: [],
  today: "2026-08-13",
  finalTurn: false,
};

async function drain(stream: ReturnType<typeof analyzerStream>) {
  const chunks: string[] = [];
  let next = await stream.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await stream.next();
  }
  // `done` narrows the value to the generator's return type.
  return { chunks, result: next.value };
}

describe("analyzerStream", () => {
  it("yields only what is new, so the client appends rather than replaces", async () => {
    const whole = JSON.stringify(TURN);
    const cut = whole.indexOf("hours");
    const { client } = clientFor(
      started,
      json(whole.slice(0, cut)),
      json(whole.slice(cut)),
      finished(),
    );

    const { chunks } = await drain(analyzerStream(client, input));

    // Re-yielding the whole reply each time would make a dropped fragment
    // invisible instead of obvious.
    expect(chunks.join("")).toBe(TURN.reply);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("returns the finished turn, parsed against the same contract", async () => {
    const { client } = clientFor(started, json(JSON.stringify(TURN)), finished());
    const { result } = await drain(analyzerStream(client, input));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value.chips).toEqual(["1-2 hrs"]);
    expect(result.value.captured.levelSaid).toBe("Complete beginner");
  });

  it("bills the call, because a streamed turn costs the same real money", async () => {
    // §14.8 — a ledger that only records the blocking calls is wrong by
    // however much this path gets used.
    const { client } = clientFor(started, json(JSON.stringify(TURN)), finished());
    const { result } = await drain(analyzerStream(client, input, () => 1_000));

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 10,
      webSearchRequests: 0,
    });
    expect(result.attempts).toBe(1);
    expect(result.promptName).toBe("goal_analyzer");
  });

  it("asks for the same call the blocking path asks for", async () => {
    const { client, create } = clientFor(
      started,
      json(JSON.stringify(TURN)),
      finished(),
    );
    await drain(analyzerStream(client, input));

    const body = create.mock.calls[0]![0];
    expect(body.stream).toBe(true);
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_turn" });
    // §14.9.4's breakpoint has to be on both paths or the cache is warm for
    // one of them and cold for the other.
    const system = body.system as Array<{ cache_control?: unknown }>;
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("reports a refusal rather than treating it as an answer", async () => {
    const { client } = clientFor(started, json('{"reply":"no"'), finished("refusal"));
    const { result } = await drain(analyzerStream(client, input));
    expect(result.status).toBe("refused");
  });

  it("reports unusable JSON rather than throwing at the caller", async () => {
    const { client } = clientFor(started, json('{"reply":"cut off'), finished());
    const { result } = await drain(analyzerStream(client, input));

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.detail).toMatch(/not valid JSON/);
  });

  /**
   * A cache-cold call reports no cache fields at all. Left undefined they
   * would land in the ledger as `undefined` rather than as nothing having been
   * read, and §14.8's cost arithmetic runs on those numbers.
   */
  it("bills a cache-cold call as zero, not as absent", async () => {
    const cold = {
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    };
    const { client } = clientFor(cold, json(JSON.stringify(TURN)), finished());
    const { result } = await drain(analyzerStream(client, input));

    expect(result.usage.cacheReadInputTokens).toBe(0);
    expect(result.usage.cacheCreationInputTokens).toBe(0);
  });

  /**
   * The model may narrate around the tool call. Only the tool's JSON is the
   * turn; prose deltas are not part of the object being assembled and must not
   * reach the buffer, or the parse at the end fails on text nobody asked for.
   */
  it("ignores deltas that are not the tool call", async () => {
    const prose = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "thinking out loud" },
    };
    const { client } = clientFor(
      started,
      prose,
      json(JSON.stringify(TURN)),
      finished(),
    );
    const { chunks, result } = await drain(analyzerStream(client, input));

    expect(chunks.join("")).toBe(TURN.reply);
    expect(chunks.join("")).not.toMatch(/thinking out loud/);
    expect(result.status).toBe("ok");
  });

  /**
   * A fragment that adds fields after `reply` has closed advances the buffer
   * without advancing the sentence. Yielding "" for it would make the client
   * append nothing, repeatedly.
   */
  it("stays quiet on a fragment that adds nothing to the reply", async () => {
    const whole = JSON.stringify(TURN);
    const end = whole.indexOf(TURN.reply) + TURN.reply.length + 1;
    const { client } = clientFor(
      started,
      json(whole.slice(0, end)),
      json(whole.slice(end)),
      finished(),
    );
    const { chunks } = await drain(analyzerStream(client, input));

    expect(chunks.join("")).toBe(TURN.reply);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });

  it("reports a turn that parsed but does not satisfy the contract", async () => {
    const { client } = clientFor(
      started,
      json(JSON.stringify({ ...TURN, clarity: 4 })),
      finished(),
    );
    const { result } = await drain(analyzerStream(client, input));

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.detail).toMatch(/clarity/);
  });
});
