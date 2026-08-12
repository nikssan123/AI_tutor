import {
  CSS_VAR,
  dark,
  fonts,
  geometry,
  light,
  motion,
  typeScale,
  type Palette,
} from "./theme";

/**
 * Emits `tokens.css` from `theme.ts`.
 *
 * §8.5.4 requires three selector blocks, and both dark blocks must carry the
 * *same* values: the media query handles "System" (the default), and the
 * explicit `[data-theme="dark"]` block has to win even when the OS says light.
 * Generating both from one source is what stops them drifting apart.
 */

function paletteBlock(palette: Palette, indent = "  "): string {
  return (Object.keys(CSS_VAR) as Array<keyof Palette>)
    .map((key) => `${indent}${CSS_VAR[key]}: ${palette[key]};`)
    .join("\n");
}

function typeBlock(): string {
  return Object.entries(typeScale)
    .flatMap(([name, v]) => [
      `  --text-${name}-size: ${v.size};`,
      `  --text-${name}-line: ${v.line};`,
      `  --text-${name}-weight: ${v.weight};`,
      `  --text-${name}-tracking: ${v.tracking};`,
    ])
    .join("\n");
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function buildTokensCss(): string {
  return `/*
 * GENERATED FILE — do not edit.
 *
 * Source of truth: src/lib/theme.ts
 * Regenerate:      pnpm tokens:build
 * CI check:        pnpm tokens:check
 *
 * §8.5.4 — three states, not two: Light, Dark, and System (the default).
 * Only an explicit choice writes data-theme.
 */

:root {
  color-scheme: light;

  /* Palette — light */
${paletteBlock(light)}

  /* Type — §8.5.3 */
  --font-sans: ${fonts.sans};
  --font-mono: ${fonts.mono};
${typeBlock()}

  /* Geometry — 4px rhythm */
${Object.entries(geometry)
  .map(([k, v]) => `  --${kebab(k)}: ${v};`)
  .join("\n")}

  /* Motion — §8.5.6 */
${Object.entries(motion)
  .map(([k, v]) => `  --${kebab(k)}: ${v};`)
  .join("\n")}
}

/*
 * System preference. Guarded so an explicit "light" choice still wins when the
 * OS is dark — without the :not(), the toggle only works in one direction.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${paletteBlock(dark, "    ")}
  }
}

/* Explicit choice. Same values as above — emitted, never hand-copied. */
:root[data-theme="dark"] {
  color-scheme: dark;
${paletteBlock(dark)}
}

/*
 * §8.5.4 — learner artefacts always render at true colour. A photograph or a
 * chart being *evaluated* must never be dimmed, inverted or tinted: the grade
 * depends on how it actually looks, so a dark-mode filter would make the
 * verdict wrong. Fixed neutral mat, identical in both themes.
 */
.artifact-mat {
  background: #8a8a8a;
  color-scheme: light;
  filter: none;
}

/* §8.5.6 — prefers-reduced-motion collapses everything to a 100ms fade. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 100ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 100ms !important;
    transition-property: opacity !important;
    scroll-behavior: auto !important;
  }
}
`;
}
