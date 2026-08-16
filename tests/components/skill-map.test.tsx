// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SkillMap, layersOf } from "@/components/skill-map";
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
      xCentred: 110,
      y: 16,
      lines: ["Basics"],
      labelY: 45,
    },
    {
      skillId: "metering",
      name: "Metering and the histogram",
      state: "open",
      x: 204,
      xCentred: 298,
      y: 16,
      lines: ["Metering and the", "histogram"],
      labelY: 38,
    },
    {
      skillId: "tonal",
      name: "Tonal correction",
      state: "locked",
      x: 110,
      xCentred: 110,
      y: 120,
      lines: ["Tonal correction"],
      labelY: 149,
    },
    {
      skillId: "tuning",
      name: "Tuning",
      state: "optional",
      x: 300,
      xCentred: 300,
      y: 120,
      lines: ["Tuning"],
      labelY: 149,
    },
  ],
  edges: [
    {
      key: "basics->tonal",
      path: "M100 68 C 100 94, 194 94, 194 120",
      pathCentred: "M194 68 C 194 94, 194 94, 194 120",
      soft: false,
    },
    {
      key: "basics->tuning",
      path: "M100 68 C 100 94, 384 94, 384 120",
      pathCentred: "M194 68 C 194 94, 384 94, 384 120",
      soft: true,
    },
  ],
};

/**
 * The two placements, and how the picture is put together to support them.
 *
 * `buildSkillMap` computes both because which one is right is a question about
 * the viewport; these assert the component gives the stylesheet what it needs
 * to choose — and, just as importantly, that it does not pay for the choice
 * twice where it does not have to.
 */
describe("the two placements", () => {
  it("draws the edges once per placement", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);

    const panned = container.querySelectorAll("svg > g.map-panned > path");
    const whole = container.querySelectorAll("svg > g.map-whole > path");

    expect(panned).toHaveLength(2);
    expect(whole).toHaveLength(2);
    expect(panned[0]!.getAttribute("d")).toBe(layout.edges[0]!.path);
    expect(whole[0]!.getAttribute("d")).toBe(layout.edges[0]!.pathCentred);
  });

  /**
   * The nodes are drawn *once* and moved, which is the point of the layer
   * grouping: a second copy would put every skill's name in the DOM twice, and
   * a `<title>` announced twice is worse than a curve drawn twice.
   */
  it("draws each skill exactly once, whatever the placement", () => {
    render(<SkillMap layout={layout} label="How it fits" />);

    expect(
      screen.getAllByText("Metering and the histogram — open now"),
    ).toHaveLength(1);
    expect(screen.getAllByText("Basics")).toHaveLength(1);
  });

  it("hands each layer the offset its whole row moves by", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);
    const layers = [...container.querySelectorAll("svg > g.map-layer")];

    // Two rows in the fixture, and every node in a row shares one offset.
    expect(layers).toHaveLength(2);
    expect(layers[0]!.getAttribute("style")).toContain("--map-shift: 94px");
    // The widest layer has nowhere to go and says so rather than being absent.
    expect(layers[1]!.getAttribute("style")).toContain("--map-shift: 0px");
  });
});

describe("layersOf", () => {
  it("groups the nodes back into the rows they were laid out in", () => {
    const layers = layersOf(layout.nodes);

    expect(layers.map((l) => l.y)).toEqual([16, 120]);
    expect(layers.map((l) => l.nodes.length)).toEqual([2, 2]);
    expect(layers.map((l) => l.shift)).toEqual([94, 0]);
  });
});

describe("SkillMap", () => {
  it("draws a box per skill and a curve per dependency", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);

    expect(container.querySelectorAll("svg > g.map-layer > g > rect")).toHaveLength(4);
    expect(container.querySelectorAll("svg > g.map-panned > path")).toHaveLength(2);
  });

  /** A soft prerequisite helps; it does not gate. The line has to say so. */
  it("dashes a soft prerequisite and leaves a hard one solid", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);
    const [hard, soft] = [
      ...container.querySelectorAll("svg > g.map-panned > path"),
    ];

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

  /**
   * The picture is wider than a phone and always will be, so it is panned —
   * and every platform it ships to hides the scrollbar until something is
   * already scrolling. A pane that scrolls silently reads as a picture that has
   * been cropped, so the container carries its own shading (see `.scroll-x` in
   * `globals.css`) and, on the screen where that is easiest to miss, a line
   * saying so in words.
   */
  it("makes the pane visibly scrollable rather than silently clipped", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);
    const pane = container.querySelector("svg[role='img']")!.parentElement!;

    expect(pane.className).toContain("scroll-x");
    expect(pane.className).not.toContain("overflow-x-auto");
    expect(screen.getByText(/drag it sideways/i)).toBeTruthy();
  });

  /** And it does not tell a phone to drag something that already fits. */
  it("says nothing about dragging a picture narrow enough to fit", () => {
    render(
      <SkillMap
        layout={{ ...layout, width: 200, nodes: [layout.nodes[0]!], edges: [] }}
        label="A very small subject"
      />,
    );

    expect(screen.queryByText(/drag it sideways/i)).toBeNull();
  });

  it("draws every box at the geometry the layout was computed for", () => {
    const { container } = render(<SkillMap layout={layout} label="How it fits" />);
    const rect = container.querySelector("svg > g.map-layer > g > rect")!;

    expect(rect.getAttribute("width")).toBe(String(SKILL_MAP.nodeWidth));
    expect(rect.getAttribute("height")).toBe(String(SKILL_MAP.nodeHeight));
    expect(rect.getAttribute("x")).toBe("16");
  });
});
