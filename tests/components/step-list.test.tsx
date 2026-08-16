// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StepList, stepStatesFor } from "@/components/step-list";

/**
 * The phases of a run, drawn once for both wait screens.
 *
 * What is worth asserting is not the geometry but the two things a wait screen
 * gets wrong: claiming progress nothing has evidence for, and carrying the
 * distinction between "done" and "still to come" in colour alone.
 */

const STAGES = ["planning", "checking", "saving"] as const;

const STEPS = [
  { title: "Cutting it into modules", note: "The order you will work in." },
  { title: "Checking it holds together", note: "Nothing before what it needs." },
  { title: "Putting your path together", note: "The modules and the work." },
];

afterEach(cleanup);

describe("stepStatesFor", () => {
  it("leaves everything waiting while the run is only queued", () => {
    // Not "the first step is running": a queued build has not started, and
    // saying it has is the small lie that makes the rest worthless.
    expect(stepStatesFor(STAGES, null)).toEqual([
      "waiting",
      "waiting",
      "waiting",
    ]);
  });

  it("marks off what is behind the phase and lights the phase itself", () => {
    expect(stepStatesFor(STAGES, "checking")).toEqual([
      "done",
      "running",
      "waiting",
    ]);
    expect(stepStatesFor(STAGES, "saving")).toEqual(["done", "done", "running"]);
  });

  /** A row written by an older deployment can hold a phase this version has
      never heard of. Unrecognised reads as "not started". */
  it("treats a phase it does not know as not started", () => {
    expect(stepStatesFor(STAGES, "splines" as never)).toEqual([
      "waiting",
      "waiting",
      "waiting",
    ]);
  });
});

describe("StepList", () => {
  it("says what every marker means, for a reader who cannot see it", () => {
    render(
      <StepList steps={STEPS} states={stepStatesFor(STAGES, "checking")} />,
    );

    // §8.5.5 — colour is never the only carrier. Each of the three states
    // carries its word, whatever the disc looks like.
    expect(screen.getByText("Done:")).toBeDefined();
    expect(screen.getByText("Happening now:")).toBeDefined();
    expect(screen.getByText("Still to come:")).toBeDefined();
  });

  it("lists every step with what it means for the learner", () => {
    render(<StepList steps={STEPS} states={stepStatesFor(STAGES, "planning")} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Nothing before what it needs.")).toBeDefined();
  });

  /**
   * States shorter than the steps they describe is not a state worth crashing a
   * wait screen over — the run is the thing that matters, and an unstyled row
   * is a better failure than a blank page.
   */
  it("falls back to waiting when a step has no state", () => {
    render(<StepList steps={STEPS} states={["done"]} />);
    expect(screen.getAllByText("Still to come:")).toHaveLength(2);
  });
});
