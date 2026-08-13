import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildLessonPrompt,
  generateLesson,
  LESSON_PROMPT,
  LESSON_TOOL_SCHEMA,
  minutesBucket,
  styleHashFor,
  type LessonRequest,
} from "@/lib/session/lesson";
import {
  CHECK_CONFIDENCE,
  evidenceTierFor,
  gradeCheck,
  GRADER_PROMPT,
  WRITTEN_ANSWER_TIER,
} from "@/lib/session/grade";
import { MODELS } from "@/lib/ai/models";
import { LessonContent } from "@/lib/contracts/session";

/**
 * The two model calls a session makes. The client is stubbed; what is under
 * test is the contract each one enforces and the routing it picks.
 */

function stub(input: unknown, stopReason = "tool_use") {
  const create = vi.fn(async (_body: Record<string, unknown>) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    content: [{ type: "tool_use", id: "t1", name: "submit", input }],
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const request: LessonRequest = {
  packSlug: "photography",
  skillSlug: "exposure",
  skillName: "Exposure",
  canDoStatement: "expose a scene correctly in manual",
  level: "shaky",
  minutes: 12,
  support: "standard",
};

const lesson = {
  objective: "Set exposure without the meter fighting you.",
  sections: [{ heading: "The triangle", body: "Three settings, one result." }],
  workedExample: "Start at f/8, 1/125, ISO 200. Then…",
  commonMistake: "Chasing the meter needle instead of choosing an exposure.",
};

describe("the lesson cache key", () => {
  it("buckets length, so a 12- and a 13-minute lesson share a lesson", () => {
    expect(minutesBucket(12)).toBe(minutesBucket(13));
    expect([minutesBucket(5), minutesBucket(20), minutesBucket(35), minutesBucket(90)])
      .toEqual([10, 20, 40, 60]);
  });

  it("changes with support level and with the pack", () => {
    const base = styleHashFor(request);
    expect(styleHashFor({ ...request, support: "worked_example" })).not.toBe(base);
    expect(styleHashFor({ ...request, packSlug: "sql-data-analysis" })).not.toBe(base);
  });

  it("does not change with a minute inside the same bucket", () => {
    expect(styleHashFor({ ...request, minutes: 13 })).toBe(styleHashFor(request));
  });

  it("is stable across runs", () => {
    expect(styleHashFor(request)).toBe(styleHashFor(request));
  });
});

describe("the lesson prompt", () => {
  it("names the skill and the time, and never the learner", () => {
    // The whole reason a lesson is cacheable across learners: nothing personal
    // reaches it, so two people at the same level are served the same one.
    const prompt = buildLessonPrompt(request);
    expect(prompt).toContain("Exposure");
    expect(prompt).toContain("about 20 minutes");
    expect(LESSON_PROMPT.text).toContain("shown to many learners");
  });

  it("leads with the worked example when support is up", () => {
    expect(
      buildLessonPrompt({ ...request, support: "worked_example" }),
    ).toContain("Lead with the worked example");
  });

  it("requires every field the contract asserts", () => {
    expect(LESSON_TOOL_SCHEMA.required).toEqual([
      "objective",
      "sections",
      "workedExample",
      "commonMistake",
    ]);
  });
});

describe("generateLesson", () => {
  it("routes to the standard tier and returns a parsed lesson", async () => {
    const { client, create } = stub(lesson);
    const result = await generateLesson(client, request);

    expect(result.status).toBe("ok");
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe(
      MODELS.standard,
    );
  });

  it("rejects a lesson with no sections rather than rendering an empty one", async () => {
    const { client } = stub({ ...lesson, sections: [] });
    const result = await generateLesson(client, request);

    expect(result.status).toBe("invalid");
    expect(LessonContent.safeParse({ ...lesson, sections: [] }).success).toBe(false);
  });

  it("degrades on request", async () => {
    const { client, create } = stub(lesson);
    await generateLesson(client, request, { degraded: true });
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe(
      MODELS.standard,
    );
  });
});

describe("the evidence tier of a written answer", () => {
  it("never reaches Tier 1, whatever the skill", () => {
    // §7.2 — Tier 1's claim is "verified: this works", and it is earned by
    // executing something. Explaining a join in prose is not running one.
    expect(evidenceTierFor(1)).toBe(WRITTEN_ANSWER_TIER);
    expect(evidenceTierFor(2)).toBe(2);
  });

  it("keeps a weaker skill's own tier", () => {
    expect(evidenceTierFor(3)).toBe(3);
    expect(evidenceTierFor(5)).toBe(5);
  });

  it("moves the belief at less than full confidence", () => {
    expect(CHECK_CONFIDENCE).toBeGreaterThan(0);
    expect(CHECK_CONFIDENCE).toBeLessThan(1);
  });
});

describe("gradeCheck", () => {
  it("marks on the fast tier and returns the verdict", async () => {
    const { client, create } = stub({
      correct: true,
      feedback: "You named the grain, which is the bit that matters.",
      misconception: null,
    });

    const result = await gradeCheck(client, {
      question: "What decides the row count of a join?",
      expected: "the grain of the joined tables",
      answer: "the grain",
    });

    expect(result.status).toBe("ok");
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe(MODELS.fast);
    // Haiku 4.5 rejects both parameters outright.
    expect((create.mock.calls[0]![0] as Record<string, unknown>).thinking).toBeUndefined();
  });

  it("carries a misconception through when the answer reveals one", async () => {
    const { client } = stub({
      correct: false,
      feedback: "A join doesn't filter rows out — that's a where clause.",
      misconception: "believes a join filters rows",
    });

    const result = await gradeCheck(client, {
      question: "q",
      expected: "e",
      answer: "joins remove rows",
    });

    expect(result.status === "ok" && result.value.misconception).toBe(
      "believes a join filters rows",
    );
  });

  it("refuses a grade with no feedback in it", async () => {
    const { client } = stub({ correct: true, feedback: "", misconception: null });
    const result = await gradeCheck(client, { question: "q", expected: "e", answer: "a" });
    expect(result.status).toBe("invalid");
  });

  it("tells the model to mark meaning rather than wording", () => {
    expect(GRADER_PROMPT.text).toContain("Mark what the answer says, not how it is written");
  });
});
