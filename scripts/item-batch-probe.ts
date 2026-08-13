import { getAnthropic } from "@/lib/ai/client";
import { generateItems } from "@/lib/packs/generate/items";
import { skillRef } from "@/lib/packs/generate/derive";
import type { DraftSkill } from "@/lib/contracts/pack";

/**
 * One item batch against the real API.
 *
 * Kept because it is the cheapest way to answer the question that cost two full
 * generations: does the item author actually quote the skill reference back, or
 * does it echo something else? One call, a few cents.
 */

const SKILLS: DraftSkill[] = [
  {
    name: "Build and run a Cargo project",
    description: "Create, build and run a Rust project with Cargo.",
    level: "foundational",
    area: "tooling",
    estimatedHours: 3,
    canDoStatement: "Create a Cargo project and run it with a passing test.",
    observableEvidence: ["a repo that builds"],
    prerequisites: [],
    selfReportOnly: false,
  },
  {
    name: "Handle errors with Result, Option, and ?",
    description: "Rust's error handling with Result, Option and the ? operator.",
    level: "core",
    area: "tooling",
    estimatedHours: 8,
    canDoStatement: "Propagate errors with ? and handle both variants explicitly.",
    observableEvidence: ["a function returning Result"],
    prerequisites: ["Build and run a Cargo project"],
    selfReportOnly: false,
  },
];

async function main() {
  const skills = SKILLS.map((skill, i) => ({ ref: skillRef(i), skill }));

  const result = await generateItems(getAnthropic(), {
    subject: "Rust programming",
    skills,
  });

  console.log("status:", result.status, "cost:", result.costCents?.toFixed(3), "c");
  if (result.status !== "ok") {
    console.log("detail:", (result as { detail: string }).detail);
    return;
  }

  const valid = new Set(skills.map((s) => s.ref));
  const counts = new Map<string, number>();
  for (const i of result.value.items) {
    counts.set(i.skill, (counts.get(i.skill) ?? 0) + 1);
  }

  console.log("items:", result.value.items.length);
  for (const [ref, n] of counts) {
    console.log(`  ${valid.has(ref) ? "RESOLVES" : "UNRESOLVABLE"} "${ref}" × ${n}`);
  }
}

void main();
