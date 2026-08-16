import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { getAnthropic } from "@/lib/ai/client";
import { createClient } from "@/db";
import { findPack } from "@/lib/content";
import { evaluateSubmission } from "@/lib/evaluation";
import {
  agreementBetween,
  BANDS,
  KAPPA_TARGET,
  STABILITY_TARGET,
  verdictFor,
  type Judgement,
} from "@/lib/evaluation/agreement";
import type { Band } from "@/lib/contracts/evaluation";

/**
 * §24 E8's last two acceptance criteria, measured against a real corpus.
 *
 *   pnpm calibrate calibration/query-rescue.yaml
 *
 * §23 lists the hand-graded set as a Phase-0 MUST and §27 D21–25 asks for it to
 * run "as an automated eval in CI". This is that runner. The arithmetic lives in
 * `src/lib/evaluation/agreement.ts` and is unit-tested; everything here is I/O.
 *
 * It grades each submission **twice**, because the two criteria need different
 * comparisons: run 1 against your grades is accuracy (κ), and run 1 against run
 * 2 is consistency. Two passes over five submissions is ten deep-tier calls, so
 * budget roughly $1 and eight minutes.
 *
 * Nothing here writes to the database. The evaluation rows are logged by
 * `evaluateSubmission` itself for cost tracking; no learner or mastery state is
 * touched, so this is safe to run against any environment.
 */

interface Corpus {
  pack: string;
  project: string;
  submissions: Array<{
    id: string;
    artefact: string;
    /**
     * Your hand-grades: criterion id → band.
     *
     * Typed loose because it is parsed YAML, and a corpus is shipped with these
     * blank for you to fill in. `isBand` is what turns it into a `Band`.
     */
    grades: Record<string, unknown>;
  }>;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function isBand(value: unknown): value is Band {
  return (
    typeof value === "string" && (BANDS as readonly string[]).includes(value)
  );
}

async function main() {
  const args = process.argv.slice(2);
  /**
   * E8 has two acceptance criteria and only one of them needs a human.
   *
   * κ compares the grader against hand-grades and cannot be computed without
   * them. **Stability compares the grader against itself**, so it needs no
   * corpus grades at all — and until this flag existed it was unreachable
   * anyway, because the validation below refuses to run on an ungraded corpus.
   * That coupling meant half of E8 sat blocked on the wrong person.
   */
  const stabilityOnly = args.includes("--stability-only");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) fail("usage: pnpm calibrate [--stability-only] <corpus.yaml>");

  const corpus = parse(await readFile(path, "utf8")) as Corpus;

  const pack = findPack(corpus.pack);
  if (!pack) fail(`no pack "${corpus.pack}"`);

  const project = pack.projects.find((p) => p.slug === corpus.project);
  if (!project) fail(`no project "${corpus.project}" in ${pack.slug}`);

  const rubric = pack.rubrics.find((r) => r.slug === project.rubric)!;
  const skill = pack.skills.find((s) => project.targetSkills.includes(s.slug))!;
  const criterionIds = new Set(rubric.criteria.map((c) => c.id));

  const human: Judgement[] = [];

  // Checked before spending anything: a typo'd criterion id silently drops a
  // judgement, and a corpus that quietly measures 12 pairs instead of 20 is
  // worse than one that refuses to run. The grades are read into `human` here
  // rather than in the run loop, so nothing is trusted where it was not checked.
  if (!stabilityOnly) {
    for (const submission of corpus.submissions) {
      const graded = Object.entries(submission.grades ?? {});
      for (const [id, band] of graded) {
        if (!criterionIds.has(id)) {
          fail(`submission "${submission.id}" grades unknown criterion "${id}"`);
        }
        // An unfilled or misspelled band is worse than a missing one. `BANDS`
        // has no index for it, so it still pairs, scores as three bands of
        // disagreement, and drags κ down without appearing anywhere in the
        // output. A corpus nobody has finished grading has to refuse to run.
        if (!isBand(band)) {
          fail(
            `submission "${submission.id}" has no band for "${id}" — read ${JSON.stringify(band)}, expected one of ${BANDS.join(", ")}`,
          );
        }
        human.push({ submissionId: submission.id, criterionId: id, band });
      }
      const missing = [...criterionIds].filter(
        (id) => !graded.some(([key]) => key === id),
      );
      if (missing.length > 0) {
        fail(
          `submission "${submission.id}" is missing grades for: ${missing.join(", ")}`,
        );
      }
    }
  }

  console.log(`corpus:  ${corpus.submissions.length} submissions`);
  console.log(`brief:   ${project.title}`);
  console.log(`rubric:  ${rubric.slug} (${rubric.criteria.length} criteria)`);
  console.log(
    `pairs:   ${corpus.submissions.length * rubric.criteria.length} judgements\n`,
  );

  // Client first: it throws on a missing key, and there is no reason to open a
  // database connection we are about to abandon.
  const client = getAnthropic();
  const { db, close } = createClient(process.env.DATABASE_URL!, 2);

  const first: Judgement[] = [];
  const second: Judgement[] = [];

  try {
    for (const submission of corpus.submissions) {
      for (const [pass, sink] of [
        [1, first],
        [2, second],
      ] as const) {
        const started = Date.now();
        const outcome = await evaluateSubmission(
          // Operator work, not a visitor: without this the run's spend counts
          // against §19.2's free-tier cap and degrades the anonymous check for
          // real people. Ten deep-tier calls is ~100¢ of a 500¢ daily budget.
          { client, db, userId: null, origin: "operator" },
          {
            project,
            criteria: rubric.criteria,
            skillTier: skill.evalTier,
            artefact: submission.artefact,
          },
        );

        const seconds = ((Date.now() - started) / 1000).toFixed(0);
        if (!outcome.result) {
          // Not fatal: a refusal is a data point, and dropping the pair is more
          // honest than inventing a band for it.
          console.log(`  ${submission.id} pass ${pass}: refused — ${outcome.reason}`);
          continue;
        }

        for (const criterion of outcome.result.criteria) {
          sink.push({
            submissionId: submission.id,
            criterionId: criterion.criterionId,
            band: criterion.band,
          });
        }
        console.log(
          `  ${submission.id} pass ${pass}: ${outcome.result.criteria.length} criteria, ${seconds}s`,
        );
      }
    }
  } finally {
    await close();
  }

  const accuracy = agreementBetween(human, first);
  const stability = agreementBetween(first, second);
  const verdict = verdictFor(accuracy, stability);

  if (!stabilityOnly) {
    console.log(`\n── agreement with your grades ──────────────────────────`);
    console.log(`  pairs compared:  ${accuracy.n}`);
    console.log(`  same band:       ${(accuracy.observed * 100).toFixed(0)}%`);
    console.log(`  within one band: ${(accuracy.withinOneBand * 100).toFixed(0)}%`);
    console.log(`  by chance:       ${(accuracy.expected * 100).toFixed(0)}%`);
    console.log(
      `  κ:               ${accuracy.kappa === null ? "undefined" : accuracy.kappa.toFixed(2)}`,
    );
  }

  console.log(`\n── run 1 against run 2 ─────────────────────────────────`);
  console.log(`  pairs compared:  ${stability.n}`);
  console.log(`  same band:       ${(stability.observed * 100).toFixed(0)}%`);
  console.log(`  within one band: ${(stability.withinOneBand * 100).toFixed(0)}%`);

  if (stabilityOnly) {
    console.log(`\n── verdict ─────────────────────────────────────────────`);
    const met = stability.n > 0 && stability.withinOneBand >= STABILITY_TARGET;
    console.log(
      met
        ? `  stability ${(stability.withinOneBand * 100).toFixed(0)}% within one band ≥ ${STABILITY_TARGET * 100}% — E8's consistency criterion is met.`
        : `  stability ${(stability.withinOneBand * 100).toFixed(0)}% within one band is under ${STABILITY_TARGET * 100}%. Two learners handing in the same work would be told different things.`,
    );
    // Said every time, because the danger of this mode is that a green line
    // above gets read as "E8 passes".
    console.log(
      `  κ was not measured. E8 also needs κ ≥ ${KAPPA_TARGET} against hand-grades,`,
    );
    console.log(`  and that number cannot come from this command.\n`);
    process.exit(met ? 0 : 1);
  }

  if (accuracy.disagreements.length > 0) {
    console.log(`\n── where you and it disagree, worst first ──────────────`);
    console.log(`  (read these: it is usually the rubric, not the grader)\n`);
    for (const d of accuracy.disagreements) {
      console.log(
        `  ${d.submissionId} · ${d.criterionId}: you said ${d.left}, it said ${d.right} (${d.distance} apart)`,
      );
    }
  }

  console.log(`\n── verdict ─────────────────────────────────────────────`);
  for (const line of verdict.lines) console.log(`  ${line}`);
  console.log("");

  // Non-zero on failure so this can sit in CI as §27 D21–25 asks.
  process.exit(verdict.passed ? 0 : 1);
}

void main();
