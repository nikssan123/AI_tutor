import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { getAnthropic } from "@/lib/ai/client";
import { createClient } from "@/db";
import { findPack } from "@/lib/content";
import { evaluateSubmission } from "@/lib/evaluation";
import {
  agreementBetween,
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
    /** Your hand-grades: criterion id → band. */
    grades: Record<string, Band>;
  }>;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const path = process.argv[2];
  if (!path) fail("usage: pnpm calibrate <corpus.yaml>");

  const corpus = parse(await readFile(path, "utf8")) as Corpus;

  const pack = findPack(corpus.pack);
  if (!pack) fail(`no pack "${corpus.pack}"`);

  const project = pack.projects.find((p) => p.slug === corpus.project);
  if (!project) fail(`no project "${corpus.project}" in ${pack.slug}`);

  const rubric = pack.rubrics.find((r) => r.slug === project.rubric)!;
  const skill = pack.skills.find((s) => project.targetSkills.includes(s.slug))!;
  const criterionIds = new Set(rubric.criteria.map((c) => c.id));

  // Checked before spending anything: a typo'd criterion id silently drops a
  // judgement, and a corpus that quietly measures 12 pairs instead of 20 is
  // worse than one that refuses to run.
  for (const submission of corpus.submissions) {
    const graded = Object.keys(submission.grades);
    for (const id of graded) {
      if (!criterionIds.has(id)) {
        fail(`submission "${submission.id}" grades unknown criterion "${id}"`);
      }
    }
    const missing = [...criterionIds].filter((id) => !graded.includes(id));
    if (missing.length > 0) {
      fail(
        `submission "${submission.id}" is missing grades for: ${missing.join(", ")}`,
      );
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

  const human: Judgement[] = [];
  const first: Judgement[] = [];
  const second: Judgement[] = [];

  try {
    for (const submission of corpus.submissions) {
      for (const [criterionId, band] of Object.entries(submission.grades)) {
        human.push({ submissionId: submission.id, criterionId, band });
      }

      for (const [pass, sink] of [
        [1, first],
        [2, second],
      ] as const) {
        const started = Date.now();
        const outcome = await evaluateSubmission(
          { client, db, userId: null },
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

  console.log(`\n── agreement with your grades ──────────────────────────`);
  console.log(`  pairs compared:  ${accuracy.n}`);
  console.log(`  same band:       ${(accuracy.observed * 100).toFixed(0)}%`);
  console.log(`  within one band: ${(accuracy.withinOneBand * 100).toFixed(0)}%`);
  console.log(`  by chance:       ${(accuracy.expected * 100).toFixed(0)}%`);
  console.log(
    `  κ:               ${accuracy.kappa === null ? "undefined" : accuracy.kappa.toFixed(2)}`,
  );

  console.log(`\n── run 1 against run 2 ─────────────────────────────────`);
  console.log(`  within one band: ${(stability.withinOneBand * 100).toFixed(0)}%`);

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
