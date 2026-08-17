import { describe, expect, it, vi } from "vitest";
import {
  buildSignalPrompt,
  classifyTurn,
  normaliseSignal,
  signalSkillFor,
  SIGNAL_PROMPT,
  SIGNAL_TOOL_SCHEMA,
  TUTOR_SIGNALS,
  TutorSignal,
} from "@/lib/session/signals";
import { STEP_EFFORT, STEP_MODELS } from "@/lib/ai/models";
import type Anthropic from "@anthropic-ai/sdk";
import type { SessionBlock } from "@/lib/engine";

/** A client that answers every structured call with one tool_use input. */
function stubClient(input: unknown) {
  const create = vi.fn(async () => ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "tool_use", id: "t", name: "submit_signal", input }],
  } as unknown as Anthropic.Message));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

/**
 * PLAN-ADAPTATION step 3 — the tutor's observations, routed.
 *
 * The line these tests defend is the one §14.2 draws: the tutor may notice, and
 * may not decide. Everything here is about keeping a label a label.
 */

const explain: SessionBlock = {
  type: "explain",
  skillId: "join-grain",
  content: "Teach join grain",
  estMinutes: 12,
};

const reflect: SessionBlock = {
  type: "reflect",
  prompt: "What was hardest?",
  estMinutes: 5,
};

describe("the signal vocabulary", () => {
  it("is closed, and includes the do-nothing label", () => {
    expect([...TUTOR_SIGNALS]).toEqual([
      "none",
      "stuck",
      "already_knows",
      "misconception",
    ]);
  });

  it("offers the model exactly the labels the code handles", () => {
    expect(SIGNAL_TOOL_SCHEMA.properties.signal.enum).toEqual([
      ...TUTOR_SIGNALS,
    ]);
  });

  it("rejects a label nobody wrote a receptor for", () => {
    expect(TutorSignal.safeParse({ signal: "bored", note: null }).success).toBe(
      false,
    );
  });

  /**
   * §14.2's first line reserves classification for the fast tier, and Haiku
   * rejects thinking parameters outright — a call that sent them would 400.
   */
  it("runs on the fast tier with no thinking", () => {
    expect(STEP_MODELS.tutorSignal).toBe("fast");
    expect(STEP_EFFORT.tutorSignal).toBeNull();
  });

  /**
   * The pack generator computes its priors rather than asking, because a model
   * asked for a calibrated number produces its worst output. The same reasoning
   * applies here, so the schema must not grow a confidence field.
   */
  it("asks for no confidence score", () => {
    expect(Object.keys(SIGNAL_TOOL_SCHEMA.properties)).toEqual([
      "signal",
      "note",
    ]);
  });

  it("tells the model that none is the usual answer", () => {
    expect(SIGNAL_PROMPT.text).toMatch(/"none" is the right answer most of the time/);
  });
});

describe("signalSkillFor", () => {
  it("takes the skill from the block rather than from the model", () => {
    expect(signalSkillFor(explain)).toBe("join-grain");
  });

  it("attaches nothing on a block that is not about one skill", () => {
    expect(signalSkillFor(reflect)).toBeNull();
    expect(
      signalSkillFor({
        type: "review",
        submissionId: "s1",
        focus: "your last query",
        estMinutes: 8,
      }),
    ).toBeNull();
  });

  it("attaches nothing once the session is finished", () => {
    expect(signalSkillFor(undefined)).toBeNull();
  });
});

describe("buildSignalPrompt", () => {
  it("puts the learner's words last, as the thing being judged", () => {
    const prompt = buildSignalPrompt({
      block: explain,
      question: "I still don't get it",
      answer: "Here is another way to look at it",
    });

    expect(prompt.indexOf("Tutor said:")).toBeLessThan(
      prompt.indexOf("Learner said:"),
    );
    expect(prompt.trimEnd().endsWith("I still don't get it")).toBe(true);
  });

  it("names what the learner is working on for each block type", () => {
    expect(
      buildSignalPrompt({ block: explain, question: "q", answer: "a" }),
    ).toContain("a lesson on join-grain");
    expect(
      buildSignalPrompt({
        block: { type: "check", skillId: "s", prompt: "Why?", expected: "x", isRetrieval: false, itemId: null, estMinutes: 4 },
        question: "q",
        answer: "a",
      }),
    ).toContain("a question: Why?");
    expect(
      buildSignalPrompt({
        block: { type: "apply", skillId: "s", brief: "Write a query", rubricId: null, evidence: { image: "none" as const, images: 1 }, estMinutes: 20 },
        question: "q",
        answer: "a",
      }),
    ).toContain("a piece of work: Write a query");
    expect(
      buildSignalPrompt({
        block: { type: "review", submissionId: "s1", focus: "your last query", estMinutes: 8 },
        question: "q",
        answer: "a",
      }),
    ).toContain("reviewing earlier work: your last query");
    expect(
      buildSignalPrompt({ block: reflect, question: "q", answer: "a" }),
    ).toContain("a reflection: What was hardest?");
    expect(
      buildSignalPrompt({ block: undefined, question: "q", answer: "a" }),
    ).toContain("nothing in particular");
  });

  it("truncates a long exchange rather than sending it whole", () => {
    const prompt = buildSignalPrompt({
      block: explain,
      question: "x".repeat(5_000),
      answer: "y".repeat(5_000),
    });

    expect(prompt.length).toBeLessThan(4_500);
  });
});

describe("normaliseSignal", () => {
  /**
   * `description` on the misconception table is not nullable, and "something is
   * wrong" helps nobody. A note-less misconception is downgraded rather than
   * written as an empty belief.
   */
  it("downgrades a misconception with nothing to record", () => {
    expect(normaliseSignal({ signal: "misconception", note: null })).toEqual({
      signal: "none",
      note: null,
    });
    expect(normaliseSignal({ signal: "misconception", note: "   " })).toEqual({
      signal: "none",
      note: null,
    });
  });

  it("keeps a misconception that names the belief", () => {
    expect(
      normaliseSignal({
        signal: "misconception",
        note: "thinks LEFT JOIN filters rows",
      }),
    ).toEqual({
      signal: "misconception",
      note: "thinks LEFT JOIN filters rows",
    });
  });

  it("drops a note the other labels have no use for", () => {
    expect(normaliseSignal({ signal: "stuck", note: "chatter" })).toEqual({
      signal: "stuck",
      note: null,
    });
    expect(
      normaliseSignal({ signal: "already_knows", note: "chatter" }),
    ).toEqual({ signal: "already_knows", note: null });
    expect(normaliseSignal({ signal: "none", note: "chatter" })).toEqual({
      signal: "none",
      note: null,
    });
  });
});

describe("classifyTurn", () => {
  const turn = {
    block: explain,
    question: "I still don't follow",
    answer: "Here is another way to look at it",
  };

  it("returns the label the model chose", async () => {
    const { client, create } = stubClient({ signal: "stuck", note: null });

    const result = await classifyTurn(client, turn);

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.value).toEqual({
      signal: "stuck",
      note: null,
    });
    expect(create).toHaveBeenCalled();
  });

  it("keeps the note that comes with a misconception", async () => {
    const { client } = stubClient({
      signal: "misconception",
      note: "thinks LEFT JOIN filters rows",
    });

    const result = await classifyTurn(client, turn);
    expect(result.status === "ok" && result.value.note).toBe(
      "thinks LEFT JOIN filters rows",
    );
  });

  /**
   * The parse callback is the only thing standing between a model that invents
   * a label and a `signal` column full of values no receptor handles.
   */
  it("refuses a label outside the closed set", async () => {
    const { client } = stubClient({ signal: "bored", note: null });

    const result = await classifyTurn(client, turn);
    expect(result.status).not.toBe("ok");
  });

  it("refuses a note longer than the column will take", async () => {
    const { client } = stubClient({
      signal: "misconception",
      note: "x".repeat(400),
    });

    const result = await classifyTurn(client, turn);
    expect(result.status).not.toBe("ok");
  });
});
