/**
 * Emits the brand raster assets from one description of the mark.
 *
 * Run with `pnpm brand:build`. Not part of `pnpm verify`: these outputs are
 * checked in, change roughly never, and rasterising on every CI run would spend
 * seconds to reproduce bytes that are already there. The reason it is a script
 * rather than four files someone exported from a drawing app is drift — the
 * paths and the palette live in exactly one place each, here and in
 * `src/lib/theme.ts`, so a redraw cannot leave a stale PNG behind.
 *
 * `src/app/icon.svg` is deliberately *not* generated. It is hand-written,
 * because it carries the reasoning about browser chrome that this file's
 * outputs do not need.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { dark, light } from "../src/lib/theme";

/** The two paths, on the 24 grid. Must match `src/components/logo.tsx`. */
const STEM = "M4.25 19V8.75l7 7.5";
const ARM = "M11.25 16.25 20 5.25";

/**
 * The mark on a transparent ground, sized to a square canvas.
 *
 * `scale` and the translate are what centre it: the drawing's own bounds are
 * 4.25–20 across and 5.25–19 down, which is neither centred on the 24 grid nor
 * square, so a naive `viewBox="0 0 24 24"` export sits visibly high and left.
 */
function markSvg(size: number, ink: string, accent: string, stroke = 2): string {
  const scale = (size * 0.695) / 15.75;
  const dx = size / 2 - (12.125 - 0.0) * scale;
  const dy = size / 2 - 12.125 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <g transform="translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${scale.toFixed(5)})" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    <path d="${STEM}" stroke="${ink}"/>
    <path d="${ARM}" stroke="${accent}"/>
  </g>
</svg>`;
}

/** The mark on its own opaque ground. `radius` of 0 is what iOS wants. */
function tileSvg(size: number, radius: number): string {
  const inner = markSvg(size, light.ink, light.accent);
  const body = inner.slice(inner.indexOf("<g"), inner.lastIndexOf("</svg>"));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${light.ground}"/>
  ${body}
</svg>`;
}

const root = join(import.meta.dirname, "..");
const brand = join(root, "assets", "brand");
mkdirSync(brand, { recursive: true });

type Job = { file: string; svg: string; png?: string; size: number };

const jobs: Job[] = [
  // The mark alone, for a light surface and for a dark one. Transparent, so it
  // can sit on whatever ground the destination already has.
  { file: "mark-light.svg", svg: markSvg(512, light.ink, light.accent), png: "mark-light-512.png", size: 512 },
  { file: "mark-dark.svg", svg: markSvg(512, dark.ink, dark.accent), png: "mark-dark-512.png", size: 512 },
  // The app icon: opaque, square. iOS applies its own corner mask, so rounding
  // it here would leave the ground showing through the corners it rounds off.
  { file: "app-icon.svg", svg: tileSvg(1024, 0), png: "app-icon-1024.png", size: 1024 },
  { file: "app-icon-rounded.svg", svg: tileSvg(1024, 224), png: "app-icon-rounded-1024.png", size: 1024 },
];

const written: string[] = [];

for (const job of jobs) {
  writeFileSync(join(brand, job.file), `${job.svg}\n`);
  written.push(`assets/brand/${job.file}`);
  if (job.png) {
    await sharp(Buffer.from(job.svg)).png({ compressionLevel: 9 }).toFile(join(brand, job.png));
    written.push(`assets/brand/${job.png}`);
  }
}

/*
 * The email mark, which has to be a raster served from a public URL.
 *
 * `src/lib/email/render.ts` draws it at 24px and points at `/brand/mark-*.png`,
 * so these go to `public/` rather than to `assets/` — everything above is a
 * source asset something else consumes at build time, and these two are fetched
 * by a stranger's mail client at read time. 96 is 4× the drawn size, which is
 * the ratio a retina phone wants, and two strokes at 96px is under a kilobyte.
 *
 * Two files rather than one because a PNG cannot inherit ink: the frame picks
 * the variant for an explicit theme, and swaps between them with a
 * `prefers-color-scheme` rule when the reader is on System.
 */
const emailMarks = join(root, "public", "brand");
mkdirSync(emailMarks, { recursive: true });

for (const [name, palette] of [
  ["mark-light.png", light],
  ["mark-dark.png", dark],
] as const) {
  await sharp(Buffer.from(markSvg(96, palette.ink, palette.accent, 2.25)))
    .png({ compressionLevel: 9 })
    .toFile(join(emailMarks, name));
  written.push(`public/brand/${name}`);
}

// The iOS home-screen icon. 180 is the size current iPhones ask for, and the
// file convention wants a real raster: `apple-icon.svg` is not supported.
const appleSrc = tileSvg(1024, 0);
await sharp(Buffer.from(appleSrc))
  .resize(180, 180)
  .flatten({ background: light.ground }) // opaque: iOS renders alpha as black
  .png({ compressionLevel: 9 })
  .toFile(join(root, "src", "app", "apple-icon.png"));
written.push("src/app/apple-icon.png");

for (const f of written) console.log(`  ${f}`);
console.log(`\n${written.length} brand assets written.`);
