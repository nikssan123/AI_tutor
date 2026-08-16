// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WeekDigest } from "@/components/week-digest";
import type { Digest } from "@/lib/mastery/digest";

/**
 * The week in two cards.
 *
 * The assertions are about the product's first law rather than the layout: a
 * week with no marked work must not read as a week with no progress *claimed*,
 * and neither card may say a number the ledger did not give it. Both cards have
 * an empty state that says why they are empty, which is the part a second caller
 * would be most likely to lose.
 */

const DIGEST: Digest = {
  hoursLogged: 3.5,
  committedHours: 4,
  keptCommitment: false,
  sessions: 2,
  moved: [{ name: "Window functions", delta: 0.2 }],
  artefacts: 1,
  remainingHours: 20,
  weeksAtCommitment: 5,
  weeksAtActualPace: 6,
  tracked: 4,
  slipping: 1,
};

function digest(over: Partial<Digest> = {}): Digest {
  return { ...DIGEST, ...over };
}

afterEach(cleanup);

describe("WeekDigest", () => {
  it("lists what moved", () => {
    render(<WeekDigest digest={digest()} />);
    expect(screen.getByText("Window functions")).toBeDefined();
  });

  /** §4.2 law 1 — mastery moves on evidence, and the empty state says so
      rather than implying the learner did nothing. */
  it("says why nothing moved instead of just showing nothing", () => {
    render(<WeekDigest digest={digest({ moved: [] })} />);
    expect(
      screen.getByText("Nothing moved. Mastery only moves on work we can mark."),
    ).toBeDefined();
  });

  it("counts handed-in work, singular and plural", () => {
    render(<WeekDigest digest={digest({ artefacts: 1 })} />);
    expect(screen.getByText("1 piece of work handed in")).toBeDefined();

    cleanup();
    render(<WeekDigest digest={digest({ artefacts: 3 })} />);
    expect(screen.getByText("3 pieces of work handed in")).toBeDefined();
  });

  it("says nothing was handed in when nothing was", () => {
    render(<WeekDigest digest={digest({ artefacts: 0 })} />);
    expect(screen.getByText("Nothing handed in")).toBeDefined();
  });

  it("offers the way to what is slipping, only when something is", () => {
    render(<WeekDigest digest={digest({ tracked: 4, slipping: 1 })} />);

    expect(screen.getByText(/1 of them is starting to slip\./)).toBeDefined();
    const link = screen.getByRole("link", { name: /See which/ });
    expect(link.getAttribute("href")).toBe("/mastery?show=left");
  });

  it("says plainly when nothing is slipping, and offers no link", () => {
    render(<WeekDigest digest={digest({ tracked: 4, slipping: 0 })} />);

    expect(screen.getByText(/None of them are slipping\./)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("agrees with itself about how many skills there are", () => {
    render(<WeekDigest digest={digest({ tracked: 1, slipping: 1 })} />);
    expect(screen.getByText(/1 skill you have shown\./)).toBeDefined();
  });

  it("pluralises what is slipping", () => {
    render(<WeekDigest digest={digest({ tracked: 5, slipping: 2 })} />);
    expect(screen.getByText(/2 of them are starting to slip\./)).toBeDefined();
  });

  /** A learner with nothing tracked has shown nothing yet — which is not the
      same as having lost something, and must not read that way. */
  it("says what fills the second card when nothing is tracked", () => {
    render(<WeekDigest digest={digest({ tracked: 0, slipping: 0 })} />);

    expect(screen.getByText(/this fills up as you show what you can do/)).toBeDefined();
    expect(screen.queryByText(/starting to slip/)).toBeNull();
  });
});
