import { describe, expect, it } from "vitest";
import {
  APPLY_SESSION_INTERVAL,
  composeSession,
  explainRatio,
  isApplySession,
  MAX_EXPLAIN_RATIO,
  MAX_RETRIEVAL_ITEMS,
  MAX_RETRIEVAL_MINUTES,
  MIN_RETRIEVAL_ITEMS,
  selectRetrievalItems,
  shouldBackOff,
} from "@/lib/engine/session-composer";
import type { EngineSkill, ScoredSkill } from "@/lib/engine/types";
import { retrieval, skill } from "./support";

const NOW = "2026-08-12T09:00:00.000Z";

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
    expect(APPLY_SESSION_INTERVAL).toBe(4);
    expect(isApplySession(0)).toBe(false);
    expect(isApplySession(1)).toBe(false);
    expect(isApplySession(4)).toBe(true);
    expect(isApplySession(8)).toBe(true);
    expect(isApplySession(9)).toBe(false);
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
      now: NOW,
    });
    expect(result.blocks.some((b) => b.type === "explain")).toBe(false);
    expect(result.blocks.some((b) => b.type === "check")).toBe(true);
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
