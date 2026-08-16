import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  ANALYZER_PROMPT,
  ANALYZER_TOOL_SCHEMA,
  CLARITY_THRESHOLD,
  CapturedGoal,
  MAX_TURNS,
  buildAnalyzerContext,
  decodeTranscript,
  encodeTranscript,
  isComplete,
  mustFinish,
  runAnalyzer,
  shouldFinishNext,
  turnsTaken,
  type AnalyzerTurn,
  type Message,
} from "@/lib/goals/analyzer";

/**
 * §8 screen 3's intake, which the plan is emphatic is "**Not a form**".
 *
 * The properties worth pinning are the ones a conversation can break silently:
 * that it always stops, and that it never ends on a question the learner is
 * never given the chance to answer.
 */

const CATALOGUE = [
  { slug: "sql-data-analysis", name: "SQL & Data Analysis" },
  { slug: "photography", name: "Photography" },
];

const turn = (over: Partial<AnalyzerTurn> = {}): AnalyzerTurn => ({
  reply: "What do you want to learn?",
  captured: {
    subject: null,
    matchedPack: null,
    outcomeType: null,
    statedLevel: null,
    weeklyHours: null,
    deadline: null,
    motivation: null,
    constraints: [],
    existingAssets: [],
    priorDomain: "none",
  },
  clarity: 0,
  done: false,
  chips: [],
  ...over,
});

const exchange = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => [
    { r: "a" as const, t: `question ${i}` },
    { r: "l" as const, t: `answer ${i}` },
  ]).flat();

function modelReturning(inputs: unknown[]) {
  const create = vi.fn(async (_body: Anthropic.MessageCreateParamsNonStreaming) => ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "tool_use", id: "t", name: "submit", input: inputs.shift() }],
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe("the prompt", () => {
  it("is a versioned file an AgentRun row can record (§14.9.6)", () => {
    expect(ANALYZER_PROMPT.name).toBe("goal_analyzer");
    expect(ANALYZER_PROMPT.version).toBeGreaterThanOrEqual(1);
  });

  it("forbids asking two things at once", () => {
    expect(ANALYZER_PROMPT.text).toContain("more than one question");
  });

  it("tells it to believe the learner about their own time", () => {
    // §16.1's timeFit reads weeklyHours; a model that talks someone up to ten
    // hours builds a plan they abandon in week two.
    expect(ANALYZER_PROMPT.text).toContain("Believe what they tell you");
  });

  /*
   * The question that decides how much subject a generated pack takes on.
   *
   * §7.1's Generated tier writes between 8 and 14 skills whatever it is handed,
   * so an unscoped subject does not fail — it produces a course at the wrong
   * resolution, and the learner finds out after several minutes and about a
   * pound. The learner is the only party who can settle it, and this is the one
   * screen that has them.
   */
  it("asks how much of an uncovered subject the course is for", () => {
    expect(ANALYZER_PROMPT.text).toContain("how much of the subject");
    expect(ANALYZER_PROMPT.text).toContain("Make websites");
  });

  it("refuses to narrow somebody's goal on their behalf", () => {
    // A scope we chose is not a scope they agreed to, and the pack is built to
    // it either way.
    expect(ANALYZER_PROMPT.text).toContain("Never narrow it for them");
  });

  it("does not ask it of a subject we already cover", () => {
    // Those are scoped already, by whoever curated them.
    expect(ANALYZER_PROMPT.text).toContain(
      "Do not ask it for a subject we already cover",
    );
  });
});

describe("the tool schema", () => {
  /*
   * A field the model may omit is a field it will omit, and this one is the
   * difference between a course someone can finish and a tour of a discipline.
   */
  it("requires the scope field, so a turn cannot silently skip it", () => {
    const captured = ANALYZER_TOOL_SCHEMA.properties.captured;
    expect(captured.required).toContain("scope");
    expect(captured.properties.scope.description).toContain("own words");
  });
});

describe("CapturedGoal", () => {
  /*
   * The sidebar goes blank all at once or not at all.
   *
   * `loadIntake` reads the stored object through this schema and keeps nothing
   * when the parse fails, so a single field added after conversations were
   * already being saved takes every other field down with it — the card whose
   * whole claim is that it repeats what it heard rendered five dashes over a
   * row that had the subject, the level and the hours in it.
   */
  const beforePriorDomain = {
    subject: "JavaScript",
    matchedPack: null,
    outcomeType: "career",
    statedLevel: "none",
    weeklyHours: 4,
    deadline: null,
    motivation: "Get a dev job",
    constraints: [],
    existingAssets: [],
    levelSaid: "Complete beginner",
    weeklyHoursSaid: "3-5 hrs",
    deadlineSaid: null,
  };

  it("loads a conversation saved before priorDomain existed", () => {
    const parsed = CapturedGoal.safeParse(beforePriorDomain);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.subject).toBe("JavaScript");
    expect(parsed.data?.priorDomain).toBeUndefined();
  });

  it("still rejects a row that is wrong rather than merely old", () => {
    expect(
      CapturedGoal.safeParse({ ...beforePriorDomain, priorDomain: "juggling" })
        .success,
    ).toBe(false);
  });

  /*
   * `scope` arrived after conversations were already being saved, so it is
   * `nullish` for the reason `priorDomain` is: required-nullable, one missing
   * key fails the parse, `loadIntake` keeps nothing, and the sidebar goes blank
   * over a row that has the subject, the level and the hours in it.
   */
  it("loads a conversation saved before scope existed", () => {
    const parsed = CapturedGoal.safeParse(beforePriorDomain);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.scope).toBeUndefined();
  });

  it("keeps the scope as it was said, up to a sentence or two", () => {
    const said = "put a portfolio site online that I can update myself";
    expect(CapturedGoal.safeParse({ ...beforePriorDomain, scope: said }).data?.scope)
      .toBe(said);
    expect(
      CapturedGoal.safeParse({ ...beforePriorDomain, scope: "x".repeat(301) })
        .success,
    ).toBe(false);
  });
});

describe("the transcript", () => {
  it("round-trips", () => {
    const messages: Message[] = [
      { r: "l", t: "I want to learn SQL" },
      { r: "a", t: "How much time do you have?" },
    ];
    expect(decodeTranscript(encodeTranscript(messages))).toEqual(messages);
  });

  it("starts again rather than throwing on a mangled value", () => {
    // The failure mode of the first screen must be "start again", never a 500.
    expect(decodeTranscript("not base64 at all!!")).toEqual([]);
    expect(decodeTranscript(undefined)).toEqual([]);
    expect(decodeTranscript(Buffer.from('"nope"').toString("base64url"))).toEqual(
      [],
    );
  });

  it("drops entries that are not messages", () => {
    const raw = Buffer.from(
      JSON.stringify([{ r: "l", t: "keep" }, { r: "x", t: "drop" }, null, 7]),
      "utf8",
    ).toString("base64url");
    expect(decodeTranscript(raw)).toEqual([{ r: "l", t: "keep" }]);
  });

  it("refuses to grow past the turn cap however long the field is", () => {
    const long = Array.from({ length: 500 }, () => ({ r: "l", t: "x" }));
    const raw = Buffer.from(JSON.stringify(long), "utf8").toString("base64url");
    expect(decodeTranscript(raw).length).toBeLessThanOrEqual(MAX_TURNS * 2);
  });

  it("bounds a single message", () => {
    const raw = Buffer.from(
      JSON.stringify([{ r: "l", t: "x".repeat(9000) }]),
      "utf8",
    ).toString("base64url");
    expect(decodeTranscript(raw)[0]!.t.length).toBe(2000);
  });
});

describe("the turn cap", () => {
  it("counts only the analyzer's own questions", () => {
    expect(turnsTaken(exchange(3))).toBe(3);
  });

  it("stops at six, always (§24 E3)", () => {
    // "Hard cap in application code, not prompt" — a model asked to limit
    // itself will, until the one conversation where it does not.
    expect(mustFinish(exchange(MAX_TURNS - 1))).toBe(false);
    expect(mustFinish(exchange(MAX_TURNS))).toBe(true);
  });

  it("ends the conversation even when the model wants to keep going", () => {
    expect(isComplete(turn({ done: false, clarity: 0 }), exchange(MAX_TURNS))).toBe(
      true,
    );
  });
});

describe("when the conversation ends", () => {
  it("ends when the analyzer says it is done", () => {
    expect(isComplete(turn({ done: true }), exchange(1))).toBe(true);
  });

  it("does not end on clarity alone", () => {
    /*
     * The bug the live probe showed: ending at clarity 0.8 while the reply was
     * still a question meant the learner was asked "is anything getting in the
     * way?" and then watched their plan appear without answering.
     */
    const high = turn({ clarity: 0.9, done: false, reply: "Anything else?" });
    expect(isComplete(high, exchange(2))).toBe(false);
  });

  it("makes the next turn the closing one once it knows enough", () => {
    expect(shouldFinishNext(CLARITY_THRESHOLD, exchange(2))).toBe(
      true,
    );
    expect(shouldFinishNext(0.2, exchange(2))).toBe(false);
  });

  it("makes the last allowed turn a closing one even at low clarity", () => {
    expect(shouldFinishNext(0, exchange(MAX_TURNS - 1))).toBe(
      true,
    );
  });
});

describe("buildAnalyzerContext", () => {
  const base = {
    messages: [] as Message[],
    catalogue: CATALOGUE,
    today: "2026-08-13",
    finalTurn: false,
  };

  it("carries today, so a relative deadline resolves to a real date", () => {
    // "by March" is only a date if the model knows what year it is.
    expect(buildAnalyzerContext(base)).toContain("2026-08-13");
  });

  it("lists the catalogue by slug, so a match can be checked", () => {
    expect(buildAnalyzerContext(base)).toContain("sql-data-analysis");
  });

  it("says so when there is nothing in the catalogue yet", () => {
    expect(buildAnalyzerContext({ ...base, catalogue: [] })).toContain("none yet");
  });

  it("opens the conversation when there is nothing said yet", () => {
    expect(buildAnalyzerContext(base)).toContain("open it");
  });

  it("tells the model to stop asking on the final turn", () => {
    expect(buildAnalyzerContext({ ...base, finalTurn: true })).toContain(
      "last turn",
    );
    expect(buildAnalyzerContext(base)).not.toContain("last turn");
  });

  it("renders the conversation with both sides labelled", () => {
    const context = buildAnalyzerContext({
      ...base,
      messages: [
        { r: "a", t: "What do you want to learn?" },
        { r: "l", t: "I want to shoot better photos" },
      ],
    });
    expect(context).toContain("You: What do you want to learn?");
    expect(context).toContain("Them: I want to shoot better photos");
  });

  /*
   * The learner clicked a brief or a subject page, so the subject is not an
   * open question — asking it back is asking something they answered with a
   * click, and offering an alternative is arguing with it.
   */
  it("tells the model the subject is settled when a course was chosen", () => {
    const context = buildAnalyzerContext({
      ...base,
      committed: { slug: "photography", name: "Photography" },
    });

    expect(context).toContain("already chosen a course: Photography");
    expect(context).toContain("Do not ask what they want to learn");
    // Pinned in the model's own summary too, so it cannot contradict the
    // screen the learner is looking at. The binding decision is still made in
    // application code by `matchChosen`.
    expect(context).toContain("put photography in matchedPack");
  });

  it("says nothing about a settled subject when none was chosen", () => {
    expect(buildAnalyzerContext(base)).not.toContain("already chosen a course");
    expect(
      buildAnalyzerContext({ ...base, committed: null }),
    ).not.toContain("already chosen a course");
  });

  /*
   * The subject we would have to *write*, and how much of it to write.
   *
   * The prompt carries the rule; this carries the fact the prompt cannot know,
   * which is that the field is still empty on *this* conversation. Without it a
   * model six exchanges deep in level and hours has no signal that the one
   * thing holding the build up is the thing it never asked about — and the turn
   * where that matters is the turn about to be spent.
   */
  it("names the subject that still has to be scoped", () => {
    const context = buildAnalyzerContext({ ...base, toNarrow: "web development" });

    expect(context).toContain("Nobody has written web development for us");
    expect(context).toContain("what they want to be able to do at the end");
  });

  it("says nothing about scope once there is nothing left to narrow", () => {
    for (const toNarrow of [null, undefined]) {
      expect(buildAnalyzerContext({ ...base, toNarrow })).not.toContain(
        "Nobody has written",
      );
    }
  });
});

describe("runAnalyzer", () => {
  it("returns a parsed turn", async () => {
    const { client } = modelReturning([
      turn({ reply: "How much time?", clarity: 0.3, chips: ["1h", "5h"] }),
    ]);
    const result = await runAnalyzer(client, {
      messages: [],
      catalogue: CATALOGUE,
      today: "2026-08-13",
      finalTurn: false,
    });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.value.chips).toEqual(["1h", "5h"]);
  });

  it("runs on the standard tier, not the deep one", async () => {
    const { client, create } = modelReturning([turn()]);
    await runAnalyzer(client, {
      messages: [],
      catalogue: CATALOGUE,
      today: "2026-08-13",
      finalTurn: false,
    });
    expect(create.mock.calls[0]![0].model).toBe("claude-sonnet-5");
  });

  it("reports a turn that does not satisfy the contract", async () => {
    const bad = { reply: "", captured: null, clarity: 5, done: "yes", chips: 0 };
    const { client } = modelReturning([bad, bad]);
    const result = await runAnalyzer(client, {
      messages: [],
      catalogue: CATALOGUE,
      today: "2026-08-13",
      finalTurn: false,
    });
    expect(result.status).toBe("invalid");
  });
});
