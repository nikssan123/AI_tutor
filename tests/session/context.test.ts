import { describe, expect, it } from "vitest";
import {
  buildLearnerContext,
  CONTEXT_CHAR_BUDGET,
  CONTEXT_SKILL_LIMIT,
  masteryBand,
  recencyBand,
  selectContextSkills,
  trim,
  type LearnerContextInput,
} from "@/lib/session/context";
import { mastery, session, skill } from "../engine/support";
import type { GoalSpec } from "@/lib/contracts/goal";

/**
 * §14.3 tier 1 — the Learner Context Block.
 *
 * The property under test is not the wording, it is the *stability*: this text
 * sits behind the cache breakpoint, and §14.9.4 is explicit that a prefix which
 * varies costs full input price on every turn and reports nothing. So the tests
 * that matter here assert what must never appear in it.
 */

const goal: GoalSpec = {
  rawGoal: "take photographs I'm not embarrassed by",
  domain: "photography",
  targetOutcome: "shoot in manual",
  outcomeType: "personal",
  statedLevel: "beginner",
  weeklyHours: 3,
  deadline: null,
  motivation: "a trip in October",
  constraints: ["phone only"],
  existingAssets: [],
  clarity: 1,
};

function input(overrides: Partial<LearnerContextInput> = {}): LearnerContextInput {
  return {
    goal,
    packName: "Photography",
    skills: [skill("exposure"), skill("composition")],
    mastery: [mastery("exposure", { mastery: 0.9, evidenceCount: 3 })],
    history: [],
    misconceptions: [],
    focusSkillIds: ["exposure"],
    today: "2026-08-13",
    ...overrides,
  };
}

describe("the learner context block", () => {
  it("carries no timestamp, so the cached prefix survives a session", () => {
    // The rule §14.9.4 names first. A rendered instant would change the prefix
    // between two turns a minute apart and quietly triple the bill.
    const text = buildLearnerContext(
      input({
        mastery: [
          mastery("exposure", {
            mastery: 0.9,
            evidenceCount: 2,
            lastSuccessAt: "2026-08-12T09:31:07.412Z",
          }),
        ],
      }),
    );

    expect(text).not.toMatch(/\d{2}:\d{2}/);
    expect(text).not.toContain("2026-08-12T");
  });

  it("is byte-identical for the same state", () => {
    expect(buildLearnerContext(input())).toBe(buildLearnerContext(input()));
  });

  it("carries no UUID", () => {
    const text = buildLearnerContext(input());
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it("states mastery in words, never as a number", () => {
    // §7.2 — "a Tier 3 skill at 0.8 renders as 'Likely capable', not '80%'."
    // The tutor quotes this block back at the learner, and it is not the
    // surface allowed to make a numeric claim.
    const text = buildLearnerContext(input());
    expect(text).toContain("solid");
    expect(text).not.toContain("0.9");
    expect(text).not.toMatch(/\d+%/);
  });

  it("fits the token budget", () => {
    expect(buildLearnerContext(input()).length).toBeLessThanOrEqual(
      CONTEXT_CHAR_BUDGET,
    );
  });

  it("renders the goal, the constraints and the deadline", () => {
    const text = buildLearnerContext(
      input({ goal: { ...goal, deadline: "2026-10-01" } }),
    );

    expect(text).toContain("take photographs I'm not embarrassed by");
    expect(text).toContain("phone only");
    expect(text).toContain("Deadline: 2026-10-01");
    expect(text).toContain("About 3 hours a week");
  });

  it("says there is no deadline rather than omitting the line", () => {
    expect(buildLearnerContext(input())).toContain("No deadline");
  });

  it("falls back when the learner gave no motivation", () => {
    expect(
      buildLearnerContext(input({ goal: { ...goal, motivation: "" } })),
    ).toContain("Why: not said");
  });

  it("says nothing is assessed rather than showing an empty list", () => {
    expect(buildLearnerContext(input({ mastery: [] }))).toContain(
      "Nothing assessed yet",
    );
  });

  it("renders recent sessions newest first", () => {
    const text = buildLearnerContext(
      input({
        history: [
          session("2026-08-12T09:00:00.000Z", ["exposure"], ["general"], true),
          session("2026-08-10T09:00:00.000Z", ["composition"], ["general"]),
        ],
      }),
    );

    expect(text).toContain("Last session: Skill exposure (produced work)");
    expect(text).toContain("2 sessions ago: Skill composition");
  });

  it("copes with a session that targeted nothing", () => {
    expect(
      buildLearnerContext(
        input({ history: [session("2026-08-12T09:00:00.000Z", [], [])] }),
      ),
    ).toContain("no skill targeted");
  });

  it("names a session's skill by slug when the pack no longer has it", () => {
    expect(
      buildLearnerContext(
        input({ history: [session("2026-08-12T09:00:00.000Z", ["ghost"], [])] }),
      ),
    ).toContain("Last session: ghost");
  });

  it("says there are no sessions yet", () => {
    expect(buildLearnerContext(input())).toContain("None yet");
  });

  it("includes open misconceptions and drops the section without them", () => {
    expect(
      buildLearnerContext(input({ misconceptions: ["thinks ISO is exposure"] })),
    ).toContain("thinks ISO is exposure");
    expect(buildLearnerContext(input())).not.toContain(
      "Things they have got wrong before",
    );
  });

  it("names a skill by slug when the pack no longer has it", () => {
    expect(
      buildLearnerContext(input({ mastery: [mastery("ghost")], skills: [] })),
    ).toContain("- ghost:");
  });
});

describe("recencyBand", () => {
  it("bands rather than counts, so the text is stable within a day", () => {
    expect(recencyBand(null, "2026-08-13")).toBe("never demonstrated");
    expect(recencyBand("2026-08-13T06:00:00.000Z", "2026-08-13")).toBe(
      "demonstrated in the last day",
    );
    expect(recencyBand("2026-08-09T00:00:00.000Z", "2026-08-13")).toBe(
      "demonstrated this week",
    );
    expect(recencyBand("2026-07-25T00:00:00.000Z", "2026-08-13")).toBe(
      "demonstrated this month",
    );
    expect(recencyBand("2026-05-01T00:00:00.000Z", "2026-08-13")).toBe(
      "not demonstrated in over a month",
    );
  });
});

describe("masteryBand", () => {
  it("distinguishes no evidence from low mastery", () => {
    // These are different claims: one says we have not checked, the other says
    // we checked and it did not go well.
    expect(masteryBand(mastery("a", { mastery: 0.9, evidenceCount: 0 }))).toBe(
      "no evidence yet",
    );
    expect(masteryBand(mastery("a", { mastery: 0.1, evidenceCount: 2 }))).toBe(
      "not yet",
    );
  });

  it("bands the rest", () => {
    expect(masteryBand(mastery("a", { mastery: 0.9, evidenceCount: 1 }))).toBe("solid");
    expect(masteryBand(mastery("a", { mastery: 0.7, evidenceCount: 1 }))).toBe(
      "getting there",
    );
    expect(masteryBand(mastery("a", { mastery: 0.4, evidenceCount: 1 }))).toBe("shaky");
  });
});

describe("selectContextSkills", () => {
  it("leads with today's focus whatever its evidence", () => {
    const selected = selectContextSkills(
      input({
        focusSkillIds: ["composition"],
        mastery: [
          mastery("exposure", { evidenceCount: 9 }),
          mastery("composition", { evidenceCount: 0 }),
        ],
      }),
    );

    expect(selected[0]?.skillId).toBe("composition");
  });

  it("then ranks by evidence, breaking ties on slug", () => {
    const selected = selectContextSkills(
      input({
        focusSkillIds: [],
        mastery: [
          mastery("zebra", { evidenceCount: 2 }),
          mastery("alpha", { evidenceCount: 2 }),
          mastery("most", { evidenceCount: 5 }),
        ],
      }),
    );

    expect(selected.map((s) => s.skillId)).toEqual(["most", "alpha", "zebra"]);
  });

  it("stops at fifteen", () => {
    const selected = selectContextSkills(
      input({
        focusSkillIds: [],
        mastery: Array.from({ length: 40 }, (_, i) =>
          mastery(`s${String(i).padStart(2, "0")}`),
        ),
      }),
    );

    expect(selected).toHaveLength(CONTEXT_SKILL_LIMIT);
  });
});

describe("trim", () => {
  it("says when it truncated rather than losing a section silently", () => {
    const trimmed = trim("x".repeat(200), 100);
    expect(trimmed).toHaveLength(100);
    expect(trimmed).toContain("(Context truncated.)");
  });

  it("leaves text inside the budget alone", () => {
    expect(trim("short", 100)).toBe("short");
  });
});
