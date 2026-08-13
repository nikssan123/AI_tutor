import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every export from a `"use server"` module must be an async function.
 *
 * This is a bundler rule, and nothing else in `pnpm verify` can see it: a
 * synchronous helper or a plain constant exported from one of these files
 * type-checks, lints, and passes every unit test, then fails at build time and
 * takes the whole route down with it. It has happened twice — a `MAX_TURNS`
 * constant in the goal analyzer's actions, and `projectForBlock` in the
 * submission's, which 500'd the session page and hid the hand-in form entirely.
 *
 * Types are exempt because they are erased before the bundler sees them.
 *
 * Run by `pnpm verify` alongside the coverage audit.
 */

/** `export type`, `export interface`, and the `export type { … }` re-export. */
const TYPE_EXPORT = /^export\s+(type|interface)\b/;

/** The only runtime shape a `"use server"` module may expose. */
const ASYNC_EXPORT = /^export\s+(default\s+)?async\s+function\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

/**
 * True only when the directive is the module's first statement.
 *
 * An inline `"use server"` inside a function body marks a single action in an
 * ordinary module, and those files are bound by none of this.
 */
function isServerModule(source: string): boolean {
  const body = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));

  return /^["']use server["'];?$/.test(body[0] ?? "");
}

const failures: string[] = [];

for (const file of walk("src")) {
  const source = readFileSync(file, "utf8");
  if (!isServerModule(source)) continue;

  source.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line.startsWith("export")) return;
    if (TYPE_EXPORT.test(line) || ASYNC_EXPORT.test(line)) return;

    failures.push(
      `${file}:${index + 1} — ${line.slice(0, 60)}\n` +
        `      a "use server" module may only export async functions; ` +
        `move this to a plain module`,
    );
  });
}

if (failures.length > 0) {
  console.error("Server action audit failed:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log("✓ server action audit: every \"use server\" export is an async function");
