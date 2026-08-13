import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WEEKLY_HOURS,
  catalogueFor,
  matchSubject,
  rawGoalFrom,
  specFrom,
} from "@/lib/goals/match";
import type { CapturedGoal, Message } from "@/lib/goals/analyzer";

/**
 * The seam between what a model said and what the product acts on. Everything
 * here exists because a claim was made by a model and something checks it.
 */

vi.mock("@/lib/packs/read", () => ({
  // Nothing lives in the database in these tests; the disk catalogue is real.
  packFromDb: async () => undefined,
}));

const captured = (over: Partial<CapturedGoal> = {}): CapturedGoal => ({
  subject: null,
  matchedPack: null,
  outcomeType: null,
  statedLevel: null,
  weeklyHours: null,
  deadline: null,
  motivation: null,
  constraints: [],
  existingAssets: [],
  ...over,
});

const db = {} as never;

describe("catalogueFor", () => {
  it("offers the real packs, by slug", () => {
    const slugs = catalogueFor().map((c) => c.slug);
    expect(slugs).toContain("sql-data-analysis");
    expect(catalogueFor().every((c) => c.name.length > 0)).toBe(true);
  });
});

describe("matchSubject", () => {
  it("matches a slug the analyzer named", async () => {
    const match = await matchSubject(
      db,
      captured({ matchedPack: "photography" }),
    );
    expect(match.kind).toBe("covered");
    expect(match.kind === "covered" && match.pack.slug).toBe("photography");
  });

  it("refuses a slug that does not exist, however confident the model was", async () => {
    /*
     * A model naming `python-fundamentals` does not make that pack exist, and a
     * goal pointing at a missing pack fails much later — on /today, looking
     * like a bug in the planner rather than a lie at intake.
     */
    const match = await matchSubject(
      db,
      captured({ matchedPack: "python-fundamentals", subject: "Python" }),
    );
    expect(match.kind).toBe("gap");
    expect(match.kind === "gap" && match.slug).toBe("python");
  });

  it("matches on the subject when the claimed slug is wrong but the subject is ours", async () => {
    const match = await matchSubject(
      db,
      captured({ matchedPack: "photos", subject: "Photography" }),
    );
    expect(match.kind).toBe("covered");
    expect(match.kind === "covered" && match.pack.slug).toBe("photography");
  });

  it("reports a gap for a subject nobody has curated", async () => {
    const match = await matchSubject(
      db,
      captured({ subject: "Rust programming" }),
    );
    expect(match).toEqual({
      kind: "gap",
      subject: "Rust programming",
      slug: "rust-programming",
    });
  });

  it("reports an empty gap when nothing usable came back at all", async () => {
    // The caller's next move is "we could not do this", not a pack built for
    // an empty string.
    expect(await matchSubject(db, captured())).toEqual({
      kind: "gap",
      subject: "",
      slug: "",
    });
  });
});

describe("rawGoalFrom", () => {
  it("keeps the learner's first message, which is what they came with", () => {
    const messages: Message[] = [
      { r: "a", t: "What do you want to learn?" },
      { r: "l", t: "I want to stop guessing at my shutter speed" },
      { r: "l", t: "about 2 hours" },
    ];
    expect(rawGoalFrom(messages, "fallback")).toBe(
      "I want to stop guessing at my shutter speed",
    );
  });

  it("falls back when the learner never typed anything", () => {
    expect(rawGoalFrom([{ r: "a", t: "hello" }], "Get good at chess")).toBe(
      "Get good at chess",
    );
  });

  it("bounds what it stores", () => {
    const messages: Message[] = [{ r: "l", t: "x".repeat(900) }];
    expect(rawGoalFrom(messages, "f").length).toBe(500);
  });
});

describe("specFrom", () => {
  const messages: Message[] = [{ r: "l", t: "I want to learn SQL" }];

  it("completes a spec from a full conversation", () => {
    const spec = specFrom(
      captured({
        outcomeType: "career",
        statedLevel: "beginner",
        weeklyHours: 4,
        deadline: "2027-03-01",
        motivation: "changing jobs",
      }),
      messages,
      "sql-data-analysis",
      "SQL & Data Analysis",
      0.85,
    );

    expect(spec).toMatchObject({
      domain: "sql-data-analysis",
      outcomeType: "career",
      statedLevel: "beginner",
      weeklyHours: 4,
      deadline: "2027-03-01",
      clarity: 0.85,
    });
  });

  it("defaults every field the learner declined rather than blocking", () => {
    // "I don't know" is always valid (§8 screen 3); a product that stops on it
    // is a form with extra steps.
    const spec = specFrom(captured(), messages, "photography", "Photography", 0.4);

    expect(spec).toMatchObject({
      outcomeType: "personal",
      statedLevel: "none",
      weeklyHours: DEFAULT_WEEKLY_HOURS,
      deadline: null,
      motivation: "",
    });
  });

  it("starts an unknown level at the bottom so the check can raise it", () => {
    const spec = specFrom(captured(), messages, "photography", "Photography", 0.4);
    expect(spec!.statedLevel).toBe("none");
  });

  it("records the analyzer's clarity rather than claiming certainty", () => {
    /*
     * The form records STATED_CLARITY of 1 precisely because it infers nothing.
     * A conversation that worked things out must not claim the same, or the two
     * become indistinguishable in the record.
     */
    const spec = specFrom(captured(), messages, "photography", "Photography", 0.55);
    expect(spec!.clarity).toBe(0.55);
  });

  it("never records more certainty than a stated spec", () => {
    const spec = specFrom(captured(), messages, "photography", "Photography", 4);
    expect(spec!.clarity).toBe(1);
  });

  it("returns undefined for a conversation that cannot make a valid spec", () => {
    const spec = specFrom(captured(), messages, "", "", 0.5);
    expect(spec).toBeUndefined();
  });
});
