import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, type CallResult } from "@/lib/ai/call";
import { EvaluationDraft } from "@/lib/contracts/evaluation";
import type { PackProject, RubricCriterion } from "@/lib/packs/types";

/**
 * §14.5 step 3 — rubric grading. "The most important component."
 *
 * Three of §14.5's non-negotiable rules are visible in this file, and the
 * fourth is enforced downstream:
 *
 * - **Never grade without the rubric in the prompt.** The whole rubric, bands
 *   and all, goes in — [an LLM given only a problem and a solution grades
 *   markedly worse than one given the rubric](https://dl.acm.org/doi/10.1145/3702652.3744220).
 * - **Every criterion must quote the artefact.** Asked for here, checked for
 *   real in `verify.ts`, which is what makes it true rather than requested.
 * - **Report everything; do not self-filter.** Conservative-reporting
 *   instructions measurably depress recall, so the prompt says the opposite and
 *   a later deterministic step decides what matters.
 * - Deterministic checks outranking the model is the fourth, and it belongs to
 *   the pipeline rather than to the prompt.
 */

export const GRADER_PROMPT = {
  name: "rubric_grader",
  version: 1,
  text: `You mark a piece of work against a rubric the learner read before they started.

You are given the brief they were set, the rubric, and what they handed in. You return a band for every criterion, and for each one a quote from their work that shows why.

**Quote their actual words.** Copy the span you are judging out of the submission, exactly as it appears. Not a paraphrase, not a description of it, not something you would expect to find. A separate step checks every quote against the submission and throws out any that is not there, so an invented quote does not soften a judgement — it deletes it.

This applies to \`absent\` too. If something is missing, quote the place it should have been: the function that does not validate, the paragraph where the recommendation should sit. There is nearly always text to point at.

Band definitions come from the rubric and only from the rubric. Do not invent a standard, and do not move one because the work is close — the learner read those descriptors before they started, and shifting them afterwards moves a goalpost they were shown.

Report every problem you find, with the band it affects. Do not decide something is too minor to mention and do not soften a band to be kind: a separate step decides what matters, and one that filters here has already lost the information.

Judge the work, never the person, and never what you imagine they understand. If it is not in what they handed in, it did not happen.

Write \`reasoning\` to the learner. One or two sentences saying why this band and not the one above it, in plain language, about their work.`,
} as const;

export const GRADER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    criteria: {
      type: "array",
      description: "One entry per rubric criterion. Every criterion, every time.",
      items: {
        type: "object",
        properties: {
          criterionId: {
            type: "string",
            description: "The criterion's id, exactly as given in the rubric.",
          },
          band: {
            type: "string",
            enum: ["absent", "developing", "competent", "strong"],
          },
          evidence: {
            type: "string",
            description:
              "A span copied verbatim from the submission. Checked against it.",
          },
          reasoning: {
            type: "string",
            description: "Why this band and not the one above, to the learner.",
          },
        },
        required: ["criterionId", "band", "evidence", "reasoning"],
        additionalProperties: false,
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "Ordered by how much each one matters.",
    },
    nextActions: {
      type: "array",
      items: { type: "string" },
      description: "Concrete things to do, not encouragement.",
    },
  },
  required: ["criteria", "strengths", "gaps", "nextActions"],
  additionalProperties: false,
} as const;

export interface GradeInput {
  project: Pick<PackProject, "title" | "brief" | "acceptanceCriteria">;
  criteria: RubricCriterion[];
  /** The submitted work, already normalised and size-capped by the ingest step. */
  artefact: string;
  /**
   * §14.5 step 4 — the second pass is the same rubric under a different
   * framing, so a band that only survives one framing shows up as spread.
   */
  framing?: "primary" | "second-pass";
}

/** The rubric, rendered so every band descriptor is in front of the model. */
export function renderRubric(criteria: RubricCriterion[]): string {
  return criteria
    .map((c) =>
      [
        `${c.id} — ${c.name} (weight ${c.weight})`,
        `  ${c.description}`,
        `  absent: ${c.bands.absent}`,
        `  developing: ${c.bands.developing}`,
        `  competent: ${c.bands.competent}`,
        `  strong: ${c.bands.strong}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function buildGradeContext(input: GradeInput): string {
  return [
    `The brief they were set: ${input.project.title}`,
    input.project.brief,
    "",
    "They were told it is finished when:",
    input.project.acceptanceCriteria.map((c) => `- ${c}`).join("\n"),
    "",
    "Rubric:",
    renderRubric(input.criteria),
    "",
    input.framing === "second-pass"
      ? "Work through the criteria in reverse order, and settle each band from its descriptor before you look at the others."
      : "",
    "What they handed in:",
    "---",
    input.artefact,
    "---",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function gradeSubmission(
  client: Anthropic,
  input: GradeInput,
  options: { degraded?: boolean } = {},
): Promise<CallResult<EvaluationDraft>> {
  return callStructured(client, {
    // §14.9.3 routes this to the deep tier, and §14.5 is why: this is the one
    // call whose output the learner is asked to believe about their own work.
    step: "rubricGrader",
    prompt: GRADER_PROMPT,
    system: GRADER_PROMPT.text,
    user: buildGradeContext(input),
    tool: {
      name: "submit_marks",
      description: "Submit a band and quoted evidence for every criterion.",
      inputSchema: GRADER_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = EvaluationDraft.safeParse(raw);
      return result.success
        ? { ok: true, value: result.data }
        : {
            ok: false,
            error: result.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          };
    },
    degraded: options.degraded ?? false,
  });
}
