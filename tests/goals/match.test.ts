import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WEEKLY_HOURS,
  catalogueFor,
  matchChosen,
  matchSubject,
  rawGoalFrom,
  scopeFrom,
  specFrom,
  subjectToNarrow,
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
  priorDomain: null,
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
     * A model naming a pack does not make that pack exist, and a goal pointing
     * at a missing pack fails much later — on /today, looking like a bug in the
     * planner rather than a lie at intake.
     *
     * The slug here has to be one the catalogue will never contain. This test
     * used `python-fundamentals`, which was safely fictional right up until
     * someone added that pack, at which point it asserted the opposite of what
     * it says.
     */
    const match = await matchSubject(
      db,
      captured({ matchedPack: "no-such-pack-exists", subject: "Kitesurfing" }),
    );
    expect(match.kind).toBe("gap");
    expect(match.kind === "gap" && match.slug).toBe("kitesurfing");
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

/**
 * The learner having already chosen, which is the case the whole conversation
 * used to throw away: a brief and a subject page each name exactly one pack,
 * and clicking one of them is a decision, not a hint.
 */
describe("matchChosen", () => {
  it("builds on the course they chose, whatever the model decided", async () => {
    const match = await matchChosen(
      db,
      // The analyzer here has read the subject as something we do not run at
      // all — which, before the pack travelled, would have sent someone who
      // clicked a published brief off to generate a pack instead.
      captured({ matchedPack: null, subject: "Taking nice pictures" }),
      "photography",
    );

    expect(match.kind).toBe("covered");
    expect(match.kind === "covered" && match.pack.slug).toBe("photography");
  });

  it("falls back to the conversation when no course was chosen", async () => {
    const match = await matchChosen(
      db,
      captured({ matchedPack: "photography" }),
      null,
    );
    expect(match.kind === "covered" && match.pack.slug).toBe("photography");
  });

  /*
   * A slug arrives from a form field and a pack can be withdrawn between the
   * click and the build, so it is resolved rather than believed. When it does
   * not resolve, the conversation is all that is left — which is better than
   * writing a `packId` pointing at nothing.
   */
  it("falls back to the conversation when the chosen course is not real", async () => {
    const match = await matchChosen(
      db,
      captured({ subject: "Rust programming" }),
      "no-such-pack-exists",
    );
    expect(match).toEqual({
      kind: "gap",
      subject: "Rust programming",
      slug: "rust-programming",
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

describe("specFrom and the learner's background", () => {
  const messages: Message[] = [{ r: "l", t: "learn photography" }];

  /**
   * PLAN-ADAPTATION step 5. Null means it never came up, which is not the same
   * as being told they are starting fresh — but the two produce the same
   * lesson, so both land on `none` rather than the spec carrying a third state
   * the cache key would have to understand.
   */
  it("reads a background the learner never mentioned as none", () => {
    const spec = specFrom(
      captured({ priorDomain: null }),
      messages,
      "photography",
      "Photography",
      0.4,
    );
    expect(spec?.priorDomain).toBe("none");
  });

  it("carries a background they did mention", () => {
    const spec = specFrom(
      captured({ priorDomain: "spreadsheets" }),
      messages,
      "photography",
      "Photography",
      0.4,
    );
    expect(spec?.priorDomain).toBe("spreadsheets");
  });
});

/**
 * §8 screen 3's scope question, and the two halves of it that are decisions
 * rather than prose: when to ask, and what the answer is worth if it never came.
 */
describe("subjectToNarrow", () => {
  it("names a subject nobody has written for us", () => {
    expect(subjectToNarrow(captured({ subject: "web development" }))).toBe(
      "web development",
    );
  });

  it("asks nothing before there is a subject to ask about", () => {
    expect(subjectToNarrow(undefined)).toBeNull();
    expect(subjectToNarrow(captured({ subject: null }))).toBeNull();
    expect(subjectToNarrow(captured({ subject: "   " }))).toBeNull();
  });

  /*
   * The curated packs are scoped already, by whoever curated them. Asking a
   * learner how much of Photography they want spends a turn on a question that
   * cannot change anything — the pack is written and the depth dial is what
   * moves.
   */
  it("asks nothing about a subject the catalogue covers", () => {
    expect(
      subjectToNarrow(
        captured({ subject: "Photography", matchedPack: "photography" }),
      ),
    ).toBeNull();
  });

  it("recognises a covered subject the model failed to name", () => {
    // `matchSubject`'s second branch, made a turn early: the same subject under
    // a tidier name is the same subject.
    expect(subjectToNarrow(captured({ subject: "Photography" }))).toBeNull();
  });

  /*
   * The same check `matchSubject` makes, and for the same reason. A model
   * naming a pack does not make it exist, and a conversation that skipped the
   * scope question on the strength of a slug we do not have would commission an
   * unscoped build.
   */
  it("still asks when the claimed pack does not exist", () => {
    expect(
      subjectToNarrow(
        captured({ subject: "web development", matchedPack: "web-dev-101" }),
      ),
    ).toBe("web development");
  });

  it("stops asking once they have answered", () => {
    expect(
      subjectToNarrow(
        captured({ subject: "web development", scope: "put my CV online" }),
      ),
    ).toBeNull();
  });

  it("treats a blank answer as no answer", () => {
    expect(
      subjectToNarrow(captured({ subject: "web development", scope: "  " })),
    ).toBe("web development");
  });
});

describe("scopeFrom", () => {
  const opening: Message[] = [{ r: "l", t: "I want to learn to make websites" }];

  it("hands the pack author what the learner settled on", () => {
    const scope = scopeFrom(
      captured({ subject: "web development", scope: "put a portfolio site online" }),
      opening,
      "web development",
    );
    expect(scope).toBe("put a portfolio site online");
  });

  /*
   * The turn cap can arrive before the question does — §24 E3's six turns are
   * enforced in application code and no later rule may spend a seventh. What is
   * left is their opening message, which is worth more than the `null` every
   * build before this one was authored from.
   */
  it("falls back to their own opening words", () => {
    expect(scopeFrom(captured(), opening, "web development")).toBe(
      "I want to learn to make websites",
    );
  });

  it("falls back again to the subject when there is nothing at all", () => {
    expect(scopeFrom(undefined, [], "Web Development")).toBe(
      "Get good at web development",
    );
  });
});
