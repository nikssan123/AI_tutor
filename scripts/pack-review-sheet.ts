import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { allPacks, findPack } from "@/lib/content";
import { buildIndex, prerequisitesOf } from "@/lib/engine/graph";
import { toEngineGraph } from "@/lib/packs/validate";
import type { DomainPack } from "@/lib/packs/types";
import { handInLabel } from "@/lib/content/evidence";

/**
 * The pack read-through of §23's Phase 0, as one document per pack.
 *
 *   pnpm review:sheet                  # every pack
 *   pnpm review:sheet sql-data-analysis
 *
 * A pack is four YAML files and `quality.reviewedBy` is a claim that all of it
 * has been read. Reading it *as* four YAML files means jumping between an item
 * and the skill it assesses and the rubric that grades the project that targets
 * it, which is how a review turns into a skim.
 *
 * So this collates only what a human has to judge, in the order HUMAN-REVIEW.md
 * puts it, and deliberately leaves out everything `packs:validate` already
 * enforces — weights summing to 1, the graph being acyclic, every skill having
 * items. Time spent re-checking those is time not spent on the answer keys.
 *
 * Output goes to `review/`, which is gitignored: it is a working document you
 * tick through, and regenerating over your own ticks would be worse than
 * useless. The script refuses to overwrite unless you pass `--force`.
 */

const OUT_DIR = "review";

function heading(pack: DomainPack): string[] {
  const totalHours = pack.skills.reduce((sum, s) => sum + s.estimatedHours, 0);

  return [
    `# Review sheet — ${pack.name}`,
    "",
    `\`${pack.slug}\` · maturity **${pack.maturity}** · declared tier **${pack.evalTier}** · ${pack.workspace} workspace`,
    "",
    `${pack.skills.length} skills · ${pack.items.length} items · ${pack.rubrics.length} rubrics · ${pack.projects.length} projects · ~${totalHours}h total`,
    "",
    "> Setting `quality.reviewedBy` is a claim that you have read this end to end.",
    "> It is what puts the subject, its check and its briefs into the sitemap.",
    "",
    "> Everything `pnpm packs:validate` already enforces is deliberately absent",
    "> from this sheet: unique slugs, an acyclic graph, rubric weights summing to",
    "> 1, every skill having items, every reference resolving. Do not re-check it.",
    "",
    "---",
    "",
  ];
}

/** 1 — the check that silently corrupts everything downstream. */
function answerKeys(pack: DomainPack): string[] {
  const lines = [
    "## 1. Answer keys",
    "",
    "**Is the answer right?** A wrong key passes validation, looks fine on screen,",
    "and mis-assesses every learner who meets it — then feeds that error into BKT,",
    "the planner and the ledger. For multiple choice, also ask whether the wrong",
    "options are *plausibly* wrong: an obviously silly distractor inflates scores.",
    "",
  ];

  const bySkill = new Map<string, typeof pack.items>();
  for (const item of pack.items) {
    bySkill.set(item.skill, [...(bySkill.get(item.skill) ?? []), item]);
  }

  for (const skill of pack.skills) {
    const items = bySkill.get(skill.slug) ?? [];
    if (items.length === 0) continue;

    lines.push(`### ${skill.name} \`${skill.slug}\``, "");
    for (const item of items) {
      lines.push(`- [ ] **\`${item.slug}\`** · ${item.type} · difficulty ${item.difficulty}`);
      lines.push(`  - **Q:** ${oneLine(item.prompt)}`);

      const key = (item.answerKey ?? {}) as Record<string, unknown>;

      if (item.options && item.options.length > 0) {
        // `correct` is a zero-based index into `options` — see
        // `readableAnswerKey`. An off-by-one here marks the wrong answer right
        // for everyone and is completely invisible in the YAML, so the sheet
        // resolves it rather than printing the number.
        const correct = typeof key.correct === "number" ? key.correct : -1;
        item.options.forEach((option, i) => {
          lines.push(`    - ${i === correct ? "**✓**" : "✗"} ${oneLine(option)}`);
        });
        if (correct < 0 || correct >= item.options.length) {
          lines.push(`    - ⚠️ **no valid \`correct\` index** — nothing is marked right`);
        }
      }

      for (const [field, value] of Object.entries(key)) {
        if (field === "correct" && item.options) continue;
        lines.push(`  - **${field}:** ${oneLine(render(value))}`);
      }

      if (Object.keys(key).length === 0) {
        lines.push(`  - ⚠️ **no answer key** — nothing can mark this automatically`);
      }
    }
    lines.push("");
  }

  return lines;
}

/** 2 — the sentence the whole product means by "proof". */
function canDoStatements(pack: DomainPack): string[] {
  return [
    "## 2. Can-do statements",
    "",
    "This sentence is the bar. `/mastery` prints it as a claim and the check page",
    "calls it *the bar*. Anything you could not settle by looking at a piece of",
    'work needs rewriting — "understand joins" is not observable.',
    "",
    ...pack.skills.map(
      (s) => `- [ ] **${s.name}** — ${s.canDoStatement}`,
    ),
    "",
  ];
}

/** 3 — acyclic is not the same as right. */
function dependencyOrder(pack: DomainPack): string[] {
  const index = buildIndex(toEngineGraph(pack));
  const byName = new Map(pack.skills.map((s) => [s.slug, s.name]));

  const lines = [
    "## 3. Dependency order",
    "",
    "The graph is acyclic, which does not make it right. For each: **would",
    "learning the second before the first actually hurt?** Window functions before",
    "`GROUP BY` is acyclic and backwards.",
    "",
  ];

  for (const skill of pack.skills) {
    const hard = prerequisitesOf(index, skill.slug, "hard");
    if (hard.length === 0) continue;
    lines.push(
      `- [ ] **${skill.name}** needs ${hard
        .map((e) => `*${byName.get(e.fromSkillId) ?? e.fromSkillId}*`)
        .join(", ")}`,
    );
  }

  lines.push("");
  return lines;
}

/** 4 — where inconsistent grading comes from. */
function rubricBands(pack: DomainPack): string[] {
  const lines = [
    "## 4. Rubric bands",
    "",
    "Read the four bands of each criterion **as a row**, and ask: *could one piece",
    "of work honestly land in two of these?* Overlapping bands are where",
    "inconsistent grading comes from — and this is exactly the material the",
    "calibration in part B measures, so fixing it here is far cheaper.",
    "",
  ];

  for (const rubric of pack.rubrics) {
    lines.push(`### \`${rubric.slug}\``, "");
    for (const c of rubric.criteria) {
      lines.push(`- [ ] **${c.name}** \`${c.id}\` · weight ${c.weight}`);
      lines.push(`  - *${oneLine(c.description)}*`);
      lines.push(`  - **absent** — ${oneLine(c.bands.absent)}`);
      lines.push(`  - **developing** — ${oneLine(c.bands.developing)}`);
      lines.push(`  - **competent** — ${oneLine(c.bands.competent)}`);
      lines.push(`  - **strong** — ${oneLine(c.bands.strong)}`);
    }
    lines.push("");
  }

  return lines;
}

/** 5 — a brief whose work the rubric cannot judge is a dead end. */
function briefs(pack: DomainPack): string[] {
  const byName = new Map(pack.skills.map((s) => [s.slug, s.name]));

  const lines = [
    "## 5. Project briefs",
    "",
    "Can it be done in the stated time, and does it produce an artefact the rubric",
    "can actually be applied to? A brief that yields work the rubric cannot judge",
    "is a dead end the learner only finds after doing it.",
    "",
  ];

  for (const project of pack.projects) {
    lines.push(
      `- [ ] **${project.title}** \`${project.slug}\` · ~${project.estimatedMinutes} min · rubric \`${project.rubric}\` · ${handInLabel(project.evidence)}`,
    );
    lines.push(
      `  - targets: ${project.targetSkills.map((s) => byName.get(s) ?? s).join(", ")}`,
    );
    lines.push(`  - ${oneLine(project.brief)}`);
    for (const criterion of project.acceptanceCriteria) {
      lines.push(`    - ${oneLine(criterion)}`);
    }
  }

  lines.push("");
  return lines;
}

/** 6 — these drive the plan, the deadline warning and the pace maths. */
function hours(pack: DomainPack): string[] {
  const total = pack.skills.reduce((sum, s) => sum + s.estimatedHours, 0);

  return [
    "## 6. Hour estimates",
    "",
    `These drive the curriculum, the deadline warning, "~${Math.round(total)} hours" on`,
    "the subject card, and the pace maths on `/progress` and `/calendar`. They do",
    "not need to be right; they need to not be embarrassing.",
    "",
    ...pack.skills.map((s) => `- [ ] ${s.name} — ${s.estimatedHours}h`),
    "",
    `- [ ] **Total ~${Math.round(total)}h** — is that what you would tell someone?`,
    "",
  ];
}

function tier(pack: DomainPack): string[] {
  return [
    "## 7. The tier declaration",
    "",
    `This pack declares **tier ${pack.evalTier}**. The public site currently caps every`,
    "claim at tier 2 because nothing executes a learner's work, so this is not a",
    "learner-facing risk today — it becomes one the day the sandbox ships.",
    "",
    `- [ ] Could a ${pack.workspace} workspace genuinely support tier ${pack.evalTier}?`,
    "",
    "---",
    "",
    "## Then",
    "",
    "```yaml",
    "quality:",
    "  status: reviewed",
    "  reviewedBy: YOUR NAME",
    `  reviewedAt: "${new Date().toISOString().slice(0, 10)}"`,
    "```",
    "",
    "`pnpm packs:validate`, then `pnpm verify`, and the subject enters the sitemap.",
    "",
  ];
}

/** Keeps a multi-line YAML block from breaking the list it sits in. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** `answerKey` is `z.unknown()` and its shape varies by item type. */
function render(value: unknown): string {
  if (Array.isArray(value)) return value.map(render).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function sheetFor(pack: DomainPack): string {
  return [
    ...heading(pack),
    ...answerKeys(pack),
    ...canDoStatements(pack),
    ...dependencyOrder(pack),
    ...rubricBands(pack),
    ...briefs(pack),
    ...hours(pack),
    ...tier(pack),
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const slugs = args.filter((a) => !a.startsWith("--"));

  const packs =
    slugs.length > 0
      ? slugs.map((slug) => {
          const pack = findPack(slug);
          if (!pack) {
            console.error(`no pack "${slug}"`);
            process.exit(1);
          }
          return pack;
        })
      : allPacks();

  await mkdir(OUT_DIR, { recursive: true });

  for (const pack of packs) {
    const path = join(OUT_DIR, `${pack.slug}.md`);
    try {
      await writeFile(path, sheetFor(pack), { flag: force ? "w" : "wx" });
      console.log(`wrote ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        console.log(`skipped ${path} — already exists (--force to overwrite)`);
        continue;
      }
      throw error;
    }
  }
}

void main();
