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

  /**
   * §8.5.3's rule is "no separate *success* colour — verified IS the accent",
   * and the reason is that a fourth semantic competing with verified would take
   * the accent's one job away. `planned` is the opposite of that case: it is
   * the calendar's third certainty, a date that has not happened and is not
   * owed, which had been drawn in `--ink-muted` — quieter than an ordinary day.
   * Letting it wear the accent instead is exactly what the rule forbids, so it
   * gets a hue of its own and the accent keeps meaning "this happened".
   *
   * The ban that matters is still asserted: no success colour, ever.
   */
  it("adds no hue that competes with the accent", () => {
    const hues = new Set([
      light.accent,
      light.attention,
      light.problem,
      light.planned,
    ]);
    expect(hues.size).toBe(4);
    expect(light).not.toHaveProperty("success");
    expect(light).not.toHaveProperty("verified");
  });

  it("brightens the accent in dark so it still reads on a dark ground", () => {
    expect(luminance(dark.accent)).toBeGreaterThan(luminance(light.accent));
  });

  it("brightens the projected hue in dark for the same reason", () => {
    expect(luminance(dark.planned)).toBeGreaterThan(luminance(light.planned));
  });

  it("inverts the hairline relationship, as §8.5.4 requires", () => {
    // Light: hairline is darker than the surface. Dark: lighter than it.
    expect(luminance(light.hairline)).toBeLessThan(luminance(light.surface));
    expect(luminance(dark.hairline)).toBeGreaterThan(luminance(dark.surface));
  });

  it("keeps the two elevations distinct in both themes", () => {
    // §8.5.3 allows one shadow; --shadow-lifted is the documented second, for
    // marketing showcase surfaces only. If they ever converge, one of them is
    // dead weight.
    for (const palette of [light, dark]) {
      expect(palette.shadowLifted).not.toBe(palette.shadowRaised);
    }
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
  ])("%s: a projected date clears 4.5:1 on surface", (_name, palette) => {
    // It colours a 13px numeral, so it is held to the small-text bar rather
    // than the 3:1 one a decorative mark could live at.
    expect(contrast(palette.planned, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: the accent clears 4.5:1 on surface", (_name, palette) => {
    // The accent carries "verified" and appears as text on secondary buttons.
    expect(contrast(palette.accent, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The filled button — the one place the accent is a *fill* rather than ink,
   * and the pair with no safe literal. White clears 5.53:1 on light's
   * `#00785C` and measures **2.17:1** on dark's `#35C79A`, so every call site
   * writing `text-white` was correct in exactly one of the two themes.
   */
  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: label text clears 4.5:1 on the accent fill", (_name, palette) => {
    expect(contrast(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: faint text clears 3:1, the large-text bar", (_name, palette) => {
    // §8.5.4 names --ink-faint on --surface as one of the two pairs most
    // likely to fail, so it is asserted rather than assumed.
    expect(contrast(palette.inkFaint, palette.surface)).toBeGreaterThanOrEqual(3);
  });

  /**
   * The landing page turned `--accent-weak` from a small tinted fill into a
   * full-bleed band carrying real copy, which puts it under the same bar as any
   * other reading surface. Asserted here rather than eyeballed, because the
   * band is the one place on the site where a contrast regression would be
   * invisible in light and obvious in dark.
   */
  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: text on the accent field clears 4.5:1", (_name, palette) => {
    expect(contrast(palette.ink, palette.accentWeak)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.inkMuted, palette.accentWeak)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(palette.accent, palette.accentWeak)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: faint text does NOT clear 4.5:1 on the accent field", (_name, palette) => {
    // 4.15:1 light, 3.96:1 dark. This is why `Meta` has a `tone` prop and why
    // anything meta-sized on the field passes `tone="muted"`. If a palette
    // change ever makes this pass, the prop can go — but until then the
    // failure mode is silent, so it is pinned.
    expect(contrast(palette.inkFaint, palette.accentWeak)).toBeLessThan(4.5);
    expect(contrast(palette.inkFaint, palette.accentWeak)).toBeGreaterThanOrEqual(3);
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
  it("has six product sizes, plus hero for the marketing headline", () => {
    // The six-size rule governs product screens, where a seventh size is
    // drift. `hero` is the deliberate exception and the only one — if this
    // ever reads 8, something has started inventing sizes again.
    expect(Object.keys(typeScale)).toHaveLength(7);
    expect(Object.keys(typeScale)).toContain("hero");
  });

  it("keeps the hero fluid, so a phone still gets the scale's 2.5rem", () => {
    // A fixed 4.5rem headline would overflow a 360px viewport, and a fixed
    // 2.5rem one is what made the landing page look flat on a desktop.
    expect(typeScale.hero.size).toMatch(/^clamp\(/);
    expect(typeScale.hero.size).toContain("2.5rem");
    expect(typeScale.display.size).toBe("2.5rem");
  });

  it("tightens tracking as size increases", () => {
    const track = (v: string) => parseFloat(v);
    expect(track(typeScale.hero.tracking)).toBeLessThan(
      track(typeScale.display.tracking),
    );
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
