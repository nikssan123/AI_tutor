import { listPackDirs, loadPack } from "../src/lib/packs/loader";
import { validatePack } from "../src/lib/packs/validate";

/**
 * CI gate (§24 E2). Exits non-zero if any pack has a blocking issue, so a pack
 * with a cycle, a hallucinated skill reference or an MCQ-heavy item bank cannot
 * reach production.
 *
 * Usage:
 *   pnpm packs:validate                 # every pack under packs/
 *   pnpm packs:validate tests/fixtures  # a different root, for the broken fixtures
 */
const root = process.argv[2] ?? "packs";
const dirs = listPackDirs(root);

if (dirs.length === 0) {
  console.error(`No pack directories found under "${root}".`);
  process.exit(1);
}

let failed = false;

for (const dir of dirs) {
  try {
    const report = validatePack(loadPack(dir));
    const { stats } = report;

    if (report.passed) {
      console.log(
        `✓ ${report.packSlug}  ${stats.skills} skills · ${stats.dependencies} deps · ` +
          `${stats.items} items (${stats.productionItems} production / ${stats.mcqItems} mcq) · ` +
          `${stats.rubrics} rubrics · ${stats.projects} projects`,
      );
    } else {
      failed = true;
      console.error(`✗ ${report.packSlug}`);
    }

    for (const issue of report.issues) {
      const marker = issue.severity === "blocking" ? "  ✗" : "  !";
      console.error(`${marker} [${issue.check}] ${issue.message}`);
    }
  } catch (error) {
    failed = true;
    console.error(`✗ ${dir}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);
