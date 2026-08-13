/**
 * §8.5.3 — the design tokens, authored once.
 *
 * This file is the only place a colour, size or duration is written down.
 * `scripts/build-tokens.ts` emits `src/styles/tokens.css` from it with all three
 * selector blocks; CI re-runs the emitter and fails if the checked-in CSS has
 * drifted. §8.5.4 is explicit about why: "Hand-maintaining two copies of a
 * palette is how themes silently diverge."
 *
 * The identity is *quiet instrument* — cool neutral ground, near-black ink, and
 * a single jade accent that carries the product's core semantic: verified.
 */

export interface Palette {
  ground: string;
  surface: string;
  raised: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  hairline: string;
  accent: string;
  accentWeak: string;
  /**
   * What text sits in when the accent is the *fill* rather than the ink —
   * the filled button, the primary link-as-button.
   *
   * A token rather than a literal because the correct answer inverts between
   * themes and getting it wrong is invisible to the author. Light's `#00785C`
   * needs white (5.53:1); dark's `#35C79A` is a bright mint and white on it
   * measures 2.17:1 — a fail bad enough to make the product's one filled
   * button its least readable control. Every call site had been writing
   * `text-white`, which is right in exactly one of the two themes.
   */
  onAccent: string;
  attention: string;
  problem: string;
  shadowRaised: string;
  /**
   * §8.5.3 keeps elevation to one shadow because product screens separate with
   * space. The marketing hero is the one place that rule fails: a `--surface`
   * card sitting on an `--accent-weak` field measures 1.13:1 in light, so
   * without a deeper shadow the card has no edge at all. Used on marketing
   * showcase surfaces only — never on a product screen.
   */
  shadowLifted: string;
}

/**
 * §8.5.3 — light. Never pure black on a surface, never pure white text.
 */
export const light: Palette = {
  ground: "#FAFAFA",
  surface: "#FFFFFF",
  raised: "#FFFFFF",
  ink: "#17191C",
  inkMuted: "#5C6169",
  // Darkened from the plan's #9AA0A8, which measured 2.64:1 on white — below
  // even the 3:1 large-text bar. §8.5.4 names this exact pair as the most
  // likely to fail and says to treat a failure as a token bug. --ink-faint
  // carries 13px meta text, so it is held to the 4.5:1 small-text bar.
  inkFaint: "#70747A",
  hairline: "#E8E9EB",
  accent: "#00785C",
  accentWeak: "#E6F4F0",
  // 5.53:1 on --accent.
  onAccent: "#FFFFFF",
  attention: "#B26A00",
  problem: "#B3261E",
  shadowRaised:
    "0 1px 2px rgb(23 25 28 / .04), 0 12px 32px rgb(23 25 28 / .07)",
  shadowLifted:
    "0 2px 4px rgb(23 25 28 / .05), 0 24px 56px -12px rgb(23 25 28 / .16)",
};

/**
 * §8.5.4 — dark is not inverted light.
 *
 * Elevation comes from *lighter* surfaces rather than shadow, because shadows
 * are nearly invisible on a dark ground. `ink` is deliberately not `#FFFFFF`:
 * pure white on dark causes halation. The accent brightens to hold contrast.
 */
export const dark: Palette = {
  ground: "#0E1013",
  surface: "#16191D",
  raised: "#1D2126",
  ink: "#F2F3F4",
  inkMuted: "#A2A9B2",
  // Lightened from the plan's #6B727B (3.63:1 on --surface) for the same reason.
  inkFaint: "#82888F",
  hairline: "#262A2F",
  accent: "#35C79A",
  accentWeak: "#12302A",
  // Dark ink on the mint, not white: 8.9:1 rather than white's 2.17:1.
  onAccent: "#06231B",
  attention: "#E0A33C",
  problem: "#F2726A",
  shadowRaised: "0 1px 2px rgb(0 0 0 / .3), 0 12px 32px rgb(0 0 0 / .35)",
  shadowLifted: "0 2px 4px rgb(0 0 0 / .4), 0 24px 56px -12px rgb(0 0 0 / .6)",
};

/** CSS custom-property name for a palette key. */
export const CSS_VAR: Record<keyof Palette, string> = {
  ground: "--ground",
  surface: "--surface",
  raised: "--raised",
  ink: "--ink",
  inkMuted: "--ink-muted",
  inkFaint: "--ink-faint",
  hairline: "--hairline",
  accent: "--accent",
  accentWeak: "--accent-weak",
  onAccent: "--on-accent",
  attention: "--attention",
  problem: "--problem",
  shadowRaised: "--shadow-raised",
  shadowLifted: "--shadow-lifted",
};

/**
 * §8.5.3 — six product sizes, plus one.
 *
 * `hero` is the seventh, and it exists for exactly one job: the marketing
 * landing headline. The six-size rule is about *product screens*, where a
 * seventh size is drift — but `display` at a fixed 2.5rem is only 2.5× body,
 * so on a 1440px viewport the landing hero had no more presence than a section
 * heading, and the page read as flat. Fluid rather than fixed, so the phone
 * still gets the 2.5rem the scale specifies and the desktop gets 4.5rem.
 *
 * Character comes from scale and tracking discipline, not from mixing
 * typefaces. Tight tracking on the large sizes is where it lives.
 */
export const typeScale = {
  hero: {
    size: "clamp(2.5rem, 6vw, 4.5rem)",
    line: "1.02",
    weight: "650",
    tracking: "-0.04em",
  },
  display: { size: "2.5rem", line: "1.1", weight: "650", tracking: "-0.03em" },
  title: { size: "1.5rem", line: "1.25", weight: "600", tracking: "-0.02em" },
  lead: { size: "1.1875rem", line: "1.5", weight: "400", tracking: "-0.01em" },
  body: { size: "1rem", line: "1.6", weight: "400", tracking: "0" },
  label: { size: "0.875rem", line: "1.4", weight: "550", tracking: "0" },
  meta: { size: "0.8125rem", line: "1.4", weight: "400", tracking: "0.01em" },
} as const;

/** §8.5.3 — geometry on a 4px rhythm, slightly softer than iOS. */
export const geometry = {
  radiusControl: "12px",
  radiusCard: "18px",
  radiusPill: "999px",
  touchMin: "44px",
  measure: "68ch",
} as const;

/** §8.5.6 — composed, not playful: springs settle without visible bounce. */
export const motion = {
  easeSpring:
    "linear(0,.0067,.0265,.0587,.1021,.1553,.2168,.2851,.3587,.4361,.5157,.5961,.6757,.7531,.8269,.8956,.9578,1.0116,1.0553,1.0872,1.0951,1.0784,1.0435,1.0139,1)",
  easeOut: "cubic-bezier(.22,.61,.36,1)",
  durFast: "160ms",
  durBase: "240ms",
  durPanel: "320ms",
} as const;

export const fonts = {
  sans: '"Instrument Sans", "Instrument Sans Fallback", sans-serif',
  /** §8.5.5 — monospace is banned outside code artefacts. */
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;
