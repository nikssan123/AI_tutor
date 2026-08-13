import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callStructured, type CallResult } from "@/lib/ai/call";
import type { EvalTier } from "@/lib/engine";

/**
 * §14.2 — "Assessment Agent: Haiku 4.5 *only* to grade free-text."
 *
 * This grades one written answer to one recall question. It is the smallest
 * model call in the product and the one that decides whether a session moves
 * mastery at all, so two rules are enforced here rather than asked for:
 *
 * **A written answer is never Tier 1 evidence.** Tier 1's claim is "verified:
 * this works", and it is earned by executing something. Explaining a join in
 * prose is not running one. So the evidence tier for a graded answer is at best
 * 2, and never better than the skill's own tier — a Tier 3 photography skill
 * stays Tier 3 whatever the learner writes about it (§7.2).
 *
 * **A grader that could not run did not pass.** A failed call returns an
 * ungraded outcome, and the session says so. Recording an unreachable model as
 * a correct answer would put mastery on the board with no evidence under it,
 * which is §4.2 law 1 exactly.
 */

export const GRADER_PROMPT = {
  name: "check_grader",
  // v2: v1 marked a correct written explanation wrong because the expectation
  // handed to it is a can-do statement, so it asked a two-minute recall answer
  // to demonstrate the skill. Found on a live call, not in a test.
  version: 2,
  text: `You mark one short answer to one recall question.

You are given the question, the skill it is checking, and what the learner wrote from memory. You return your marking through a tool call.

**They are writing about the skill, not performing it.** The skill is phrased as something they can do — "join three tables at the correct grain", "light a portrait without a flash" — and this is a two-minute written question, not the work itself. Mark whether the answer shows they understand what doing it involves. Do not ask for a demonstration, a full example, or output they were never given the tools to produce here.

How to mark:

- Mark what the answer says, not how it is written. Spelling, grammar, phrasing and length are irrelevant. A correct answer in four words is correct.
- Correct means the answer shows they know the thing the question was about. Partially right is not right — say what is missing instead.
- An answer that is right for a different question is not right.
- Quote the learner's own words in the feedback where you can. Feedback that could have been written without reading the answer is not feedback.
- If the answer reveals a specific wrong belief — not just a gap, but a mistaken model of how something works — name it in one short phrase. That is what gets tracked and revisited. If it is just an incomplete answer, there is no misconception.
- Blank, off-topic, or "I don't know" is not correct, and the feedback should say what the answer needed to contain.

Feedback is one or two sentences, addressed to the learner, and never opens by restating the question.`,
} as const;

export const GRADE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    correct: {
      type: "boolean",
      description: "Whether the answer establishes what the question asked for.",
    },
    feedback: {
      type: "string",
      description: "One or two sentences to the learner, quoting their words.",
    },
    misconception: {
      type: ["string", "null"],
      description:
        "A specific wrong belief the answer reveals, or null if the answer is merely incomplete.",
    },
  },
  required: ["correct", "feedback", "misconception"],
  additionalProperties: false,
} as const;

export const CheckGrade = z.object({
  correct: z.boolean(),
  feedback: z.string().min(1).max(2_000),
  misconception: z.string().max(300).nullable(),
});
export type CheckGrade = z.infer<typeof CheckGrade>;

export interface GradeRequest {
  question: string;
  expected: string;
  answer: string;
}

/**
 * §7.2, as arithmetic. A written answer caps out at Tier 2, and a skill whose
 * own tier is weaker than that keeps its own tier — evidence cannot be stronger
 * than the domain allows.
 */
export const WRITTEN_ANSWER_TIER = 2;

export function evidenceTierFor(skillTier: EvalTier): EvalTier {
  return Math.max(WRITTEN_ANSWER_TIER, skillTier) as EvalTier;
}

/**
 * §16.2's `c`. A recall question is production, but small production: it moves
 * the belief, and it does not move it as far as an evaluated artefact would.
 */
export const CHECK_CONFIDENCE = 0.45;

export async function gradeCheck(
  client: Anthropic,
  request: GradeRequest,
): Promise<CallResult<CheckGrade>> {
  return callStructured(client, {
    step: "checkGrader",
    prompt: GRADER_PROMPT,
    system: GRADER_PROMPT.text,
    user: [
      `Question: ${request.question}`,
      `The skill being checked: ${request.expected}`,
      "",
      "The learner wrote, from memory:",
      request.answer,
    ].join("\n"),
    tool: {
      name: "submit_grade",
      description: "Submit your marking of this answer.",
      inputSchema: GRADE_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = CheckGrade.safeParse(raw);
      return result.success
        ? { ok: true, value: result.data }
        : {
            ok: false,
            error: result.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          };
    },
    maxTokens: 1_000,
  });
}
