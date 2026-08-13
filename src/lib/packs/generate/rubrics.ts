import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, type CallResult } from "@/lib/ai/call";
import {
  MIN_RUBRIC_CRITERIA,
  RubricsDraft,
  type DraftSkill,
} from "@/lib/contracts/pack";

/**
 * Rubrics and the project briefs they grade.
 *
 * §4.2 law 2 — "every rubric is public before the work is done" — is the
 * product's strongest claim, and it is the part of a generated pack that has to
 * hold up: a brief whose rubric is vague grades nothing, and the learner finds
 * out only after doing the work.
 *
 * Weights are not asked for. The model gives relative importance and
 * `normaliseWeights` divides, because `validatePack` blocks a rubric whose
 * weights miss 1 by more than 0.001 and no model reliably hits that.
 */

export const PACK_RUBRICS_PROMPT = {
  name: "pack_rubric_author",
  version: 1,
  text: `You write the graded projects for a subject, and the rubrics they are marked against.

You are given a subject and its skills. You return a small number of projects — real pieces of work someone would actually produce — and a rubric for each.

The project brief is a commission, not an exercise. It says what to make, for whom, and what constraints apply. Someone should be able to read it and start work without asking a question.

The rubric is published to the learner *before* they start, so it has to be something they can steer by:

- Each criterion names one thing being judged, and the four bands say what absent, developing, competent and strong actually look like for it. Write the bands so two different markers would put the same piece of work in the same band.
- Criteria describe the work, never the person. "The query returns the right grain" is a criterion; "shows good understanding" is not.
- At least ${MIN_RUBRIC_CRITERIA} criteria per rubric.
- Give each criterion a relative importance. They do not need to add up to anything — that is handled for you.

Acceptance criteria on the project are the checklist the learner ticks off themselves. They are not the rubric; they are the "have I finished" list.

Only claim what the evidence can show. If the artefact is a document, the rubric can judge the document — it cannot judge whether the person understood something they did not write down.`,
} as const;

export const PACK_RUBRICS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    rubrics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          criteria: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                weight: {
                  type: "number",
                  description:
                    "Relative importance, any positive number. Not a fraction.",
                },
                bands: {
                  type: "object",
                  properties: {
                    absent: { type: "string" },
                    developing: { type: "string" },
                    competent: { type: "string" },
                    strong: { type: "string" },
                  },
                  required: ["absent", "developing", "competent", "strong"],
                  additionalProperties: false,
                },
              },
              required: ["name", "description", "weight", "bands"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "criteria"],
        additionalProperties: false,
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          brief: { type: "string" },
          rubric: {
            type: "string",
            description: "Exact name of one of the rubrics you returned.",
          },
          targetSkills: {
            type: "array",
            items: { type: "string" },
            description:
              "References of the skills this produces evidence for, e.g. [\"s2\", \"s5\"]. Not names.",
          },
          evidenceType: {
            type: "string",
            description:
              "What the learner submits: document, repo, image, recording, spreadsheet, query.",
          },
          difficulty: { type: "number", description: "0 to 1." },
          estimatedMinutes: { type: "integer" },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" },
            description: "The learner's own finished-yet checklist.",
          },
        },
        required: [
          "title",
          "brief",
          "rubric",
          "targetSkills",
          "evidenceType",
          "difficulty",
          "estimatedMinutes",
          "acceptanceCriteria",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["rubrics", "projects"],
  additionalProperties: false,
} as const;

export interface RubricsInput {
  subject: string;
  skills: Array<{ ref: string; skill: DraftSkill }>;
}

/** As in `items.ts`: the reference is the only identifier-shaped thing on the line. */
export function buildRubricsContext(input: RubricsInput): string {
  const skills = input.skills
    .filter(({ skill }) => !skill.selfReportOnly)
    .map(
      ({ ref, skill }) =>
        `${ref}: ${skill.name} [${skill.level}] — ${skill.canDoStatement}`,
    )
    .join("\n");

  return [
    `Subject: ${input.subject}`,
    "",
    "Skills this pack teaches, each with the reference to use in `targetSkills`:",
    skills,
    "",
    "Write two or three projects that between them produce evidence for the skills that matter most.",
  ].join("\n");
}

export async function generateRubrics(
  client: Anthropic,
  input: RubricsInput,
  options: { degraded?: boolean } = {},
): Promise<CallResult<RubricsDraft>> {
  return callStructured(client, {
    step: "packRubrics",
    prompt: PACK_RUBRICS_PROMPT,
    system: PACK_RUBRICS_PROMPT.text,
    user: buildRubricsContext(input),
    tool: {
      name: "submit_rubrics",
      description: "Submit the projects and rubrics you wrote.",
      inputSchema: PACK_RUBRICS_TOOL_SCHEMA as unknown as Record<
        string,
        unknown
      >,
    },
    parse: (raw) => {
      const result = RubricsDraft.safeParse(raw);
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
