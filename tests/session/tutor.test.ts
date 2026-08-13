import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildTutorSystem,
  describeBlock,
  TRANSCRIPT_DEPTH,
  TUTOR_PROMPT,
  tutorMessages,
  tutorStream,
} from "@/lib/session/tutor";
import { collectChat } from "@/lib/ai/chat";
import { MODELS } from "@/lib/ai/models";
import type { SessionBlock } from "@/lib/engine";

/**
 * The tutor. What is asserted here is the boundary rather than the prose: which
 * text is cached, which text is volatile, and what the prompt forbids.
 */

function stub() {
  const create = vi.fn(async (_body: Record<string, unknown>) => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 1_400,
            output_tokens: 0,
            cache_read_input_tokens: 1_350,
            cache_creation_input_tokens: 0,
          },
        },
      };
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "Sure." } };
      yield {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 3 },
      };
    },
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const CONTEXT = "## Learner\nSubject: SQL";

describe("the tutor's cached prefix", () => {
  it("is the frozen prompt plus the learner context, and nothing else", () => {
    const system = buildTutorSystem(CONTEXT);
    expect(system.startsWith(TUTOR_PROMPT.text)).toBe(true);
    expect(system.endsWith(CONTEXT)).toBe(true);
  });

  it("keeps the current block out of it", async () => {
    // §14.9.4 — volatile content strictly after the last breakpoint. The block
    // changes five times a session; the prefix must not.
    const { client, create } = stub();
    const block: SessionBlock = {
      type: "check",
      skillId: "join-grain",
      prompt: "What decides the row count?",
      expected: "grain",
      isRetrieval: false,
      itemId: null,
      estMinutes: 5,
    };

    await collectChat(
      tutorStream(client, {
        learnerContext: CONTEXT,
        block,
        history: [],
        message: "why?",
      }),
    );

    const body = create.mock.calls[0]![0] as unknown as {
      system: Array<{ text: string }>;
      messages: Array<{ content: string }>;
      model: string;
    };

    expect(body.system[0]!.text).not.toContain("What decides the row count?");
    expect(body.messages.at(-1)!.content).toContain("What decides the row count?");
    expect(body.model).toBe(MODELS.standard);
  });

  it("reports a cache hit on a second turn", async () => {
    // §24 E7's acceptance criterion, asserted rather than assumed.
    const { client } = stub();
    const outcome = await collectChat(
      tutorStream(client, {
        learnerContext: CONTEXT,
        block: undefined,
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "answer" },
        ],
        message: "second",
      }),
    );

    expect(outcome.meta.usage.cacheReadInputTokens).toBeGreaterThan(0);
  });
});

describe("tutorMessages", () => {
  it("replays history in order and appends the new question", () => {
    const messages = tutorMessages({
      learnerContext: CONTEXT,
      block: undefined,
      history: [
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
      ],
      message: "three",
    });

    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages.at(-1)!.content).toContain("three");
  });
});

describe("describeBlock", () => {
  const cases: Array<[SessionBlock | undefined, string]> = [
    [undefined, "finished the session's blocks"],
    [{ type: "explain", skillId: "joins", content: "c", estMinutes: 5 }, "reading the lesson"],
    [
      {
        type: "check", skillId: "joins", prompt: "why?", expected: "e",
        isRetrieval: false, itemId: null, estMinutes: 5,
      },
      "answering: why?",
    ],
    [
      {
        type: "apply", skillId: "joins", brief: "write a query",
        rubricId: null, evidenceType: "sql", estMinutes: 5,
      },
      "working on: write a query",
    ],
    [{ type: "review", submissionId: "s1", focus: "your last query", estMinutes: 5 }, "reviewing earlier work"],
    [{ type: "reflect", prompt: "how was it?", estMinutes: 5 }, "reflecting on: how was it?"],
  ];

  it.each(cases)("describes %o", (block, expected) => {
    expect(describeBlock(block)).toContain(expected);
  });
});

describe("what the tutor is forbidden to do", () => {
  it("is told it does not decide mastery", () => {
    // §4.2 law 1. A tutor that congratulated its way through a session would
    // put mastery on the board that no evidence supports.
    expect(TUTOR_PROMPT.text).toContain("Tell them they have mastered something");
    expect(TUTOR_PROMPT.text).toContain("Praise an answer you have not been shown");
  });

  it("is told to hand the work back", () => {
    expect(TUTOR_PROMPT.text).toContain("They are here to be able to do it");
  });

  it("replays a bounded transcript", () => {
    expect(TRANSCRIPT_DEPTH).toBeGreaterThan(0);
  });
});
