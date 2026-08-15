import { describe, expect, it } from "vitest";
import { BUILD_STAGES } from "@/lib/packs/build";
import {
  BUILD_STEPS,
  elapsedWords,
  SLOW_AFTER_MINUTES,
  stepStates,
  TYPICAL_MINUTES,
} from "@/app/(app)/start/building/progress";

/**
 * What the wait screen is allowed to claim, tested away from the markup.
 *
 * The screen's whole value is that a finished step is finished because the
 * build said so. These are the rules that keep that true.
 */

describe("the steps", () => {
  it("has one for every phase a build can be in, in the pipeline's order", () => {
    // Position is what `stepStates` reads, so a step out of order would show a
    // finished phase as pending.
    expect(BUILD_STEPS.map((s) => s.stage)).toEqual([...BUILD_STAGES]);
  });

  it("says what the learner gets, never how it is made", () => {
    // The screen names phases of our pipeline; a learner waiting in front of it
    // is owed the consequence, not the mechanism.
    const words = BUILD_STEPS.map((s) => `${s.title} ${s.note}`)
      .join(" ")
      .toLowerCase();

    for (const leak of ["model", "prompt", "queue", "api", "token", "opus"]) {
      expect(words).not.toContain(leak);
    }
  });

  it("only calls a build slow after it is past the figure it quoted", () => {
    // A reassurance everybody sees is not reassurance; it is noise that teaches
    // people to expect a problem.
    expect(SLOW_AFTER_MINUTES).toBeGreaterThan(TYPICAL_MINUTES);
  });
});

describe("stepStates", () => {
  it("leaves every step waiting while the build is still queued", () => {
    // A queued build has not started working out the skills. Lighting the first
    // step would be a small lie that makes the rest of the screen worthless.
    expect(stepStates(null)).toEqual([
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
  });

  it("marks off what is behind the phase and nothing in front of it", () => {
    expect(stepStates("checking")).toEqual([
      "done",
      "done",
      "running",
      "waiting",
    ]);
  });

  it("has exactly one step running at a time", () => {
    for (const stage of BUILD_STAGES) {
      expect(stepStates(stage).filter((s) => s === "running")).toHaveLength(1);
    }
  });
});

describe("elapsedWords", () => {
  it("says less than a minute rather than counting seconds", () => {
    // The page reloads every few seconds; a live seconds count would rewrite
    // itself on every refresh, which is motion carrying no news.
    expect(elapsedWords(0)).toBe("less than a minute");
    expect(elapsedWords(59_000)).toBe("less than a minute");
  });

  it("counts whole minutes, singular and plural", () => {
    expect(elapsedWords(60_000)).toBe("1 minute");
    expect(elapsedWords(119_000)).toBe("1 minute");
    expect(elapsedWords(4 * 60_000)).toBe("4 minutes");
  });
});
