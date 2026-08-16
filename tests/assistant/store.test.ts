import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import { interaction, user } from "@/db/schema";
import type { CallMeta } from "@/lib/ai/call";
import {
  assistantHistory,
  dayStart,
  logAssistantTurn,
  messagesToday,
  totalCents,
} from "@/lib/assistant/store";
import { transcriptFor, turnsTaken } from "@/lib/session/tutor";

/**
 * The Assistant's thread, against the real database.
 *
 * The assertion this file exists for is the isolation one: assistant turns
 * share the `interaction` table with the tutor, and the only reason that is
 * safe is that both tutor queries are keyed on a session id. If that ever stops
 * being true, a learner's assistant use starts eating their per-session tutor
 * allowance, and nothing else in the suite would notice.
 */

const NOW = new Date("2026-08-16T09:00:00.000Z");

function meta(over: Partial<CallMeta> = {}): CallMeta {
  return {
    model: "claude-sonnet-5",
    promptName: "assistant",
    promptVersion: 1,
    attempts: 1,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 50,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
    },
    costCents: 0.5,
    uncachedCostCents: 0.7,
    latencyMs: 400,
    ...over,
  };
}

describe("dayStart", () => {
  it("cuts the day at UTC midnight", () => {
    expect(dayStart(new Date("2026-08-16T23:59:59.000Z")).toISOString()).toBe(
      "2026-08-16T00:00:00.000Z",
    );
    expect(dayStart(new Date("2026-08-17T00:00:00.000Z")).toISOString()).toBe(
      "2026-08-17T00:00:00.000Z",
    );
  });
});

describe("totalCents", () => {
  it("adds up what every step of the turn cost", () => {
    expect(totalCents([meta({ costCents: 0.5 }), meta({ costCents: 0.25 })])).toBe(
      0.75,
    );
  });

  /** Null, never a silent zero — the same rule `costCentsFor` follows. */
  it("is null when nothing had a published rate", () => {
    expect(totalCents([meta({ costCents: null })])).toBeNull();
    expect(totalCents([])).toBeNull();
  });

  it("reports what it can when only some steps priced", () => {
    expect(totalCents([meta({ costCents: 0.5 }), meta({ costCents: null })])).toBe(
      0.5,
    );
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("the thread, in the database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const users: string[] = [];

  async function newUser(): Promise<string> {
    const id = `test-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  it("writes both halves of a turn, with the cost on the answer", async () => {
    const userId = await newUser();

    await logAssistantTurn(db, {
      userId,
      question: "what am I paying?",
      answer: "You are on the free plan.",
      steps: [meta(), meta({ costCents: 0.25, latencyMs: 100 })],
      now: NOW,
    });

    const rows = await db
      .select()
      .from(interaction)
      .where(eq(interaction.userId, userId));

    expect(rows).toHaveLength(2);
    const question = rows.find((row) => row.role === "user")!;
    const answer = rows.find((row) => row.role === "assistant")!;

    // The question is logged as free; splitting one turn's cost across two rows
    // would double-count it the moment anyone sums the column.
    expect(question.costCents).toBeNull();
    expect(question.sessionId).toBeNull();
    expect(answer.costCents).toBeCloseTo(0.75);
    expect(answer.tokensIn).toBe(200);
    expect(answer.tokensOut).toBe(40);
    expect(answer.cacheReadTokens).toBe(100);
    expect(answer.latencyMs).toBe(500);
    expect(answer.model).toBe("claude-sonnet-5");
  });

  /**
   * A turn that spent nothing still happened.
   *
   * `streamAgent` returns no steps at all when the budget was already gone
   * before the first request, and the learner still asked — so the question is
   * logged, and the answer row carries no model and no cost rather than a
   * zero that would read as a free call.
   */
  it("logs a turn that never reached a model", async () => {
    const userId = await newUser();

    await logAssistantTurn(db, {
      userId,
      question: "hello?",
      answer: "",
      steps: [],
      now: NOW,
    });

    const [answer] = await db
      .select()
      .from(interaction)
      .where(eq(interaction.role, "assistant"))
      .then((rows) => rows.filter((row) => row.userId === userId));

    expect(answer!.model).toBeNull();
    expect(answer!.costCents).toBeNull();
    expect(answer!.tokensIn).toBe(0);
  });

  it("hands the thread back oldest first, and keeps only the latest", async () => {
    const userId = await newUser();

    for (let i = 0; i < 3; i += 1) {
      await logAssistantTurn(db, {
        userId,
        question: `question ${i}`,
        answer: `answer ${i}`,
        steps: [meta()],
        now: new Date(NOW.getTime() + i * 10_000),
      });
    }

    const all = await assistantHistory(db, userId);
    expect(all.map((turn) => turn.content)).toEqual([
      "question 0",
      "answer 0",
      "question 1",
      "answer 1",
      "question 2",
      "answer 2",
    ]);

    /*
     * The opposite of `transcriptFor`, and the difference is the point: a
     * rolling thread taking the *oldest* twenty would replay a conversation
     * from March for ever while the last thing they said fell off the end.
     */
    const recent = await assistantHistory(db, userId, 2);
    expect(recent.map((turn) => turn.content)).toEqual(["question 2", "answer 2"]);
  });

  it("counts today's questions and not its answers", async () => {
    const userId = await newUser();

    await logAssistantTurn(db, {
      userId,
      question: "one",
      answer: "a",
      steps: [meta()],
      now: NOW,
    });
    await logAssistantTurn(db, {
      userId,
      question: "two",
      answer: "b",
      steps: [meta()],
      now: new Date(NOW.getTime() + 1_000),
    });

    expect(await messagesToday(db, userId, NOW)).toBe(2);
  });

  it("forgets yesterday", async () => {
    const userId = await newUser();

    await logAssistantTurn(db, {
      userId,
      question: "yesterday",
      answer: "a",
      steps: [meta()],
      now: new Date("2026-08-15T22:00:00.000Z"),
    });

    expect(await messagesToday(db, userId, NOW)).toBe(0);
  });

  it("counts nothing for a learner who has never asked", async () => {
    const userId = await newUser();
    expect(await messagesToday(db, userId, NOW)).toBe(0);
    expect(await assistantHistory(db, userId)).toEqual([]);
  });

  /**
   * The isolation that makes sharing the table safe, asserted from both sides.
   */
  it("cannot see or be seen by the tutor's per-session transcript", async () => {
    const userId = await newUser();

    await logAssistantTurn(db, {
      userId,
      question: "where do I cancel?",
      answer: "Billing.",
      steps: [meta()],
      now: NOW,
    });

    // A tutor session that does not exist is enough: what is being asserted is
    // that the assistant's rows do not answer to a session id at all.
    const sessionId = crypto.randomUUID();
    expect(await turnsTaken(db, sessionId, userId)).toBe(0);
    expect(await transcriptFor(db, sessionId, userId)).toEqual([]);

    // And the reverse — a tutor turn is not part of the assistant's thread.
    const rows = await db
      .select()
      .from(interaction)
      .where(eq(interaction.userId, userId));
    expect(rows.every((row) => row.sessionId === null)).toBe(true);
  });

  it("skips a row whose role the schema does not recognise", async () => {
    const userId = await newUser();

    await db.insert(interaction).values({
      userId,
      sessionId: null,
      role: "system",
      content: "not a turn",
      createdAt: NOW,
    });

    // Rows are parsed rather than cast: they are replayed into a request, and a
    // row with an unexpected role would be sent to the API as one.
    expect(await assistantHistory(db, userId)).toEqual([]);
  });
});
