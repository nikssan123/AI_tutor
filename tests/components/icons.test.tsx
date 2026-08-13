// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  CameraIcon,
  ChecklistIcon,
  DatabaseIcon,
  GridIcon,
  PenIcon,
  StepsIcon,
  SubjectIcon,
} from "@/components/icons";

/**
 * The icon set's rules are the kind that rot silently — one icon added with a
 * hardcoded colour or a different stroke and the set stops looking like a set.
 * So they are asserted across every icon rather than trusted to review.
 */

afterEach(cleanup);

const ALL = [
  ["StepsIcon", StepsIcon],
  ["ChecklistIcon", ChecklistIcon],
  ["GridIcon", GridIcon],
  ["PenIcon", PenIcon],
  ["CameraIcon", CameraIcon],
  ["DatabaseIcon", DatabaseIcon],
] as const;

describe("the icon set", () => {
  it.each(ALL)("%s draws on a 24x24 grid at a 1.5 stroke", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
  });

  /**
   * §8.5.4 — an icon that names its own colour needs a second definition for
   * dark mode and will be forgotten. Inheriting is what makes one definition
   * correct in both themes.
   */
  it.each(ALL)("%s inherits colour rather than naming one", (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(container.querySelector("svg")!.getAttribute("stroke")).toBe(
      "currentColor",
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}|rgb\(|hsl\(/i);
  });

  it.each(ALL)("%s is decorative and stays out of the a11y tree", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it.each(ALL)("%s accepts a class without losing its own", (_name, Icon) => {
    const { container } = render(<Icon className="size-8" />);
    const cls = container.querySelector("svg")!.getAttribute("class")!;
    expect(cls).toContain("size-8");
    expect(cls).toContain("shrink-0");
  });
});

describe("SubjectIcon — §7.3 rule 1, adding a domain is a data change", () => {
  const marks = (taxonomyParent: string | null) => {
    const { container } = render(
      <SubjectIcon taxonomyParent={taxonomyParent} />,
    );
    return container.innerHTML;
  };

  it("gives each taxonomy branch its own mark", () => {
    const business = marks("professional-business");
    const creative = marks("creative");
    const technical = marks("technical-entry");

    expect(business).toBe(render(<PenIcon />).container.innerHTML);
    expect(creative).toBe(render(<CameraIcon />).container.innerHTML);
    expect(technical).toBe(render(<DatabaseIcon />).container.innerHTML);

    // Distinct, or the mapping is decorative rather than informative.
    expect(new Set([business, creative, technical]).size).toBe(3);
  });

  it("falls back to the neutral grid for an unknown taxonomy", () => {
    expect(marks("underwater-basket-weaving")).toBe(
      render(<GridIcon />).container.innerHTML,
    );
  });

  it("falls back to the neutral grid when a pack declares no taxonomy", () => {
    expect(marks(null)).toBe(render(<GridIcon />).container.innerHTML);
  });
});
