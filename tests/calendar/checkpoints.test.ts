import { describe, expect, it } from "vitest";
import {
  deadlineVerdict,
  projectCheckpoints,
  type Checkpoint,
  type CheckpointModule,
} from "@/lib/calendar/checkpoints";

/**
 * Dating the work ahead.
 *
 * Two things are being defended: the cumulative arithmetic (you have to do
 * modules 1 and 2 before you hand in module 3, whether or not either of them
 * produces anything), and the second date. A single date computed from the pace
 * a learner *intended* is a wish, and §4.2 law 3 does not allow us to print a
 * wish as an estimate.
 */

const TODAY = "2026-08-14";

const mod = (
  title: string,
  targetSkillIds: string[],
  outputArtifact: CheckpointModule["outputArtifact"],
): CheckpointModule => ({ title, targetSkillIds, outputArtifact });

const HOURS = new Map([
  ["a", 3],
  ["b", 3],
  ["c", 0],
  ["d", 1.5],
  ["e", 0.5],
]);

function project(modules: CheckpointModule[], overrides = {}) {
  return projectCheckpoints({
    modules,
    remainingHours: HOURS,
    weeklyHours: 3,
    actualWeeklyHours: 2,
    today: TODAY,
    ...overrides,
  });
}

describe("projectCheckpoints", () => {
  it("dates a hand-in at both paces, from the hours in front of it", () => {
    const [checkpoint] = project([
      mod("Foundations", ["a"], "none"),
      mod("First print", ["b"], "project"),
    ]);

    // Six hours of work: two weeks at the three a week they set aside, three
    // at the two a week they actually kept.
    expect(checkpoint).toEqual({
      title: "First print",
      hoursAway: 6,
      day: "2026-08-28",
      dayAtActualPace: "2026-09-04",
      graded: true,
    });
  });

  it("counts the work in a module that produces nothing", () => {
    // The learner still has to do it. Dropping its hours would date every
    // later checkpoint early, which is the flattering direction.
    const [withPreamble] = project([
      mod("Foundations", ["a"], "none"),
      mod("First print", ["b"], "project"),
    ]);
    const [alone] = project([mod("First print", ["b"], "project")]);

    expect(withPreamble!.hoursAway).toBe(6);
    expect(alone!.hoursAway).toBe(3);
  });

  it("leaves out a hand-in with nothing left to learn for it", () => {
    // Not a date: it is something they could sit down and do now, which is a
    // fact about the path screen rather than about a month.
    expect(project([mod("Already yours", ["c"], "project")])).toEqual([]);
  });

  it("marks only rubric-marked work as graded", () => {
    const [made] = project([mod("A series", ["d", "e"], "document")]);
    expect(made!.graded).toBe(false);
    expect(made!.hoursAway).toBe(2);
  });

  it("owes no hours for a skill the pack does not have", () => {
    const [checkpoint] = project([mod("First print", ["b", "ghost"], "project")]);
    expect(checkpoint!.hoursAway).toBe(3);
  });

  it("rounds the wait up, never down", () => {
    // 2 hours at 3 a week is 4.67 days. Rounding down would promise Tuesday
    // for work that finishes on Wednesday.
    const [checkpoint] = project([mod("A series", ["d", "e"], "document")]);
    expect(checkpoint!.day).toBe("2026-08-19");
  });

  it("gives no second date to a week with no pace in it", () => {
    const [checkpoint] = project([mod("First print", ["b"], "project")], {
      actualWeeklyHours: 0,
    });
    expect(checkpoint!.dayAtActualPace).toBeNull();
  });

  it("stops at the limit rather than dating a year of arithmetic", () => {
    const modules = ["one", "two", "three"].map((t) =>
      mod(t, ["d"], "project"),
    );
    expect(project(modules, { limit: 2 }).map((c) => c.title)).toEqual([
      "one",
      "two",
    ]);
  });
});

const dated = (day: string, dayAtActualPace: string | null): Checkpoint => ({
  title: "First print",
  hoursAway: 6,
  day,
  dayAtActualPace,
  graded: true,
});

describe("deadlineVerdict", () => {
  it("says nothing when the shown work clears the date on both paces", () => {
    // Silence has to mean "nothing shown says otherwise". The list is capped,
    // so it can never mean "you are fine".
    expect(
      deadlineVerdict([dated("2026-08-28", "2026-09-04")], "2026-12-01"),
    ).toBeNull();
  });

  it("blames the plan when even the committed pace runs past the date", () => {
    expect(
      deadlineVerdict([dated("2026-08-28", "2026-09-04")], "2026-08-20"),
    ).toBe("plan");
  });

  it("blames the pace when the plan fits and last week did not", () => {
    expect(
      deadlineVerdict([dated("2026-08-28", "2026-09-04")], "2026-09-01"),
    ).toBe("pace");
  });

  it("holds its tongue about a pace it does not have", () => {
    expect(deadlineVerdict([dated("2026-08-28", null)], "2026-09-01")).toBeNull();
  });

  it("has nothing to say before there are checkpoints", () => {
    expect(deadlineVerdict([], "2026-09-01")).toBeNull();
  });
});
