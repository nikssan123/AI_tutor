import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Keeps the 100% coverage number honest.
 *
 * A threshold is easy to satisfy dishonestly — add an `istanbul ignore`, exclude
 * a directory, stop counting a file. This asserts that none of those have
 * happened, so "100%" continues to mean what it meant on the day it was set.
 *
 * Run by CI alongside the coverage gate itself.
 */

const IGNORE_PATTERNS = [
  /\/\*\s*(c8|istanbul|v8)\s+ignore/i,
  /\/\/\s*(c8|istanbul|v8)\s+ignore/i,
  /coverage-ignore/i,
];

/** The only exclusion the config is allowed to carry. */
const ALLOWED_EXCLUDES = ['"src/**/*.d.ts"'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const failures: string[] = [];

// 1. No coverage-ignore comments anywhere in shipped source.
for (const file of walk("src")) {
  const source = readFileSync(file, "utf8");
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.test(source)) {
      failures.push(
        `${file} contains a coverage-ignore comment; cover the code or delete it`,
      );
    }
  }
}

// 2. The vitest config excludes nothing beyond ambient type declarations.
const config = readFileSync("vitest.config.ts", "utf8");
const excludeBlock = config.match(/exclude:\s*\[([^\]]*)\]/s)?.[1] ?? "";
const excludes = excludeBlock
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("//"));

for (const exclude of excludes) {
  if (!ALLOWED_EXCLUDES.includes(exclude)) {
    failures.push(
      `vitest.config.ts excludes ${exclude} from coverage; only ${ALLOWED_EXCLUDES.join(", ")} is permitted`,
    );
  }
}

// 3. Coverage still covers all of src.
if (!/include:\s*\["src\/\*\*\/\*\.\{ts,tsx\}"\]/.test(config)) {
  failures.push("vitest.config.ts no longer includes all of src/ in coverage");
}

// 4. All four thresholds are still 100.
for (const metric of ["lines", "functions", "branches", "statements"]) {
  if (!new RegExp(`${metric}:\\s*100`).test(config)) {
    failures.push(`vitest.config.ts ${metric} threshold is no longer 100`);
  }
}

if (failures.length > 0) {
  console.error("Coverage audit failed:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(
  `✓ coverage audit: no ignore comments, no exclusions beyond ${ALLOWED_EXCLUDES.join(", ")}, all thresholds at 100`,
);
