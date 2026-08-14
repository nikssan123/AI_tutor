import { loadAllGuides, GUIDES_DIR } from "../src/lib/guides/loader";
import { resolveData } from "../src/lib/guides/data";
import {
  isGuideIndexable,
  prose,
  scoreGuide,
  QUALITY_THRESHOLD,
} from "../src/lib/guides/quality";

/**
 * CI gate for §10 D, and the place §12.2's "computed at generation, blocks
 * publication below threshold" actually happens.
 *
 * **Severity depends on whether the guide has been signed.** An unsigned guide
 * is a draft — it is `noindex` by construction and it is allowed to be missing
 * its inbound links while the rest of its cluster is still being written, so
 * its problems print as warnings. The moment someone records a reviewer, every
 * one of them becomes blocking. That ordering is deliberate: the rules should
 * bite when a page is about to be published, not while it is being drafted,
 * because a gate that fires too early gets worked around.
 *
 * Usage:
 *   pnpm guides:validate                # every guide under content/guides
 *   pnpm guides:validate path/to/dir    # a different root, for fixtures
 */
const root = process.argv[2] ?? GUIDES_DIR;

let guides;
try {
  guides = loadAllGuides(root);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (guides.length === 0) {
  console.log(`No guides under "${root}" yet.`);
  process.exit(0);
}

let failed = false;

for (const guide of guides) {
  const signed = guide.review.reviewKind !== null;

  // Resolving is itself a check: a reference to a subject or project that no
  // longer exists throws here rather than rendering braces to a reader.
  try {
    resolveData(prose(guide));
  } catch (error) {
    failed = true;
    console.error(`✗ ${guide.slug}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  const report = scoreGuide(guide, guides);
  const indexable = isGuideIndexable(guide, report);
  const blocking = signed && report.problems.length > 0;
  if (blocking) failed = true;

  const state = indexable
    ? "indexed"
    : signed
      ? "signed, held back"
      : "draft (noindex)";
  const marker = blocking ? "✗" : report.problems.length > 0 ? "!" : "✓";

  console.log(
    `${marker} ${guide.slug}  score ${report.score}/100 · ${state} · ` +
      `${guide.sections.length} sections · ${guide.sources.length} sources`,
  );

  for (const problem of report.problems) {
    console.error(`  ${blocking ? "✗" : "!"} ${problem}`);
  }

  if (report.problems.length === 0 && report.score < QUALITY_THRESHOLD) {
    console.error(
      `  ! nothing is broken, but ${report.score} is under the ${QUALITY_THRESHOLD} publication bar`,
    );
  }

  // Only the dimensions that cost something, plus the ones nothing could
  // check. A full-marks line tells an author nothing they can act on.
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
