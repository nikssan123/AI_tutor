import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CSS_VAR,
  dark,
  fonts,
  geometry,
  light,
  motion,
  typeScale,
  type Palette,
} from "@/lib/theme";
import { buildTokensCss } from "@/lib/tokens-css";

const KEYS = Object.keys(CSS_VAR) as Array<keyof Palette>;

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("§8.5.3 — the palette", () => {
  it("defines the same keys in both themes", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    expect(Object.keys(light).sort()).toEqual([...KEYS].sort());
  });

  it("never uses pure black or pure white for ink on a surface", () => {
    // §8.5.4: pure white on dark causes halation and eye strain.
    expect(light.ink.toUpperCase()).not.toBe("#000000");
    expect(dark.ink.toUpperCase()).not.toBe("#FFFFFF");
  });

  it("keeps the palette to three hues plus neutrals", () => {
    // §8.5.3 — "No separate success colour. Verified IS the accent." A fourth
    // hue would make the accent stop being semantically load-bearing.
    const hues = new Set([light.accent, light.attention, light.problem]);
    expect(hues.size).toBe(3);
    expect(light).not.toHaveProperty("success");
  });

  it("brightens the accent in dark so it still reads on a dark ground", () => {
    expect(luminance(dark.accent)).toBeGreaterThan(luminance(light.accent));
  });

  it("inverts the hairline relationship, as §8.5.4 requires", () => {
    // Light: hairline is darker than the surface. Dark: lighter than it.
    expect(luminance(light.hairline)).toBeLessThan(luminance(light.surface));
    expect(luminance(dark.hairline)).toBeGreaterThan(luminance(dark.surface));
  });

  it("builds dark elevation from lighter surfaces rather than shadow", () => {
    expect(luminance(dark.ground)).toBeLessThan(luminance(dark.surface));
    expect(luminance(dark.surface)).toBeLessThan(luminance(dark.raised));
  });
});

describe("§8.5.4 — WCAG 2.2 AA contrast in both themes", () => {
  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: body text clears 4.5:1 on ground and surface", (_name, palette) => {
    expect(contrast(palette.ink, palette.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.ink, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: muted text clears 4.5:1 on surface", (_name, palette) => {
    expect(contrast(palette.inkMuted, palette.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: the accent clears 4.5:1 on surface", (_name, palette) => {
    // The accent carries "verified" and appears as text on secondary buttons.
    expect(contrast(palette.accent, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: faint text clears 3:1, the large-text bar", (_name, palette) => {
    // §8.5.4 names --ink-faint on --surface as one of the two pairs most
    // likely to fail, so it is asserted rather than assumed.
    expect(contrast(palette.inkFaint, palette.surface)).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: attention and problem clear 3:1 on ground", (_name, palette) => {
    // The other pair §8.5.4 flags: --attention on --ground.
    expect(contrast(palette.attention, palette.ground)).toBeGreaterThanOrEqual(3);
    expect(contrast(palette.problem, palette.ground)).toBeGreaterThanOrEqual(3);
  });
});

describe("§8.5.3 — scale and geometry", () => {
  it("has exactly six type sizes", () => {
    expect(Object.keys(typeScale)).toHaveLength(6);
  });

  it("tightens tracking as size increases", () => {
    const track = (v: string) => parseFloat(v);
    expect(track(typeScale.display.tracking)).toBeLessThan(
      track(typeScale.title.tracking),
    );
    expect(track(typeScale.title.tracking)).toBeLessThan(
      track(typeScale.body.tracking),
    );
  });

  it("keeps touch targets at 44px", () => {
    expect(geometry.touchMin).toBe("44px");
  });

  it("caps the reading measure", () => {
    expect(geometry.measure).toBe("68ch");
  });

  it("ships one font family plus a mono for code artefacts only", () => {
    expect(fonts.sans).toContain("Instrument Sans");
    // §8.5.2 — explicitly not Inter, Roboto, Geist or a system stack.
    for (const banned of ["Inter", "Roboto", "Geist", "-apple-system"]) {
      expect(fonts.sans).not.toContain(banned);
    }
    expect(fonts.mono).toContain("JetBrains Mono");
  });

  it("keeps motion durations short enough to feel composed", () => {
    expect(parseInt(motion.durFast)).toBeLessThanOrEqual(200);
    expect(parseInt(motion.durPanel)).toBeLessThanOrEqual(400);
  });
});

describe("tokens.css generation", () => {
  const css = buildTokensCss();

  it("emits every palette key in all three selector blocks", () => {
    for (const key of KEYS) {
      const occurrences = css.split(`${CSS_VAR[key]}:`).length - 1;
      // :root, the media query, and [data-theme="dark"].
      expect(occurrences, CSS_VAR[key]).toBe(3);
    }
  });

  it("guards the media query so an explicit light choice wins", () => {
    // Without the :not(), the toggle only works in one direction.
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme="light"])');
  });

  it("emits both dark blocks with identical values", () => {
    const mediaBlock = css.split(':root:not([data-theme="light"])')[1]!.split("}")[0]!;
    const explicitBlock = css.split(':root[data-theme="dark"]')[1]!.split("}")[0]!;
    for (const key of KEYS) {
      const needle = `${CSS_VAR[key]}: ${dark[key]};`;
      expect(mediaBlock).toContain(needle);
      expect(explicitBlock).toContain(needle);
    }
  });

  it("sets color-scheme, without which native controls stay light", () => {
    expect(css.match(/color-scheme: dark;/g)).toHaveLength(2);
    expect(css).toContain("color-scheme: light;");
  });

  it("pins the artefact mat to a fixed neutral in both themes", () => {
    // §8.5.4 — a dark-mode filter over work being graded makes the verdict wrong.
    expect(css).toContain(".artifact-mat");
    expect(css).toContain("filter: none;");
  });

  it("collapses motion under prefers-reduced-motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("transition-duration: 100ms !important;");
  });

  it("matches the checked-in file, so CI catches drift", () => {
    // This is the mechanism §8.5.4 asks for: authored once, emitted twice,
    // and mechanically prevented from diverging.
    expect(readFileSync("src/styles/tokens.css", "utf8")).toBe(css);
  });
});
