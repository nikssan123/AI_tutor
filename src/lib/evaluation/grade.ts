import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, type CallResult } from "@/lib/ai/call";
import { EvaluationDraft } from "@/lib/contracts/evaluation";
import type { PackProject, RubricCriterion } from "@/lib/packs/types";
import type { SubmittedImage } from "@/lib/submissions/images";

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
  /*
   * Version 3 as of §24 E8.5 phase 2: a criterion the rubric marks from the
   * photograph now points into the frame instead of quoting the write-up.
   *
   * Bumped rather than edited in place — as version 2 was — because
   * `promptVersion` is stamped on every `evaluation` row, and §21's calibration
   * set is only interpretable if two different prompts cannot share a number.
   * This one changes what a verdict is *made of*, so a κ measured across the
   * boundary would be measuring two graders at once.
   */
  name: "rubric_grader",
  version: 3,
  text: `You mark a piece of work against a rubric the learner read before they started.

You are given the brief they were set, the rubric, and what they handed in. You return a band for every criterion, and for each one the evidence it rests on — which for almost all of them is a quote from their own work, and the rubric says where the exceptions are.

**Quote their actual words.** Copy the span you are judging out of the submission, exactly as it appears. Not a paraphrase, not a description of it, not something you would expect to find. A separate step checks every quote against the submission and throws out any that is not there, so an invented quote does not soften a judgement — it deletes it.

This applies to \`absent\` too. If something is missing, quote the place it should have been: the function that does not validate, the paragraph where the recommendation should sit. There is nearly always text to point at.

Band definitions come from the rubric and only from the rubric. Do not invent a standard, and do not move one because the work is close — the learner read those descriptors before they started, and shifting them afterwards moves a goalpost they were shown.

Report every problem you find, with the band it affects. Do not decide something is too minor to mention and do not soften a band to be kind: a separate step decides what matters, and one that filters here has already lost the information.

Judge the work, never the person, and never what you imagine they understand. If it is not in what they handed in, it did not happen.

Write \`reasoning\` to the learner. One or two sentences saying why this band and not the one above it, in plain language, about their work.

**Some hand-ins come with photographs.** Where they do, the rubric says which criteria are judged from them: *the write-up*, *the photograph*, or *both*.

Look at the photographs for those criteria and let what you see decide the band. A seam described as pressed open that is visibly not pressed open is not a competent seam, whatever the method says.

For those criteria you also give a \`locator\`: which photograph, where in it to look, and what is visible there. Number the photographs the way they were given to you. Point at something someone else could find — "the seam allowance along the top edge", not "the composition". And put in \`observed\` what you actually saw, not what it means: "the fold is flat on the left and stands up from about halfway across" is an observation; "the seam is untidy" is the band.

Nothing can match a locator against the frame the way a quote is matched against the text, so only two things about it are checked: the photograph number has to be one you were given, and a criterion that owes a locator and gives none is thrown out. Both are the same rule as an invented quote — do not point at a frame that is not there. What you say you saw is not checked at all, which is why it goes to the learner as our account of the frame rather than as a fact about it: write it so they can look and disagree.

**Which of the two you owe depends on the criterion, and giving the wrong one deletes it:**

- *judged from the write-up* — a quote, and no locator.
- *judged from the photographs* — a locator, and no quote. Do not go looking for a sentence to anchor it to. A quote that supports nothing but happens to appear in the text is worse than none, because the check passes and the band rests on air.
- *judged from the photographs and the write-up* — both. Quote the sentence the photograph confirms or contradicts; if the write-up claims nothing about it, quote the place the claim should have been, exactly as you would for anything else that is missing.`,
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
              "A span copied verbatim from the submission. Checked against it. Required for a criterion judged from the write-up or from both; leave it out for one judged from the photographs alone.",
          },
          locator: {
            type: "object",
            description:
              "Where in the photographs the band came from. Required for a criterion judged from the photographs or from both; leave it out otherwise.",
            properties: {
              photograph: {
                type: "integer",
                description:
                  "Which photograph, numbered as they were given to you, from 1.",
              },
              where: {
                type: "string",
                description:
                  "Where in that photograph to look, so someone else could find it.",
              },
              observed: {
                type: "string",
                description: "What is visible there. The observation, not the band.",
              },
            },
            required: ["photograph", "where", "observed"],
            additionalProperties: false,
          },
          reasoning: {
            type: "string",
            description: "Why this band and not the one above, to the learner.",
          },
        },
        /*
         * Neither `evidence` nor `locator` is required here, because which one a
         * criterion owes is a fact about the rubric and a tool schema cannot say
         * "this field when that value". `verify` enforces it per criterion off
         * `marks`, which is the same division of labour as everywhere else in
         * this pipeline: the schema is permissive, the deterministic step is not.
         */
        required: ["criterionId", "band", "reasoning"],
        additionalProperties: false,
      },
    },
    /*
     * No `maxItems` on any of the three, on purpose. The prompt above asks for
     * every problem found and says not to self-filter, and a cap here would be
     * the same instruction reversed one screen later. The learner is shown the
     * most important few; the ordering is what makes that safe, so the ordering
     * is what is asked for.
     */
    strengths: {
      type: "array",
      items: { type: "string" },
      description: "Ordered by how much each one matters. The strongest first.",
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description:
        "Ordered by how much each one matters. List everything you found; the most important few are what the learner is shown.",
    },
    nextActions: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete things to do, not encouragement. Ordered by how much each one matters, most worth doing first.",
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
   * The photographs handed in with it, already checked by `acceptImages`.
   *
   * Optional rather than an empty array by default because most briefs take
   * none, and `CallSpec.user` already accepts content blocks — this is the one
   * place in E8.5 where the existing design paid off with no change at all.
   */
  images?: SubmittedImage[];
  /**
   * §14.5 step 4 — the second pass is the same rubric under a different
   * framing, so a band that only survives one framing shows up as spread.
   */
  framing?: "primary" | "second-pass";
}

/** How each `marks` value reads to the grader, in the rubric it is given. */
const JUDGED_FROM: Record<RubricCriterion["marks"], string> = {
  text: "judged from the write-up",
  image: "judged from the photographs",
  both: "judged from the photographs and the write-up",
};

/** The rubric, rendered so every band descriptor is in front of the model. */
export function renderRubric(criteria: RubricCriterion[]): string {
  return criteria
    .map((c) =>
      [
        `${c.id} — ${c.name} (weight ${c.weight}, ${JUDGED_FROM[c.marks]})`,
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
  const count = input.images?.length ?? 0;

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
    // Said even when there are none, and only when the rubric expects some: a
    // criterion judged from a photograph that did not arrive has to be marked
    // as unevidenced rather than guessed at from the prose around it.
    //
    // The second sentence is what stops the collapse phase 2 could otherwise
    // cause: a locator is checked against the frames in hand, so one invented
    // for a hand-in with no frames throws its criterion out — and on a rubric
    // where every criterion reads both halves, that is the whole rubric.
    count === 0 && input.criteria.some((c) => c.marks !== "text")
      ? "They handed in no photographs, so anything judged from one has not been shown to you. Give no locator at all: there is no frame to point at, and a criterion judged from both halves is decided on the write-up alone this time."
      : "",
    "What they handed in:",
    "---",
    input.artefact,
    "---",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * The user turn: the photographs, each announced, then everything else.
 *
 * Images first and numbered, which is what the API's own guidance asks for with
 * more than one — an unlabelled run of frames cannot be referred to in
 * `reasoning`, and "the third one" is most of what there is to say about a set.
 */
export function buildGradeTurn(
  input: GradeInput,
): Anthropic.ContentBlockParam[] | string {
  const images = input.images ?? [];
  if (images.length === 0) return buildGradeContext(input);

  return [
    ...images.flatMap((image, i): Anthropic.ContentBlockParam[] => [
      {
        type: "text",
        text:
          images.length === 1
            ? "The photograph they handed in:"
            : `Photograph ${i + 1} of ${images.length}:`,
      },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: image.mediaType,
          data: image.data,
        },
      },
    ]),
    { type: "text", text: buildGradeContext(input) },
  ];
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
    user: buildGradeTurn(input),
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
