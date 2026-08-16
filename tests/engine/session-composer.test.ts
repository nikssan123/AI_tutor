import { describe, expect, it } from "vitest";
import type { CourseDepth } from "@/lib/engine";
import {
  APPLY_SESSION_INTERVALS,
  composeSession,
  explainRatio,
  isApplySession,
  MAX_EXPLAIN_RATIO,
  MAX_RETRIEVAL_ITEMS,
  MAX_RETRIEVAL_MINUTES,
  MIN_RETRIEVAL_ITEMS,
  selectCheckItem,
  selectRetrievalItems,
  shouldBackOff,
} from "@/lib/engine/session-composer";
import type { EngineItem, EngineSkill, ScoredSkill } from "@/lib/engine/types";
import { retrieval, skill } from "./support";

const NOW = "2026-08-12T09:00:00.000Z";

function item(
  skillId: string,
  itemId: string,
  over: Partial<EngineItem> = {},
): EngineItem {
  return {
    itemId,
    skillId,
    type: "short_text",
    prompt: `A real question about ${skillId}`,
    expected: `what ${itemId} is looking for`,
    answerFormat: "prose",
    difficulty: 0.5,
    ...over,
  };
}

function scored(skillId: string, score = 1): ScoredSkill {
  return {
    skillId,
    score,
    components: {
      goalCriticality: 1,
      masteryGap: 0.5,
      prereqReadiness: 1,
      retentionUrgency: 0,
      momentum: 0,
      interleavingBonus: 0,
      frustrationRisk: 0,
      timeFit: 0,
      recentlyFailedTwice: 0,
    },
    effectiveMastery: 0.35,
  };
}

function skillMap(...skills: EngineSkill[]): Map<string, EngineSkill> {
  return new Map(skills.map((s) => [s.id, s]));
}

describe("isApplySession", () => {
  it("fires on every fourth session and never on session zero", () => {
    expect(APPLY_SESSION_INTERVALS.standard).toBe(4);
    expect(isApplySession(0)).toBe(false);
    expect(isApplySession(1)).toBe(false);
    expect(isApplySession(4)).toBe(true);
    expect(isApplySession(8)).toBe(true);
    expect(isApplySession(9)).toBe(false);
  });

  it("defaults to the standard cadence when no depth is given", () => {
    for (const index of [3, 4, 6, 8, 9, 12]) {
      expect(isApplySession(index)).toBe(isApplySession(index, "standard"));
    }
  });

  it("asks a sprint for an artefact every third session instead", () => {
    expect(APPLY_SESSION_INTERVALS.sprint).toBe(3);
    expect(isApplySession(0, "sprint")).toBe(false);
    expect(isApplySession(3, "sprint")).toBe(true);
    expect(isApplySession(4, "sprint")).toBe(false);
    expect(isApplySession(9, "sprint")).toBe(true);
  });

  it("tightens the cadence at mastery depth too", () => {
    expect(APPLY_SESSION_INTERVALS.mastery).toBe(3);
    expect(isApplySession(3, "mastery")).toBe(true);
    expect(isApplySession(4, "mastery")).toBe(false);
  });

  /**
   * The reason the sprint interval is shorter rather than longer. A 12-session
   * sprint at the standard cadence produces three artefacts; at its own it
   * produces four, and the artefact is the only thing that moves mastery on
   * evidence rather than on recall.
   */
  it("gives a short course more gradeable work, not less", () => {
    const artefacts = (depth: CourseDepth) =>
      Array.from({ length: 12 }, (_, i) => i + 1).filter((i) =>
        isApplySession(i, depth),
      ).length;

    expect(artefacts("sprint")).toBeGreaterThan(artefacts("standard"));
  });
});

describe("selectRetrievalItems", () => {
  it("prefers overdue items, oldest first", () => {
    const items = selectRetrievalItems(
      [
        retrieval("s1", "i-late", "2026-08-01T00:00:00.000Z"),
        retrieval("s2", "i-later", "2026-08-05T00:00:00.000Z"),
        retrieval("s3", "i-future", "2026-09-01T00:00:00.000Z"),
      ],
      NOW,
    );
    expect(items.map((i) => i.itemId)).toEqual(["i-late", "i-later"]);
  });

  it("breaks ties on item id so the opening is reproducible", () => {
    const items = selectRetrievalItems(
      [
        retrieval("s1", "bbb", "2026-08-01T00:00:00.000Z"),
        retrieval("s2", "aaa", "2026-08-01T00:00:00.000Z"),
      ],
      NOW,
    );
    expect(items.map((i) => i.itemId)).toEqual(["aaa", "bbb"]);
  });

  it("falls forward to the next-soonest items when nothing is overdue", () => {
    // §16.1: opening with retrieval is non-negotiable, so an empty queue is the
    // only reason a session should start without it.
    const items = selectRetrievalItems(
      [
        retrieval("s1", "soon", "2026-08-13T00:00:00.000Z"),
        retrieval("s2", "later", "2026-08-20T00:00:00.000Z"),
      ],
      NOW,
    );
    expect(items.map((i) => i.itemId)).toEqual(["soon", "later"]);
  });

  it("orders equal-due items by id when falling forward too", () => {
    // Same tiebreak on the not-yet-due path as on the overdue one, so the
    // opening is reproducible either way.
    const items = selectRetrievalItems(
      [
        retrieval("s1", "bbb", "2026-08-20T00:00:00.000Z"),
        retrieval("s2", "aaa", "2026-08-20T00:00:00.000Z"),
      ],
      NOW,
    );
    expect(items.map((i) => i.itemId)).toEqual(["aaa", "bbb"]);
  });

  it("serves nothing when the queue is empty", () => {
    expect(selectRetrievalItems([], NOW)).toEqual([]);
  });

  it("never serves more than the maximum item count", () => {
    const queue = Array.from({ length: 10 }, (_, i) =>
      retrieval("s", `item-${i}`, "2026-08-01T00:00:00.000Z", 1),
    );
    expect(selectRetrievalItems(queue, NOW)).toHaveLength(MAX_RETRIEVAL_ITEMS);
  });

  it("respects the minutes cap once the minimum item count is met", () => {
    const queue = Array.from({ length: 4 }, (_, i) =>
      retrieval("s", `item-${i}`, "2026-08-01T00:00:00.000Z", 5),
    );
    const items = selectRetrievalItems(queue, NOW);
    expect(items).toHaveLength(MIN_RETRIEVAL_ITEMS);
    const minutes = items.reduce((sum, i) => sum + i.estMinutes, 0);
    expect(minutes).toBeGreaterThan(MAX_RETRIEVAL_MINUTES);
  });
});

describe("composeSession", () => {
  const sql = skill("joins", {
    name: "Join grain",
    canDoStatement: "join three tables at the correct grain",
    area: "querying",
  });

  it("opens with retrieval, always", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 30,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [
        retrieval("joins", "r1", "2026-08-01T00:00:00.000Z", 2),
        retrieval("joins", "r2", "2026-08-02T00:00:00.000Z", 2),
      ],
      now: NOW,
    });

    expect(result.blocks[0]).toMatchObject({ type: "check", isRetrieval: true });
    expect(result.blocks[1]).toMatchObject({ type: "check", isRetrieval: true });
  });

  it("never exceeds the time available", () => {
    for (const minutes of [5, 12, 20, 30, 45, 60, 90]) {
      const result = composeSession({
        sessionIndex: 1,
        availableMinutes: minutes,
        ranked: [scored("joins")],
        skillsById: skillMap(sql),
        retrievalQueue: [
          retrieval("joins", "r1", "2026-08-01T00:00:00.000Z", 3),
          retrieval("joins", "r2", "2026-08-02T00:00:00.000Z", 3),
        ],
        now: NOW,
      });
      expect(result.totalMinutes).toBeLessThanOrEqual(minutes);
      const summed = result.blocks.reduce((s, b) => s + b.estMinutes, 0);
      expect(summed).toBe(result.totalMinutes);
    }
  });

  it("keeps explain blocks at or under half the session (§14.9.2 invariant)", () => {
    for (const minutes of [10, 20, 30, 45, 60, 90, 120]) {
      const result = composeSession({
        sessionIndex: 1,
        availableMinutes: minutes,
        ranked: [scored("joins")],
        skillsById: skillMap(sql),
        retrievalQueue: [],
        now: NOW,
      });
      expect(explainRatio(result.blocks)).toBeLessThanOrEqual(MAX_EXPLAIN_RATIO);
    }
  });

  it("produces a gradeable artefact on every fourth session", () => {
    const result = composeSession({
      sessionIndex: 4,
      availableMinutes: 45,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [retrieval("joins", "r1", "2026-08-01T00:00:00.000Z", 2)],
      now: NOW,
    });

    const apply = result.blocks.find((b) => b.type === "apply");
    expect(apply).toBeDefined();
    expect(result.blocks.some((b) => b.type === "explain")).toBe(false);
    expect(result.blocks.at(-1)).toMatchObject({ type: "reflect" });
  });

  it("skips the reflection block when an apply session is very short", () => {
    const result = composeSession({
      sessionIndex: 4,
      availableMinutes: 12,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      now: NOW,
    });
    expect(result.blocks.some((b) => b.type === "reflect")).toBe(false);
    expect(result.blocks.some((b) => b.type === "apply")).toBe(true);
  });

  it("returns retrieval only when nothing is eligible", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 30,
      ranked: [],
      skillsById: skillMap(sql),
      retrievalQueue: [retrieval("joins", "r1", "2026-08-01T00:00:00.000Z", 2)],
      now: NOW,
    });
    expect(result.targetSkillIds).toEqual([]);
    expect(result.blocks.every((b) => b.type === "check")).toBe(true);
  });

  it("returns nothing at all when there is no time", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 0,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [retrieval("joins", "r1", "2026-08-01T00:00:00.000Z", 2)],
      now: NOW,
    });
    expect(result.blocks).toEqual([]);
    expect(result.totalMinutes).toBe(0);
  });

  it("treats negative available minutes as zero", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: -30,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      now: NOW,
    });
    expect(result.blocks).toEqual([]);
  });

  it("stops composing when the top skill is missing from the graph", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 30,
      ranked: [scored("ghost")],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      now: NOW,
    });
    expect(result.blocks).toEqual([]);
    expect(result.targetSkillIds).toEqual([]);
  });

  it("labels a retrieval item whose skill is not in the graph", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 30,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [
        retrieval("ghost", "orphan-item", "2026-08-01T00:00:00.000Z", 2),
      ],
      now: NOW,
    });
    expect(result.blocks[0]).toMatchObject({
      type: "check",
      prompt: "Recall the prior skill for item orphan-item",
    });
  });

  it("drops a retrieval item that would overrun the session", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 4,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [
        retrieval("joins", "r1", "2026-08-01T00:00:00.000Z", 3),
        retrieval("joins", "r2", "2026-08-02T00:00:00.000Z", 3),
      ],
      now: NOW,
    });
    const retrievalBlocks = result.blocks.filter(
      (b) => b.type === "check" && b.isRetrieval,
    );
    expect(retrievalBlocks).toHaveLength(1);
    expect(result.totalMinutes).toBeLessThanOrEqual(4);
  });

  it("skips the check when retrieval already consumed the session", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 4,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [
        retrieval("joins", "r1", "2026-08-01T00:00:00.000Z", 2),
        retrieval("joins", "r2", "2026-08-02T00:00:00.000Z", 2),
      ],
      now: NOW,
    });
    // Both retrieval items fit exactly; nothing is left for new material.
    expect(result.totalMinutes).toBe(4);
    expect(result.blocks.every((b) => b.type === "check")).toBe(true);
  });

  it("still schedules practice when there is no room to explain", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 1,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      items: [item("joins", "q1")],
      now: NOW,
    });
    expect(result.blocks.some((b) => b.type === "explain")).toBe(false);
    expect(result.blocks.some((b) => b.type === "check")).toBe(true);
  });

  /**
   * The double-ask, and why the check now has to earn its place.
   *
   * A learn session used to be: read about X, write from memory how you would
   * do X, then go and do X. The middle block was the third one with the doing
   * taken out — one task, asked twice — and a learner who met it called it
   * exactly that. So a check appears when there is a *different* question to
   * ask, and otherwise the minutes go to the work.
   */
  it("asks an authored question rather than a rehearsal of the apply", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 30,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      items: [item("joins", "q1", { prompt: "What sets the row count?" })],
      now: NOW,
    });

    const check = result.blocks.find((b) => b.type === "check");
    expect(check).toMatchObject({
      prompt: "What sets the row count?",
      itemId: "q1",
      isRetrieval: false,
    });
    // Never the apply block's brief in question form.
    expect(check).not.toMatchObject({ prompt: expect.stringContaining(sql.canDoStatement) });
  });

  it("drops the check entirely when the bank has nothing to ask", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 30,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      items: [],
      now: NOW,
    });

    expect(result.blocks.some((b) => b.type === "check")).toBe(false);
    // And the time is the work's, not lost: a session still fills its slot.
    expect(result.totalMinutes).toBe(30);
    expect(result.blocks.some((b) => b.type === "apply")).toBe(true);
  });

  /**
   * The format follows the *author*, not the item's type — the distinction
   * that inference got wrong. A `short_text` item can ask for a sequence of
   * CLI commands, and a `code_read` item usually wants a sentence back about
   * the snippet it shows.
   */
  it("carries the answer format the item's author declared", () => {
    const check = (over: Partial<EngineItem>) =>
      composeSession({
        sessionIndex: 1,
        availableMinutes: 30,
        ranked: [scored("joins")],
        skillsById: skillMap(sql),
        retrievalQueue: [],
        items: [item("joins", "q1", over)],
        now: NOW,
      }).blocks.find((b) => b.type === "check");

    expect(
      check({ type: "short_text", answerFormat: "code" }),
    ).toMatchObject({ answerFormat: "code" });
    expect(
      check({ type: "code_read", answerFormat: "prose" }),
    ).toMatchObject({ answerFormat: "prose" });
  });
});

describe("selectCheckItem", () => {
  const bank = [
    item("joins", "easy", { difficulty: 0.1 }),
    item("joins", "mid", { difficulty: 0.5 }),
    item("joins", "hard", { difficulty: 0.9 }),
    item("other", "elsewhere", { difficulty: 0.5 }),
  ];

  it("asks the question nearest what the learner is believed to know", () => {
    // The diagnostic's rule, for the diagnostic's reason: far below tells you
    // nothing new, far above measures guessing.
    expect(selectCheckItem(bank, "joins", 0.12, [])?.itemId).toBe("easy");
    expect(selectCheckItem(bank, "joins", 0.55, [])?.itemId).toBe("mid");
    expect(selectCheckItem(bank, "joins", 0.95, [])?.itemId).toBe("hard");
  });

  it("never serves a skill's question against another skill", () => {
    expect(selectCheckItem(bank, "other", 0.5, [])?.itemId).toBe("elsewhere");
    expect(selectCheckItem(bank, "nothing-here", 0.5, [])).toBeUndefined();
  });

  it("leaves an item that is already coming back on its own schedule", () => {
    // Serving it here would ask it twice in one session and reset a spacing
    // interval that was doing its job.
    const queued = [retrieval("joins", "mid", "2026-08-20T09:00:00.000Z", 2)];
    expect(selectCheckItem(bank, "joins", 0.5, queued)?.itemId).not.toBe("mid");
  });

  it("will not serve what a textarea cannot ask", () => {
    // An MCQ would render its stem with no options; a micro artefact is what
    // the apply block is for.
    const unusable = [
      item("joins", "mcq-1", { type: "mcq" }),
      item("joins", "artefact-1", { type: "micro_artifact" }),
    ];
    expect(selectCheckItem(unusable, "joins", 0.5, [])).toBeUndefined();
  });

  it("breaks a tie on item id, so the same state asks the same question", () => {
    const tied = [
      item("joins", "b", { difficulty: 0.4 }),
      item("joins", "a", { difficulty: 0.6 }),
    ];
    expect(selectCheckItem(tied, "joins", 0.5, [])?.itemId).toBe("a");
  });
});

describe("the hard damper (§16.1: back off, don't grind)", () => {
  const sql = skill("joins", {
    name: "Join grain",
    canDoStatement: "join three tables at the correct grain",
    area: "querying",
  });

  function twiceFailed(skillId = "joins"): ScoredSkill {
    const base = scored(skillId, -2.1);
    return {
      ...base,
      components: { ...base.components, recentlyFailedTwice: 1 },
    };
  }

  it("fires when the twice-failed skill is still the best option", () => {
    expect(shouldBackOff([twiceFailed()])).toBe(true);
  });

  it("does not fire when something else ranks higher", () => {
    // The ranking has already moved on — there is nothing to back off from.
    expect(shouldBackOff([scored("aggregation"), twiceFailed()])).toBe(false);
  });

  it("does not fire on an empty ranking", () => {
    expect(shouldBackOff([])).toBe(false);
  });

  it("asks for no artefact — a third failure is the thing being prevented", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 30,
      ranked: [twiceFailed()],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      now: NOW,
    });

    expect(result.backingOff).toBe(true);
    expect(result.blocks.some((b) => b.type === "apply")).toBe(false);
    expect(result.blocks[0]).toMatchObject({ type: "explain" });
    expect(result.blocks[0]).toHaveProperty(
      "content",
      expect.stringContaining("Worked example"),
    );
  });

  it("overrides the apply-session rule rather than forcing a submission", () => {
    // Session 4 would normally demand a gradeable artefact. Demanding one from
    // a learner who has just failed twice is how you lose them.
    const result = composeSession({
      sessionIndex: 4,
      availableMinutes: 45,
      ranked: [twiceFailed()],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      now: NOW,
    });
    expect(result.backingOff).toBe(true);
    expect(result.blocks.some((b) => b.type === "apply")).toBe(false);
  });

  it("still respects the explain cap while consolidating", () => {
    for (const minutes of [10, 20, 30, 60]) {
      const result = composeSession({
        sessionIndex: 1,
        availableMinutes: minutes,
        ranked: [twiceFailed()],
        skillsById: skillMap(sql),
        retrievalQueue: [],
        now: NOW,
      });
      expect(explainRatio(result.blocks)).toBeLessThanOrEqual(MAX_EXPLAIN_RATIO);
      expect(result.totalMinutes).toBeLessThanOrEqual(minutes);
    }
  });

  it("uses the whole session for the worked example when nothing is left over", () => {
    // availableMinutes 2 -> explain 1, leaving 1 for the walkthrough; at 1 the
    // explain consumes it all and there is no room for the check.
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 2,
      ranked: [twiceFailed()],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      now: NOW,
    });
    expect(result.blocks.filter((b) => b.type === "check")).toHaveLength(1);
  });

  it("fills the session with the worked example when time is very short", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 1,
      ranked: [twiceFailed()],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      now: NOW,
    });
    expect(result.backingOff).toBe(true);
    expect(result.totalMinutes).toBeLessThanOrEqual(1);
  });

  it("reports backingOff as false on an ordinary session", () => {
    const result = composeSession({
      sessionIndex: 1,
      availableMinutes: 30,
      ranked: [scored("joins")],
      skillsById: skillMap(sql),
      retrievalQueue: [],
      now: NOW,
    });
    expect(result.backingOff).toBe(false);
  });
});

describe("explainRatio", () => {
  it("is zero for an empty session", () => {
    expect(explainRatio([])).toBe(0);
  });

  it("measures explain minutes against the whole session", () => {
    expect(
      explainRatio([
        { type: "explain", skillId: "a", content: "x", estMinutes: 10 },
        {
          type: "check",
          skillId: "a",
          prompt: "p",
          expected: "e",
          isRetrieval: false,
          itemId: null,
          estMinutes: 30,
        },
      ]),
    ).toBe(0.25);
  });
});
