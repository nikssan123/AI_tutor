import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { gradePhoto, PHOTO_GRADER_PROMPT } from "@/lib/check/photo";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/ai/images";
import { MODELS } from "@/lib/ai/models";

/**
 * §7.2 tier 3 — a photograph, marked on what the frame shows.
 *
 * The claim this makes is narrow on purpose, and the narrowness is the product:
 * every tier-3 page says "we check the technical side, whether it's any good is
 * your call", and a grader that drifted into taste would make that sentence a
 * lie on the one screen where it is load-bearing.
 */

function stub(input: unknown) {
  const create = vi.fn(async (body: Record<string, unknown>) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: MODELS.standard,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 1600,
      output_tokens: 120,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    content: [{ type: "tool_use", id: "t1", name: "submit_grade", input }],
    _body: body,
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const request = {
  question: "Photograph three objects so exactly the middle one is sharp.",
  expected: "place the zone of sharpness where you intended",
  mediaType: "image/jpeg" as const,
  data: "AAAA",
  note: "f/1.8, 50mm, about a metre.",
};

describe("gradePhoto", () => {
  it("sends the image and the task in one message", async () => {
    const { client, create } = stub({ correct: true, feedback: "The middle one is crisp." });

    const result = await gradePhoto(client, request);
    expect(result.status).toBe("ok");

    const body = create.mock.calls[0]![0] as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const [image, text] = body.messages[0]!.content;

    expect(image).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    });
    expect(String((text as { text: string }).text)).toContain(request.question);
    // The bar it is held against is the skill's own can-do statement.
    expect(String((text as { text: string }).text)).toContain(request.expected);
  });

  it("passes the note along, and says plainly when there is none", async () => {
    const { client, create } = stub({ correct: false, feedback: "No falloff." });

    await gradePhoto(client, { ...request, note: "" });
    const body = create.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ text?: string }> }>;
    };
    expect(body.messages[0]!.content[1]!.text).toContain("wrote nothing");

    await gradePhoto(client, request);
    const second = create.mock.calls[1]![0] as {
      messages: Array<{ content: Array<{ text?: string }> }>;
    };
    expect(second.messages[0]!.content[1]!.text).toContain("f/1.8");
  });

  /**
   * The one step in the check that is not on the fast tier. What this call does
   * is look at a photograph and say whether it demonstrates a technique, and
   * the page then prints that we marked it — a weaker eye would make that claim
   * cheaper and less true.
   */
  it("runs on the standard tier, unlike every other step of a check", async () => {
    const { client, create } = stub({ correct: true, feedback: "Sharp where you said." });
    await gradePhoto(client, request);

    const body = create.mock.calls[0]![0] as { model: string };
    expect(body.model).toBe(MODELS.standard);
    expect(body.model).not.toBe(MODELS.fast);
  });

  it("refuses a verdict the schema does not accept", async () => {
    const { client } = stub({ correct: "yes", feedback: "" });
    expect((await gradePhoto(client, request)).status).toBe("invalid");
  });

  it("marks the technique and says so, rather than the taste", () => {
    // Asserted on the prompt because it is the only place the rule can live —
    // there is no structured field for "did you judge the composition".
    expect(PHOTO_GRADER_PROMPT.text).toContain("never the taste");
    expect(PHOTO_GRADER_PROMPT.text).toContain("not yours to judge");
  });
});

describe("what the upload will take", () => {
  it("accepts what a phone or a camera produces", () => {
    expect(IMAGE_TYPES).toContain("image/jpeg");
    expect(IMAGE_TYPES).toContain("image/png");
    expect(IMAGE_TYPES).toContain("image/webp");
  });

  it("stops under the API's own five-megabyte ceiling", () => {
    // Nothing is resized on the way: adding an image pipeline to a marketing
    // route to save a fraction of a cent would be the wrong trade, and the API
    // downscales anything over its working resolution itself.
    expect(MAX_IMAGE_BYTES).toBeLessThan(5_000_000);
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(4_000_000);
  });
});

/* ── The decision around the call ──────────────────────────────────────── */

const anonymousBudgetSpent = vi.fn();
const logCall = vi.fn();
const gradePhotoMock = vi.fn();

vi.mock("@/lib/ai/runlog", () => ({
  anonymousBudgetSpent: (...a: unknown[]) => anonymousBudgetSpent(...a),
  logCall: (...a: unknown[]) => logCall(...a),
}));
vi.mock("@/lib/session/grade", () => ({ gradeCheck: vi.fn() }));

const { markPhotoAnswer } = await import("@/lib/check/mark");

const db = {} as Db;
const client = {} as Anthropic;
const file = (over: Partial<{ type: string; size: number }> = {}) =>
  ({
    type: over.type ?? "image/jpeg",
    size: over.size ?? 1_000,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }) as unknown as File;

const answer = (f: File) => ({
  question: request.question,
  expected: request.expected,
  file: f,
  note: "",
});

afterEach(() => {
  vi.clearAllMocks();
  anonymousBudgetSpent.mockReset();
  logCall.mockReset();
  gradePhotoMock.mockReset();
});

describe("markPhotoAnswer", () => {
  it("refuses a file that is not an image, before spending anything", async () => {
    const outcome = await markPhotoAnswer(
      { db: () => db, client },
      answer(file({ type: "application/pdf" })),
    );

    expect(outcome).toEqual({ marking: null, refused: "wrong-type" });
    expect(anonymousBudgetSpent).not.toHaveBeenCalled();
  });

  /**
   * The learner's problem rather than ours, and told apart from ours for that
   * reason: no amount of falling back to self-marking helps someone whose file
   * is 20MB, and the sentence they need says what to do instead.
   */
  it("refuses a file too large to send", async () => {
    const outcome = await markPhotoAnswer(
      { db: () => db, client },
      answer(file({ size: MAX_IMAGE_BYTES + 1 })),
    );

    expect(outcome).toEqual({ marking: null, refused: "too-big" });
  });

  it("takes a photo right at the ceiling", async () => {
    anonymousBudgetSpent.mockResolvedValue(true);
    const outcome = await markPhotoAnswer(
      { db: () => db, client },
      answer(file({ size: MAX_IMAGE_BYTES })),
    );

    // Not refused for its size — it got as far as the budget, which is ours.
    expect(outcome).toEqual({ marking: null, refused: null });
  });

  it("falls back to self-marking with no key, no budget, or no database", async () => {
    expect(
      await markPhotoAnswer({ db: () => db, client: null }, answer(file())),
    ).toEqual({ marking: null, refused: null });

    anonymousBudgetSpent.mockResolvedValue(true);
    expect(
      await markPhotoAnswer({ db: () => db, client }, answer(file())),
    ).toEqual({ marking: null, refused: null });

    anonymousBudgetSpent.mockRejectedValue(new Error("no db"));
    expect(
      await markPhotoAnswer({ db: () => db, client }, answer(file())),
    ).toEqual({ marking: null, refused: null });

    expect(
      await markPhotoAnswer(
        {
          db: () => {
            throw new Error("DATABASE_URL is not set");
          },
          client,
        },
        answer(file()),
      ),
    ).toEqual({ marking: null, refused: null });
  });

  it("marks a real photograph and logs the spend against no user", async () => {
    anonymousBudgetSpent.mockResolvedValue(false);
    logCall.mockImplementation(async (_db, _user, result: unknown) => result);
    const { client: stubbed } = stub({
      correct: true,
      feedback: "The middle object is the only crisp one.",
    });

    const outcome = await markPhotoAnswer(
      { db: () => db, client: stubbed },
      answer(file()),
    );

    expect(outcome.marking).toEqual({
      correct: true,
      feedback: "The middle object is the only crisp one.",
    });
    expect(logCall.mock.calls[0]![1]).toBeNull();
  });

  it("does not pass a photograph the grader could not mark", async () => {
    anonymousBudgetSpent.mockResolvedValue(false);
    logCall.mockImplementation(async (_db, _user, result: unknown) => result);
    const { client: stubbed } = stub({ correct: "maybe" });

    expect(
      (await markPhotoAnswer({ db: () => db, client: stubbed }, answer(file())))
        .marking,
    ).toBeNull();
  });

  it("does not pass one when the call itself threw", async () => {
    anonymousBudgetSpent.mockResolvedValue(false);
    const exploding = {
      messages: {
        create: async () => {
          throw new Error("network");
        },
      },
    } as unknown as Anthropic;

    expect(
      await markPhotoAnswer({ db: () => db, client: exploding }, answer(file())),
    ).toEqual({ marking: null, refused: null });
  });
});
