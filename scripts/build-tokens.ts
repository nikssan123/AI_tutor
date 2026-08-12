import { readFileSync, writeFileSync } from "node:fs";
import { buildTokensCss } from "../src/lib/tokens-css";

/**
 * Emits src/styles/tokens.css from src/lib/theme.ts.
 *
 *   pnpm tokens:build   write the file
 *   pnpm tokens:check   fail if the checked-in file has drifted (CI gate)
 */
const OUT = "src/styles/tokens.css";
const check = process.argv.includes("--check");
const expected = buildTokensCss();

if (check) {
  let actual = "";
  try {
    actual = readFileSync(OUT, "utf8");
  } catch {
    console.error(`${OUT} is missing. Run \`pnpm tokens:build\`.`);
    process.exit(1);
  }

  if (actual !== expected) {
    console.error(
      `${OUT} is out of date with src/lib/theme.ts. Run \`pnpm tokens:build\` and commit the result.`,
    );
    process.exit(1);
  }

  console.log(`✓ ${OUT} is up to date`);
} else {
  writeFileSync(OUT, expected);
  console.log(`✓ wrote ${OUT}`);
}
