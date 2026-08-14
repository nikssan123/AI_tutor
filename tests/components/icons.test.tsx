// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  AccountIcon,
  ArrowIcon,
  CalendarIcon,
  CameraIcon,
  ChecklistIcon,
  CraftIcon,
  DatabaseIcon,
  GridIcon,
  MasteryIcon,
  PenIcon,
  ProgressIcon,
  StepsIcon,
  SubjectIcon,
  TodayIcon,
} from "@/components/icons";
import { CATEGORIES } from "@/lib/content/categories";

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
  ["TodayIcon", TodayIcon],
  ["CalendarIcon", CalendarIcon],
  ["MasteryIcon", MasteryIcon],
  ["ProgressIcon", ProgressIcon],
  ["AccountIcon", AccountIcon],
  ["ArrowIcon", ArrowIcon],
  ["CraftIcon", CraftIcon],
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

describe("the navigation marks", () => {
  /**
   * Two destinations drawn the same way make the rail say less than it did
   * before. Today marks one day because it stands for the one thing to do now;
   * the calendar marks a month.
   */
  it("gives every destination a mark of its own", () => {
    const drawn = [TodayIcon, CalendarIcon, MasteryIcon, ProgressIcon, AccountIcon].map(
      (Icon) => render(<Icon />).container.innerHTML,
    );
    expect(new Set(drawn).size).toBe(drawn.length);
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
    // Keyed on `content/categories.ts`'s vocabulary, which is the one the pack
    // generator emits. It used to key on `technical-entry` and
    // `professional-business` — values no generated pack has ever produced, so
    // every generated subject fell through to the grid.
    expect(marks("business")).toBe(render(<PenIcon />).container.innerHTML);
    expect(marks("creative")).toBe(render(<CameraIcon />).container.innerHTML);
    expect(marks("technology")).toBe(render(<DatabaseIcon />).container.innerHTML);
    expect(marks("craft")).toBe(render(<CraftIcon />).container.innerHTML);
  });

  /**
   * Derived from `CATEGORIES` rather than listed here, so a category added
   * without a mark fails instead of silently drawing the neutral grid — which
   * is what "unknown branch" is supposed to mean, and would stop meaning
   * anything if a named category could land there too.
   */
  it("draws every named category distinctly, and none of them as the fallback", () => {
    const grid = render(<GridIcon />).container.innerHTML;
    const drawn = CATEGORIES.map((c) => marks(c.slug));

    for (const [i, mark] of drawn.entries()) {
      expect(mark, CATEGORIES[i]!.slug).not.toBe(grid);
    }
    expect(new Set(drawn).size, "two categories share a mark").toBe(drawn.length);
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
