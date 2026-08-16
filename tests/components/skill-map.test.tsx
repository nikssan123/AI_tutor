// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SkillMap } from "@/components/skill-map";
import { SKILL_MAP, type SkillMapLayout } from "@/lib/goals/skill-map";

/**
 * The drawing half. `buildSkillMap` owns every number on this page, so what is
 * asserted here is the part a learner can only get from the render: that all
 * four states reach the picture, that the two kinds of edge are told apart *and
 * explained*, and that a name too long for its box is still recoverable.
 */

afterEach(cleanup);

const layout: SkillMapLayout = {
  width: 400,
  height: 300,
  nodes: [
    {
      skillId: "basics",
      name: "Basics",
      state: "proved",
      x: 16,
      y: 16,
      lines: ["Basics"],
      labelY: 45,
    },
    {
      skillId: "metering",
      name: "Metering and the histogram",
      state: "open",
      x: 204,
      y: 16,
      lines: ["Metering and the", "histogram"],
      labelY: 38,
    },
    {
      skillId: "tonal",
      name: "Tonal correction",
      state: "locked",
      x: 110,
      y: 120,
      lines: ["Tonal correction"],
      labelY: 149,
    },
    {
      skillId: "tuning",
      name: "Tuning",
      state: "optional",
      x: 300,
      y: 120,
      lines: ["Tuning"],
      labelY: 149,
    },
  ],
  edges: [
    { key: "basics->tonal", path: "M100 68 C 100 94, 194 94, 194 120", soft: false },
    { key: "basics->tuning", path: "M100 68 C 100 94, 384 94, 384 120", soft: true },
  ],
};

describe("SkillMap", () => {
  it("draws a box per skill and a curve per dependency", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);

    expect(container.querySelectorAll("svg > g > rect")).toHaveLength(4);
    expect(container.querySelectorAll("svg > path")).toHaveLength(2);
  });

  /** A soft prerequisite helps; it does not gate. The line has to say so. */
  it("dashes a soft prerequisite and leaves a hard one solid", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);
    const [hard, soft] = [...container.querySelectorAll("svg > path")];

    expect(hard!.getAttribute("stroke-dasharray")).toBeNull();
    expect(soft!.getAttribute("stroke-dasharray")).toBe("4 4");
  });

  /**
   * The wrapped label is the readable version; the full name has to survive
   * somewhere, or a skill whose name did not fit becomes a box you cannot
   * identify.
   */
  it("keeps the full name and its state on the node itself", () => {
    render(<SkillMap layout={layout} label="How it fits" />);

    expect(
      screen.getByText("Metering and the histogram — open now"),
    ).toBeTruthy();
    expect(screen.getByText("Metering and the")).toBeTruthy();
    expect(screen.getByText("histogram")).toBeTruthy();
  });

  /**
   * §8.5.5 — colour is never the sole carrier of meaning. Four fills, four
   * words, and the same four words the list above the picture uses.
   */
  it("names all four states and both kinds of line", () => {
    render(<SkillMap layout={layout} label="How it fits" />);

    for (const word of ["Open now", "Locked", "Already yours", "Optional"]) {
      expect(screen.getByText(word)).toBeTruthy();
    }
    expect(screen.getByText("Needed before it")).toBeTruthy();
    expect(screen.getByText("Helps, but not required")).toBeTruthy();
  });

  /**
   * One label rather than a walkable tree: the outline above the picture
   * already carries every skill with a sentence for it, and a screen reader
   * that also walked the graph would read the whole course twice.
   */
  it("is one labelled image, sized as it was laid out", () => {
    render(<SkillMap layout={layout} label="How photography builds up" />);
    const svg = screen.getByRole("img", { name: "How photography builds up" });

    expect(svg.getAttribute("viewBox")).toBe("0 0 400 300");
    expect(svg.getAttribute("width")).toBe("400");
  });

  it("draws every box at the geometry the layout was computed for", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);
    const rect = container.querySelector("svg > g > rect")!;

    expect(rect.getAttribute("width")).toBe(String(SKILL_MAP.nodeWidth));
    expect(rect.getAttribute("height")).toBe(String(SKILL_MAP.nodeHeight));
    expect(rect.getAttribute("x")).toBe("16");
  });
});
