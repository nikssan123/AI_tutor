import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, type CallResult } from "@/lib/ai/call";
import { CurriculumDraft } from "@/lib/contracts/curriculum";
import {
  CURRICULUM_MASTERED_THRESHOLD,
  MIN_RUBRIC_CRITERIA,
  type SpotChecker,
  type ValidationInput,
} from "./validate";
import type { EngineSkillGraph, MasteryState } from "@/lib/engine";
import { effectiveMastery } from "@/lib/engine/bkt";

/**
 * §24 E6 — the Curriculum Architect, and the factual spot-check that audits it.
 *
 * §14.9.6 requires prompts to be files in git loaded by `(name, version)`, with
 * the version recorded on every `AgentRun`. They are module constants here
 * rather than rows in a table, which is the same guarantee with a diff attached:
 * a prompt change is a reviewable commit, and no one can hot-edit production
 * behaviour from an admin screen.
 */

export const ARCHITECT_PROMPT = {
  name: "curriculum_architect",
  version: 1,
  text: `You design a learning curriculum from a skill graph.

You receive a pack's skill graph, what the learner has already demonstrated, and their real time budget. You return an ordered list of modules through a tool call.

What makes a curriculum good here:

- It teaches towards the goal skills and stops. Coverage of the pack is not the objective.
- It never teaches something the learner has already demonstrated. That is the product's central promise to them.
- Every module's hard prerequisites come earlier in the path, or the learner already holds them. A module may bundle a skill with its own prerequisite.
- Difficulty rises. It does not step back down, and it does not jump more than two levels at once.
- Total hours fit the stated budget. If the goal does not fit the budget, build the curriculum that does fit and say so in the rationale — do not compress twenty hours of work into a ten-hour path and call it done.
- Each module targets one to three skills and names what the learner will produce. A module whose output is a project must carry a rubric id from the pack.

Write acceptance criteria a learner can check themselves against. "Understand joins" is not one; "write a three-table join and explain why the row count changed" is.

A separate validator checks this curriculum against the graph before anyone sees it, so report what you actually built. If you had to leave something out, put that in the rationale rather than quietly dropping it.`,
} as const;

export const SPOTCHECK_PROMPT = {
  name: "curriculum_factual_spotcheck",
  version: 1,
  text: `You are auditing a generated learning curriculum for factual problems.

Identify anything factually wrong, outdated, or misleading: claims about how a technology behaves, ordering that contradicts how the subject actually works, acceptance criteria that cannot be met as written, or hours estimates that are not credible for the work described.

Report every issue you find, including ones you are uncertain about or consider minor. Do not filter for importance — a separate step decides what matters. For each issue, name the module and quote the text you are objecting to.

If you find nothing, say so plainly rather than inventing a concern.`,
} as const;

/**
 * The tool schema the model is steered by.
 *
 * Written by hand rather than generated from the Zod contract, because
 * structured outputs reject most of what the contract asserts — array bounds,
 * string lengths, numeric floors. Those live in `CurriculumDraft.safeParse`
 * below, which is what actually decides whether a draft is usable. The schema's
 * job is to shape the call; the contract's job is to refuse a bad one.
 */
export const CURRICULUM_TOOL_SCHEMA = {
  type: "object",
  properties: {
    modules: {
      type: "array",
      description: "Modules in teaching order, 3 to 40 of them.",
      items: {
        type: "object",
        properties: {
          order: { type: "integer", description: "0-based position in the path." },
          title: { type: "string" },
          targetSkillIds: {
            type: "array",
            items: { type: "string" },
            description:
              "1 to 3 skill slugs, each of which must exist in the supplied graph.",
          },
          estimatedHours: { type: "number" },
          outputArtifact: {
            type: "string",
            enum: ["none", "exercise", "project", "recording", "document", "media"],
          },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" },
            description: "Checkable statements, not learning objectives.",
          },
          rubricId: {
            type: ["string", "null"],
            description: `Required when outputArtifact is "project"; must name a pack rubric with at least ${MIN_RUBRIC_CRITERIA} criteria.`,
          },
        },
        required: [
          "order",
          "title",
          "targetSkillIds",
          "estimatedHours",
          "outputArtifact",
          "acceptanceCriteria",
          "rubricId",
        ],
        additionalProperties: false,
      },
    },
    totalHours: { type: "number" },
    rationale: {
      type: "string",
      description:
        "Why this path, and anything you had to leave out to fit the budget.",
    },
  },
  required: ["modules", "totalHours", "rationale"],
  additionalProperties: false,
} as const;

export interface ArchitectInput {
  graph: EngineSkillGraph;
  goalSkillIds: string[];
  mastery: MasteryState[];
  now: string;
  constraints: { weeklyHours: number; deadline: string | null };
  /** Criterion count per rubric id, so the model can only cite real rubrics. */
  rubricCriteria: Map<string, number>;
  rawGoal: string;
}

/**
 * The volatile half of the prompt — everything that varies per learner, and so
 * everything that must sit after the cache breakpoint (§14.9.4).
 *
 * Keys are written in a fixed order rather than serialised from an object, so
 * two learners with the same state produce the same bytes.
 */
export function buildArchitectContext(input: ArchitectInput): string {
  const effective = new Map(
    input.mastery.map((m) => [m.skillId, effectiveMastery(m, input.now)]),
  );

  const skills = input.graph.skills
    .map((s) => {
      const held = effective.get(s.id) ?? 0;
      const prereqs = input.graph.dependencies
        .filter((d) => d.toSkillId === s.id && d.type === "hard")
        .map((d) => d.fromSkillId);

      return [
        `- ${s.id} (${s.level}, ~${s.estimatedHours}h)`,
        `  can do: ${s.canDoStatement}`,
        prereqs.length > 0 ? `  needs first: ${prereqs.join(", ")}` : null,
        held > CURRICULUM_MASTERED_THRESHOLD
          ? `  ALREADY DEMONSTRATED (${held.toFixed(2)}) — do not teach this`
          : held > 0
            ? `  partially held (${held.toFixed(2)})`
            : null,
      ]
        .filter((line) => line !== null)
        .join("\n");
    })
    .join("\n");

  const rubrics = [...input.rubricCriteria.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, count]) => `- ${id} (${count} criteria)`)
    .join("\n");

  return [
    `Learner's goal, in their words: ${input.rawGoal}`,
    "",
    `Time budget: ${input.constraints.weeklyHours} hours per week.`,
    `Deadline: ${input.constraints.deadline ?? "none"}.`,
    `Today: ${input.now.slice(0, 10)}.`,
    "",
    `Skills the goal requires: ${input.goalSkillIds.join(", ")}`,
    "",
    "Skill graph:",
    skills,
    "",
    "Rubrics available for project modules:",
    rubrics.length > 0 ? rubrics : "- none",
  ].join("\n");
}

export async function generateCurriculum(
  client: Anthropic,
  input: ArchitectInput,
  options: { degraded?: boolean } = {},
): Promise<CallResult<CurriculumDraft>> {
  return callStructured(client, {
    step: "curriculumArchitect",
    prompt: ARCHITECT_PROMPT,
    system: ARCHITECT_PROMPT.text,
    user: buildArchitectContext(input),
    tool: {
      name: "submit_curriculum",
      description: "Submit the ordered curriculum you designed.",
      inputSchema: CURRICULUM_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = CurriculumDraft.safeParse(raw);
      return result.success
        ? { ok: true, value: result.data }
        : { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    },
    degraded: options.degraded ?? false,
  });
}

/**
 * §14.6 check 9 — the adversarial pass, on the deep tier.
 *
 * Its verdict is advisory by construction: the check it feeds is a warning
 * whose fail action is the human review queue, because a model that missed a
 * factual error on the first pass is not the thing to trust with fixing it on
 * the second.
 */
export function factualSpotChecker(client: Anthropic): SpotChecker {
  return async (input: ValidationInput) => {
    const modules = input.draft.modules
      .map(
        (m) =>
          `Module ${m.order}: ${m.title}\n  skills: ${m.targetSkillIds.join(", ")}\n  hours: ${m.estimatedHours}\n  criteria: ${m.acceptanceCriteria.join(" | ")}`,
      )
      .join("\n");

    const result = await callStructured<{ issues: string[] }>(client, {
      step: "curriculumValidator",
      prompt: SPOTCHECK_PROMPT,
      system: SPOTCHECK_PROMPT.text,
      user: `Curriculum rationale: ${input.draft.rationale}\n\n${modules}`,
      tool: {
        name: "report_issues",
        description: "Report every factual problem found, or an empty list.",
        inputSchema: {
          type: "object",
          properties: {
            issues: {
              type: "array",
              items: { type: "string" },
              description:
                "One entry per problem, naming the module and quoting the text.",
            },
          },
          required: ["issues"],
          additionalProperties: false,
        },
      },
      parse: (raw) => {
        const issues = (raw as { issues?: unknown }).issues;
        return Array.isArray(issues) && issues.every((i) => typeof i === "string")
          ? { ok: true, value: { issues } }
          : { ok: false, error: "issues must be an array of strings" };
      },
    });

    if (result.status !== "ok") {
      // A spot-check that could not run is not a spot-check that passed. It is
      // reported as failing so the curriculum lands in review rather than
      // sailing through on a silent error.
      return {
        passed: false,
        detail: `The factual spot-check did not complete (${result.status}): ${result.detail}`,
      };
    }

    return {
      passed: result.value.issues.length === 0,
      detail:
        result.value.issues.length === 0
          ? "No factual problems found."
          : result.value.issues.join(" · "),
    };
  };
}
