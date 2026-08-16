// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  AccountIcon,
  ArrowIcon,
  CameraIcon,
  ChecklistIcon,
  ChevronIcon,
  CraftIcon,
  DatabaseIcon,
  GoogleIcon,
  GridIcon,
  LockIcon,
  MasteryIcon,
  PathIcon,
  PenIcon,
  PlusIcon,
  PriceIcon,
  ProgressIcon,
  QuestionIcon,
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
  ["PriceIcon", PriceIcon],
  ["QuestionIcon", QuestionIcon],
  ["PenIcon", PenIcon],
  ["CameraIcon", CameraIcon],
  ["DatabaseIcon", DatabaseIcon],
  ["TodayIcon", TodayIcon],
  ["PathIcon", PathIcon],
  ["MasteryIcon", MasteryIcon],
  ["ProgressIcon", ProgressIcon],
  ["AccountIcon", AccountIcon],
  ["ArrowIcon", ArrowIcon],
  ["ChevronIcon", ChevronIcon],
  ["CraftIcon", CraftIcon],
  ["LockIcon", LockIcon],
  ["PlusIcon", PlusIcon],
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

/**
 * The brand mark is the one deliberate hole in the rules above, so it is tested
 * as an exception rather than quietly left out of `ALL` — a reader who finds it
 * missing from that list should be able to find out here why, and a later
 * change that "fixes" it to `currentColor` should fail something.
 */
describe("GoogleIcon — the sanctioned exception to the icon rules", () => {
  it("keeps Google's four brand colours rather than inheriting ours", () => {
    const { container } = render(<GoogleIcon />);
    // Recolouring the mark is the specific thing Google's terms forbid, so the
    // literal hexes are the assertion, not an implementation detail.
    for (const hex of ["#EA4335", "#4285F4", "#FBBC05", "#34A853"]) {
      expect(container.innerHTML).toContain(hex);
    }
    expect(container.querySelector("svg")!.getAttribute("stroke")).toBe(null);
  });

  it("is filled brand art on its own grid, not a 24x24 stroked glyph", () => {
    const { container } = render(<GoogleIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 48 48");
    expect(svg.getAttribute("stroke-width")).toBe(null);
  });

  /** The exception is bounded: everything not about colour still applies. */
  it("stays decorative and sizeable like the rest of the set", () => {
    const { container } = render(<GoogleIcon className="size-8" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("class")).toContain("size-8");
    expect(svg.getAttribute("class")).toContain("shrink-0");
  });

  it("is not smuggled into the set the shared rules police", () => {
    // If someone adds it to ALL, the currentColor assertion there starts
    // failing for a reason that reads as a bug in the icon. Catch it here
    // instead, where the message says what actually went wrong.
    expect(ALL.map(([name]) => name)).not.toContain("GoogleIcon");
  });
});

describe("the navigation marks", () => {
  /**
   * Two destinations drawn the same way make the rail say less than it did
   * before. Today marks a single day because it stands for the one thing to do
   * now; Path is a route between points because the order is derived.
   *
   * The list is the rail, so it has to move with it — `PathIcon` was added to
   * the product without reaching this file, which meant the newest destination
   * was the one mark nobody was checking for a collision.
   */
  it("gives every destination a mark of its own", () => {
    const drawn = [
      TodayIcon,
      PathIcon,
      MasteryIcon,
      ProgressIcon,
      AccountIcon,
    ].map((Icon) => render(<Icon />).container.innerHTML);
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

/**
 * The four states a skill can be in on the path screen. They are the one place
 * in the product where four marks appear side by side in the same list, so two
 * of them drawn alike would not read as "similar" — it would read as the same
 * state twice, and the list would be lying about half its rows.
 */
describe("the skill-state marks", () => {
  it("gives every state a mark of its own", () => {
    const drawn = [ArrowIcon, LockIcon, MasteryIcon, PlusIcon].map(
      (Icon) => render(<Icon />).container.innerHTML,
    );
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  /**
   * Optional is an offer, not a refusal. A cross rotated out of `CloseIcon`
   * would be the same path drawn at 45°, and "you may also take this" is not
   * the thing a cross says.
   */
  it("draws optional as a plus rather than a cross", () => {
    const { container } = render(<PlusIcon />);
    const d = container.querySelector("path")!.getAttribute("d")!;

    expect(d).toContain("M12 5.5v13");
    expect(d).toContain("M5.5 12h13");
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
