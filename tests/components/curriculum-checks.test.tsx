// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CurriculumChecks } from "@/components/curriculum-checks";
import type {
  ValidatorCheck,
  ValidatorReport,
} from "@/lib/contracts/curriculum";

/**
 * What is asserted here is what a learner sees *before* touching anything: the
 * verdict, the name of anything flagged, and the names of what cleared. The
 * band this component replaced printed nine detail strings — including, in the
 * report that prompted the rewrite, a three-thousand-word one — so the tests
 * that matter are the ones about what is folded away and what is not.
 */

afterEach(cleanup);

function check(overrides: Partial<ValidatorCheck> = {}): ValidatorCheck {
  return {
    name: "prereq_completeness",
    passed: true,
    severity: "blocking",
    detail: "Every module's hard prerequisites are earlier in the path.",
    repair: null,
    ...overrides,
  };
}

const report = (checks: ValidatorCheck[]): ValidatorReport => ({
  passed: checks.every((c) => c.passed || c.severity === "warning"),
  checks,
});

describe("what cleared", () => {
  it("says the verdict before it says anything else", () => {
    render(
      <CurriculumChecks
        report={report([
          check(),
          check({ name: "no_redundancy", severity: "warning" }),
        ])}
      />,
    );

    expect(screen.getByText("All 2 checks passed")).toBeTruthy();
  });

  it("names each passing check, and not its detail", () => {
    render(<CurriculumChecks report={report([check()])} />);

    expect(screen.getByText("Nothing before its prerequisites")).toBeTruthy();
    // The sentence is a restatement of the name, written for the repair loop.
    expect(
      screen.queryByText(/Every module's hard prerequisites/),
    ).toBeNull();
    // And with nothing flagged, the verdict is the list's only heading.
    expect(screen.queryByText("Passed")).toBeNull();
  });

  /**
   * `parseReport` is deliberately loose so a report written against an older
   * contract still renders. A name with no title falls back to the name, which
   * is unlovely and still readable — the alternative is a blank row.
   */
  it("falls back to the stored name for a check it does not know", () => {
    render(
      <CurriculumChecks
        report={report([
          check({ name: "an_older_check" as ValidatorCheck["name"] }),
        ])}
      />,
    );

    expect(screen.getByText("an_older_check")).toBeTruthy();
  });
});

describe("what was flagged", () => {
  const flagged = (overrides: Partial<ValidatorCheck> = {}) =>
    check({
      name: "difficulty_ramp",
      passed: false,
      severity: "warning",
      detail: "module 13 steps back down from 2 to 1",
      ...overrides,
    });

  it("counts the flags in the verdict, and labels what cleared", () => {
    render(<CurriculumChecks report={report([check(), flagged()])} />);

    expect(screen.getByText("1 of 2 flagged")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
  });

  it("shows a single short finding without asking for a click", () => {
    render(<CurriculumChecks report={report([flagged()])} />);

    const row = screen.getByText("It steps up, and never back").closest("details");
    expect(row?.open).toBe(true);
    expect(screen.getByText("module 13 steps back down from 2 to 1")).toBeTruthy();
    expect(screen.getByText("1 finding")).toBeTruthy();
    expect(screen.getByText("Flagged")).toBeTruthy();
  });

  /**
   * The one that made the band unreadable: `architect.ts` joins the
   * spot-check's findings into one string, and the real report on the screen
   * that prompted this ran to twenty-three of them.
   */
  it("splits a joined list of findings, and folds it away", () => {
    render(
      <CurriculumChecks
        report={report([
          flagged({
            name: "factual_spotcheck",
            detail: "Module 0 overstates the hours · Module 3 cannot be met · ",
          }),
        ])}
      />,
    );

    const row = screen.getByText("The content checks out").closest("details");
    expect(row?.open).toBe(false);
    // Folded is not dropped — `<details>` keeps both in the HTML, and the
    // trailing separator does not become a third, empty finding.
    expect(screen.getByText("Module 0 overstates the hours")).toBeTruthy();
    expect(screen.getByText("Module 3 cannot be met")).toBeTruthy();
    expect(screen.getByText("2 findings")).toBeTruthy();
  });

  it("folds a single finding too long to sit in the row", () => {
    render(
      <CurriculumChecks
        report={report([flagged({ detail: `The ramp is wrong. ${"x".repeat(200)}` })])}
      />,
    );

    expect(
      screen.getByText("It steps up, and never back").closest("details")?.open,
    ).toBe(false);
  });

  /** A warning is a note. A blocking check is not, and does not say it is. */
  it("says a blocking check failed rather than that it was flagged", () => {
    render(
      <CurriculumChecks
        report={report([
          flagged({ name: "no_already_mastered", severity: "blocking" }),
        ])}
      />,
    );

    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.queryByText("Flagged")).toBeNull();
  });

  it("drops the passed list when nothing passed", () => {
    render(<CurriculumChecks report={report([flagged()])} />);

    expect(screen.queryByText("Passed")).toBeNull();
  });
});
