import { getAnthropic } from "@/lib/ai/client";
import { createClient } from "@/db";
import { findPack } from "@/lib/content";
import { evaluateSubmission } from "@/lib/evaluation";

/**
 * A real submission graded against a real published rubric.
 *
 * The question a test cannot answer: does the grader actually quote the work,
 * and does the verifier hold when it does not? Two submissions are graded — one
 * genuine attempt and one that is confidently wrong — because a marker that
 * cannot tell them apart is worse than none.
 *
 *   pnpm tsx scripts/evaluate-probe.ts
 */

const GOOD = `# Weekly revenue by segment

SELECT
  c.segment,
  date_trunc('week', o.placed_at) AS week,
  SUM(oi.quantity * oi.unit_price) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'completed'
  AND o.placed_at >= now() - interval '12 weeks'
GROUP BY c.segment, date_trunc('week', o.placed_at)
ORDER BY week DESC, revenue DESC;

I joined order_items last on purpose. Joining it before aggregating is what
inflates the totals: one order with three lines becomes three rows, and summing
o.total across them triple-counts the order. Because I aggregate the line items
themselves rather than the order total, the grain stays one row per
(segment, week) and the revenue figure is the sum of actual line values.

I checked this by running the same query without the GROUP BY and counting rows
per order — 1,204 orders produced 3,891 item rows, and SUM(o.total) over that
set came out at 3.2x the true figure. That is the mistake this avoids.`;

const BAD = `SELECT * FROM orders;

This gets all the orders which is what we need for the revenue report. I think
the segments are in there too. The totals should be right because the database
has the correct data in it. I understand joins and grain very well and would
use them properly in a production setting.`;

async function main() {
  const pack = findPack("sql-data-analysis")!;
  const project = pack.projects[0]!;
  const rubric = pack.rubrics.find((r) => r.slug === project.rubric)!;
  const skill = pack.skills.find((s) => project.targetSkills.includes(s.slug))!;

  const { db, close } = createClient(process.env.DATABASE_URL!, 2);

  console.log(`brief: ${project.title}`);
  console.log(`rubric: ${rubric.slug} (${rubric.criteria.length} criteria)`);
  console.log(`skill tier: ${skill.evalTier}\n`);

  for (const [label, artefact] of [
    ["A GENUINE ATTEMPT", GOOD],
    ["CONFIDENT NONSENSE", BAD],
  ] as const) {
    const started = Date.now();
    const outcome = await evaluateSubmission(
      { client: getAnthropic(), db, userId: null },
      {
        project,
        criteria: rubric.criteria,
        skillTier: skill.evalTier,
        artefact,
      },
    );

    console.log(`── ${label} ─────────────────────────────`);
    if (!outcome.result) {
      console.log(`refused: ${outcome.reason}\n`);
      continue;
    }

    const r = outcome.result;
    console.log(
      `score ${(r.overall * 100).toFixed(0)}% · confidence ${r.confidence.toFixed(2)} · tier ${r.evalTier} · spread ${r.bandSpread} bands · ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
    console.log(
      `verifier: ${r.verification.passed ? "PASSED" : "FAILED"} · ${r.verification.upheld.length} upheld · ${r.verification.invalidated.length} thrown out · ${r.verification.missing.length} missing`,
    );
    for (const bad of r.verification.invalidated) {
      console.log(`   ✗ ${bad.criterionId}: ${bad.reason}`);
    }
    console.log(
      `mastery: correct=${r.observation.correct} weight=${r.observation.confidence.toFixed(2)} · human review: ${r.humanReview}`,
    );

    for (const c of r.criteria) {
      console.log(`  [${c.band}] ${c.name}`);
      console.log(
        c.evidence
          ? `     quote: "${c.evidence.slice(0, 90).replace(/\n/g, " ")}…"`
          : `     photo ${c.locator?.photograph}: ${c.locator?.observed.slice(0, 80)}`,
      );
      console.log(`     why:   ${c.reasoning.slice(0, 140)}`);
    }
    console.log(`  gaps: ${r.gaps.slice(0, 3).join(" | ")}\n`);
  }

  await close();
}

void main();
