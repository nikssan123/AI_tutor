import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The two weights §8.5.3 allows, as font *data* rather than as CSS.
 *
 * Satori has no browser behind it: it cannot fetch `/fonts/…`, and it does not
 * read `@font-face`. It also cannot read the woff2 the site ships — only `ttf`,
 * `otf` and `woff` are supported — so the same typeface has to be present twice
 * in two formats, once for the browser and once for the renderer. Static
 * instances rather than the variable file, because satori renders a variable
 * font at its default instance only, which would silently collapse the 600 to
 * the 400 and lose every bit of weight contrast on the card.
 *
 * Read once at module scope: the files do not depend on the request, and doing
 * it per image would re-read 173KB on every crawl of every share.
 */
const dir = join(process.cwd(), "assets", "fonts");

const [regular, semiBold] = await Promise.all([
  readFile(join(dir, "InstrumentSans-Regular.ttf")),
  readFile(join(dir, "InstrumentSans-SemiBold.ttf")),
]);

export const OG_FONT_FAMILY = "Instrument Sans";

export const OG_FONTS = [
  { name: OG_FONT_FAMILY, data: regular, style: "normal", weight: 400 },
  { name: OG_FONT_FAMILY, data: semiBold, style: "normal", weight: 600 },
] as const;
