import { createClient } from "@/db";
import { getAnthropic } from "@/lib/ai/client";
import { generatePack } from "@/lib/packs/generate";
import { agentRun } from "@/db/schema";
import { desc } from "drizzle-orm";
import { handInLabel } from "@/lib/content/evidence";

/**
 * A real pack generation against the real API.
 *
 * Not a test. Its job is the one a test cannot do: find out what the models
 * actually return for a subject nobody has curated, and what it costs. Pass 8
 * and pass 10 both found things this way that no test would have.
 *
 *   pnpm tsx scripts/pack-generate-probe.ts "conversational Japanese"
 */

async function main() {
  const subject = process.argv[2] ?? "Rust programming";
  const slug = process.argv[3] ?? subject.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");

  const { db, close } = createClient(url, 2);
  const startedAt = Date.now();

  try {
    const before = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .orderBy(desc(agentRun.createdAt))
      .limit(1);

    const outcome = await generatePack(
      { client: getAnthropic(), db, userId: null },
      { slug, subject, rawGoal: null },
    );

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n=== ${subject} → ${slug} ===`);
    console.log(`source: ${outcome.source}  attempts: ${outcome.attempts}  ${seconds}s`);

    if (outcome.pack) {
      const p = outcome.pack;
      const perSkill = new Map<string, number>();
      for (const i of p.items) perSkill.set(i.skill, (perSkill.get(i.skill) ?? 0) + 1);
      const mcq = p.items.filter((i) => i.type === "mcq").length;

      console.log(`name: ${p.name}  workspace: ${p.workspace}  tier: ${p.evalTier}`);
      console.log(
        `${p.skills.length} skills · ${p.dependencies.length} deps · ${p.items.length} items (${p.items.length - mcq} production / ${mcq} mcq) · ${p.rubrics.length} rubrics · ${p.projects.length} projects`,
      );
      console.log(`hours: ${p.skills.reduce((s, k) => s + k.estimatedHours, 0)}`);
      console.log("\nskills:");
      for (const s of p.skills) {
        console.log(
          `  ${s.slug} [${s.level}/t${s.evalTier}] ${perSkill.get(s.slug) ?? 0} items — ${s.canDoStatement}`,
        );
      }
      console.log("\ndependencies:");
      for (const d of p.dependencies) console.log(`  ${d.from} -> ${d.to}`);
      console.log("\nsample items:");
      for (const i of p.items.slice(0, 4)) {
        console.log(`  [${i.type} d=${i.difficulty}] ${i.prompt.slice(0, 140)}`);
        console.log(`     key: ${JSON.stringify(i.answerKey).slice(0, 160)}`);
      }
      console.log("\nprojects:");
      for (const pr of p.projects) {
        console.log(`  ${pr.title} (${handInLabel(pr.evidence)}, ${pr.estimatedMinutes}min) -> ${pr.rubric}`);
      }
      console.log("\nrubric criteria weights:");
      for (const r of p.rubrics) {
        const sum = r.criteria.reduce((s, c) => s + c.weight, 0);
        console.log(`  ${r.slug}: ${r.criteria.map((c) => c.weight).join(" + ")} = ${sum}`);
      }
      console.log("\nvalidator:", outcome.report?.passed ? "PASSED" : "FAILED");
      for (const issue of outcome.report?.issues ?? []) {
        console.log(`  [${issue.severity}] ${issue.check}: ${issue.message}`);
      }
    }

    if (outcome.dropped.length > 0) {
      console.log("\ndropped:");
      for (const d of outcome.dropped) console.log(`  - ${d}`);
    }
    if (outcome.reasons.length > 0) {
      console.log("\nreasons:");
      for (const r of outcome.reasons) console.log(`  - ${r}`);
    }

    // §14.8 — what it actually cost, read back off the ledger rather than guessed.
    const runs = await db
      .select()
      .from(agentRun)
      .orderBy(desc(agentRun.createdAt))
      .limit(40);
    const fresh = before[0] ? runs.slice(0, runs.findIndex((r) => r.id === before[0]!.id)) : runs;

    let cents = 0;
    console.log("\nagent runs:");
    for (const r of fresh) {
      cents += r.costCents ?? 0;
      console.log(
        `  ${r.agentName.padEnd(22)} v${r.promptVersion} ${r.model.padEnd(18)} ${r.status.padEnd(8)} ${(r.costCents ?? 0).toFixed(3)}c ${r.latencyMs}ms`,
      );
    }
    console.log(`\nTOTAL: ${fresh.length} calls, ${cents.toFixed(2)}c = $${(cents / 100).toFixed(3)}`);
  } finally {
    await close();
  }
}

void main();
