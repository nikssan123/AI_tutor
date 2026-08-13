import { describe, expect, it } from "vitest";
import {
  buildEntries,
  commitmentFrom,
  STREAK_LOOKBACK_WEEKS,
  type CalendarEntry,
  type WorkedDay,
} from "@/lib/calendar/schedule";
import type { Checkpoint } from "@/lib/calendar/checkpoints";

/**
 * The rows a learner reads, and the one streak this product keeps.
 *
 * Two rules are under test rather than any particular sentence. Every entry
 * declares what its date rests on — recorded, due, or projected — because a
 * calendar that draws a guess like a fact is the most natural way for this
 * product to start overclaiming. And the streak is counted in *weeks against
 * the learner's own commitment*, so three hours a week done properly reads as a
 * kept week rather than as four missed days.
 */

const TODAY = "2026-08-14";

const worked = (day: string, minutes: number, sessions = 1): WorkedDay => ({
  day,
  minutes,
  sessions,
});

const checkpoint = (overrides: Partial<Checkpoint> = {}): Checkpoint => ({
  title: "First print",
  hoursAway: 6,
  day: "2026-08-28",
  dayAtActualPace: "2026-09-04",
  graded: true,
  ...overrides,
});

function entries(overrides: Partial<Parameters<typeof buildEntries>[0]> = {}) {
  return buildEntries({
    worked: [],
    retrieval: [],
    lapses: [],
    checkpoints: [],
    deadline: null,
    targetOutcome: "a portfolio of ten",
    ...overrides,
  });
}

const find = (all: CalendarEntry[], kind: CalendarEntry["kind"]) =>
  all.filter((e) => e.kind === kind);

describe("what each entry rests on", () => {
  it("marks work that happened as recorded", () => {
    const [entry] = find(entries({ worked: [worked(TODAY, 25, 2)] }), "session");
    expect(entry).toEqual({
      day: TODAY,
      kind: "session",
      certainty: "recorded",
      title: "25 minutes",
      detail: "You sat down 2 times.",
    });
  });

  it("counts one minute and one session in the singular", () => {
    const [entry] = find(entries({ worked: [worked(TODAY, 1, 1)] }), "session");
    expect(entry!.title).toBe("1 minute");
    expect(entry!.detail).toBe("You sat down 1 time.");
  });

  it("marks a queued question as due, not as a guess", () => {
    const [entry] = find(
      entries({ retrieval: [{ day: "2026-08-18", skillName: "Metering" }] }),
      "retrieval",
    );
    expect(entry).toEqual({
      day: "2026-08-18",
      kind: "retrieval",
      certainty: "due",
      title: "1 question comes back to you",
      detail: "Metering",
    });
  });

  it("merges a day's questions into one row and names them once", () => {
    const [entry] = find(
      entries({
        retrieval: [
          { day: "2026-08-18", skillName: "Metering" },
          { day: "2026-08-18", skillName: "Metering" },
          { day: "2026-08-18", skillName: "Framing" },
        ],
      }),
      "retrieval",
    );
    // Three items, two skills: a square with three identical rows on it is a
    // wall, and "Metering · Metering" is a bug you can read.
    expect(entry!.title).toBe("3 questions come back to you");
    expect(entry!.detail).toBe("Metering · Framing");
  });

  it("marks a lapse as projected, and says the consequence not the mechanism", () => {
    const [entry] = find(
      entries({ lapses: [{ day: "2026-08-20", skillName: "Metering" }] }),
      "lapse",
    );
    expect(entry!.certainty).toBe("projected");
    expect(entry!.title).toBe("Metering stops counting");
    expect(entry!.detail).not.toMatch(/decay|half.life|mastery/i);
  });

  it("marks a checkpoint as projected and says whether it is marked", () => {
    const graded = find(entries({ checkpoints: [checkpoint()] }), "checkpoint");
    expect(graded[0]!.certainty).toBe("projected");
    expect(graded[0]!.detail).toMatch(/rubric/);

    const made = find(
      entries({ checkpoints: [checkpoint({ graded: false })] }),
      "checkpoint",
    );
    expect(made[0]!.detail).toBe("Something to make and hand in.");
  });

  it("marks the learner's own deadline as due, against what they set it for", () => {
    const [entry] = find(entries({ deadline: "2026-12-01" }), "deadline");
    expect(entry).toEqual({
      day: "2026-12-01",
      kind: "deadline",
      certainty: "due",
      title: "The date you set yourself",
      detail: "a portfolio of ten",
    });
  });

  it("invents no deadline for a learner who set none", () => {
    expect(find(entries(), "deadline")).toEqual([]);
  });
});

describe("the order they read in", () => {
  it("runs oldest first, and within a day from what happened to what is guessed", () => {
    const all = entries({
      worked: [worked("2026-08-14", 25)],
      retrieval: [{ day: "2026-08-14", skillName: "Metering" }],
      lapses: [
        { day: "2026-08-14", skillName: "Zone system" },
        { day: "2026-08-14", skillName: "Framing" },
      ],
      checkpoints: [checkpoint({ day: "2026-08-14" })],
      deadline: "2026-08-14",
    });

    expect(all.map((e) => e.kind)).toEqual([
      "session",
      "retrieval",
      "lapse",
      "lapse",
      "checkpoint",
      "deadline",
    ]);
    // Two lapses on one day are ordered by name, so a reload cannot reshuffle
    // them in front of someone reading the list.
    expect(all[2]!.title).toBe("Framing stops counting");
  });

  it("puts an earlier day first whatever kind it is", () => {
    const all = entries({
      checkpoints: [checkpoint({ day: "2026-08-20" })],
      worked: [worked("2026-08-25", 25)],
      retrieval: [{ day: "2026-08-18", skillName: "Metering" }],
    });
    expect(all.map((e) => e.day)).toEqual([
      "2026-08-18",
      "2026-08-20",
      "2026-08-25",
    ]);
  });
});

describe("the commitment", () => {
  const commitment = (days: WorkedDay[], weeklyHours = 3) =>
    commitmentFrom({ worked: days, weeklyHours, today: TODAY });

  it("counts nothing for a learner who has not started", () => {
    expect(commitment([])).toEqual({
      weeklyHours: 3,
      weeksKept: 0,
      thisWeekHours: 0,
      keptThisWeek: false,
    });
  });

  it("counts the week in progress once it has already been met", () => {
    const kept = commitment([worked("2026-08-10", 180)]);
    expect(kept.thisWeekHours).toBe(3);
    expect(kept.keptThisWeek).toBe(true);
    expect(kept.weeksKept).toBe(1);
  });

  /**
   * The rule that keeps this from being a guilt mechanic: a week that is not
   * over yet cannot break a streak. Someone reading this on a Monday morning
   * has not failed anything.
   */
  it("never counts an unfinished week against the run", () => {
    const run = commitment([
      worked("2026-08-10", 60),
      worked("2026-08-03", 200),
      worked("2026-07-27", 190),
    ]);
    expect(run.thisWeekHours).toBe(1);
    expect(run.keptThisWeek).toBe(false);
    expect(run.weeksKept).toBe(2);
  });

  it("stops at the first week that was missed", () => {
    const run = commitment([
      worked("2026-08-10", 200),
      // Nothing in the week before last, so the run ends there.
      worked("2026-07-27", 200),
    ]);
    expect(run.weeksKept).toBe(1);
  });

  it("counts a year of kept weeks without looking further", () => {
    const days = Array.from({ length: 60 }, (_, week) => {
      const day = new Date(
        Date.parse(`${TODAY}T00:00:00.000Z`) - week * 7 * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      return worked(day, 180);
    });

    expect(commitment(days).weeksKept).toBe(STREAK_LOOKBACK_WEEKS);
  });

  it("compares the hours it shows, not the minutes behind them", () => {
    // 179 minutes rounds to 3.0 hours, which is the number on the screen —
    // and `/progress` decides the same question the same way, so the two
    // screens cannot disagree about whether a week was kept.
    expect(commitment([worked("2026-08-10", 179)]).keptThisWeek).toBe(true);
  });
});
