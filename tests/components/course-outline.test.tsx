// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CourseOutline, OutlineLegend } from "@/components/course-outline";
import type { Outline, OutlineSection, OutlineSkill } from "@/lib/goals/outline";

/**
 * The list's job is to be readable without being clicked, so what is asserted
 * is what a learner can see before touching anything: the section headings, the
 * state words, and — for the one section that arrives expanded — the rows.
 *
 * Built from a literal rather than from `buildOutline`, because the states are
 * that function's business and this is the part that turns them into words.
 */

afterEach(cleanup);

function skill(overrides: Partial<OutlineSkill> = {}): OutlineSkill {
  return {
    skillId: "joins",
    name: "Joins",
    state: "open",
    hours: 4,
    note: "Open to you now — you'll be able to join three tables.",
    ...overrides,
  };
}

function section(overrides: Partial<OutlineSection> = {}): OutlineSection {
  return {
    key: "module-0",
    title: "Joining tables",
    state: "open",
    skills: [skill()],
    hours: 4,
    handIn: null,
    current: true,
    ...overrides,
  };
}

const outline = (overrides: Partial<Outline> = {}): Outline => ({
  sections: [section()],
  counts: { open: 1, locked: 0, proved: 0, optional: 0 },
  ...overrides,
});

describe("OutlineLegend", () => {
  it("says what the whole list adds up to", () => {
    render(
      <OutlineLegend
        counts={{ open: 2, locked: 7, proved: 3, optional: 1 }}
      />,
    );

    expect(screen.getByText(/2\s*open now/)).toBeTruthy();
    expect(screen.getByText(/7\s*locked/)).toBeTruthy();
    expect(screen.getByText(/3\s*already yours/)).toBeTruthy();
    expect(screen.getByText(/1\s*optional/)).toBeTruthy();
  });

  /** "0 locked" is a sentence about nothing. */
  it("drops a state nothing is in", () => {
    render(
      <OutlineLegend
        counts={{ open: 2, locked: 0, proved: 0, optional: 0 }}
      />,
    );

    expect(screen.queryByText(/locked/)).toBeNull();
  });
});

describe("CourseOutline", () => {
  it("numbers the sections and says how much is in each", () => {
    render(<CourseOutline outline={outline()} />);

    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("Joining tables")).toBeTruthy();
    expect(screen.getByText("1 skill · 4h to go")).toBeTruthy();
  });

  it("drops the hours from a section that owes none", () => {
    render(
      <CourseOutline
        outline={outline({
          sections: [
            section({
              hours: 0,
              state: "proved",
              current: false,
              skills: [
                skill({ state: "proved", hours: 0, note: "You showed you can." }),
                skill({ skillId: "windows", name: "Windows", state: "proved", hours: 0, note: "So can you this." }),
              ],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("2 skills")).toBeTruthy();
  });

  /**
   * The disclosure is `<details>`, so the section that matters is open in the
   * HTML itself — before React loads, and without a line of state.
   */
  it("arrives with the current section open and the rest shut", () => {
    const { container } = render(
      <CourseOutline
        outline={outline({
          sections: [
            section(),
            section({ key: "module-1", title: "Windows", current: false }),
          ],
        })}
      />,
    );

    const [first, second] = [...container.querySelectorAll("details")];
    expect(first!.hasAttribute("open")).toBe(true);
    expect(second!.hasAttribute("open")).toBe(false);
  });

  it("gives every skill its state as a word and its reason as a sentence", () => {
    render(
      <CourseOutline
        outline={outline({
          sections: [
            section({
              skills: [
                skill({
                  state: "locked",
                  note: "Unlocks once you've done Basics.",
                }),
              ],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.getByText("Unlocks once you've done Basics.")).toBeTruthy();
  });

  /**
   * §8.5.5 bans colour as the sole carrier of meaning, so the dimming is the
   * second signal and never the only one — but a list where a locked row reads
   * exactly as loud as an open one is the thing this screen replaced.
   */
  it("dims a skill that is not the learner's to start", () => {
    render(
      <CourseOutline
        outline={outline({
          sections: [
            section({
              skills: [
                skill({ skillId: "open", name: "Open one" }),
                skill({ skillId: "shut", name: "Shut one", state: "locked" }),
              ],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Open one").className).not.toContain(
      "text-ink-muted",
    );
    expect(screen.getByText("Shut one").className).toContain("text-ink-muted");
  });

  it("drops the hours from a skill that owes none", () => {
    render(
      <CourseOutline
        outline={outline({
          sections: [
            section({
              hours: 0,
              skills: [skill({ state: "proved", hours: 0, note: "Done." })],
            }),
          ],
        })}
      />,
    );

    // Neither the row nor the header quotes a zero: "0h" is not a fact about
    // the work, it is the absence of one.
    expect(screen.queryByText(/0h/)).toBeNull();
    expect(screen.getByText("Already yours")).toBeTruthy();
  });

  /** §2.2 — the graded hand-in is what the module is *for*. */
  it("gives a module's hand-in a row of its own", () => {
    render(
      <CourseOutline
        outline={outline({
          sections: [
            section({ handIn: "Ends with a project you hand in, and we mark it" }),
          ],
        })}
      />,
    );

    expect(
      screen.getByText("Ends with a project you hand in, and we mark it"),
    ).toBeTruthy();
    expect(screen.getByText("Graded")).toBeTruthy();
  });
});
