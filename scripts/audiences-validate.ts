import { AUDIENCES_DIR, loadAllAudiences } from "../src/lib/audiences/loader";
import { audiencePath } from "../src/lib/audiences/path";
import { resolveReferences } from "../src/lib/audiences/references";
import {
  isAudienceIndexable,
  scoreAudience,
} from "../src/lib/audiences/quality";
import { audienceProse } from "../src/lib/audiences/types";
import { QUALITY_THRESHOLD } from "../src/lib/guides/quality";

/**
 * CI gate for §10 C — `guides-validate.ts` for the audience pages, including
 * its severity rule: an unsigned page is a draft and prints warnings, and every
 * one of them becomes blocking the moment somebody records a reviewer. A gate
 * that fires while a page is still being written is a gate people route around.
 *
 * Usage:
 *   pnpm audiences:validate                # content/audiences
 *   pnpm audiences:validate path/to/dir    # a different root, for fixtures
 */
const root = process.argv[2] ?? AUDIENCES_DIR;

let audiences;
try {
  audiences = loadAllAudiences(root);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (audiences.length === 0) {
  console.log(`No audience pages under "${root}" yet.`);
  process.exit(0);
}

let failed = false;

for (const audience of audiences) {
  const signed = audience.review.reviewKind !== null;

  // Resolving is itself a check, twice over: the path throws on a claim about a
  // skill the pack no longer has, and the references throw on a figure this
  // page type cannot produce.
  let path;
  try {
    path = audiencePath(audience);
    resolveReferences(path, audienceProse(audience));
  } catch (error) {
    failed = true;
    console.error(`✗ ${audience.slug}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  const report = scoreAudience(path, audiences);
  const indexable = isAudienceIndexable(path, report);
  const blocking = signed && report.problems.length > 0;
  if (blocking) failed = true;

  const state = indexable
    ? "indexed"
    : signed
      ? "signed, held back"
      : "draft (noindex)";
  const marker = blocking ? "✗" : report.problems.length > 0 ? "!" : "✓";

  console.log(
    `${marker} ${audience.slug}  score ${report.score}/100 · ${state} · ` +
      `${path.known.length} known, ${path.transfers.length} transferring, ` +
      `${path.fresh.length} new · ${path.hours.low}–${path.hours.high}h of ${path.hours.total}`,
  );

  for (const problem of report.problems) {
    console.error(`  ${blocking ? "✗" : "!"} ${problem}`);
  }

  if (report.problems.length === 0 && report.score < QUALITY_THRESHOLD) {
    console.error(
      `  ! nothing is broken, but ${report.score} is under the ${QUALITY_THRESHOLD} publication bar`,
    );
  }

  for (const d of report.dimensions) {
    if (!d.measured) {
      console.log(`  · ${d.name} not measured — ${d.note}`);
    } else if (d.earned < 1) {
      const lost = (d.weight * (1 - d.earned)).toFixed(1).replace(/\.0$/, "");
      console.log(`  · ${d.name} −${lost} — ${d.note}`);
    }
  }
}

process.exit(failed ? 1 : 0);
