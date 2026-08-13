import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, type CallResult } from "@/lib/ai/call";
import {
  MAX_GENERATED_SKILLS,
  MIN_GENERATED_SKILLS,
  PackGraphDraft,
} from "@/lib/contracts/pack";

/**
 * §24 E3 — "a goal with no matching pack triggers Generated-pack creation and
 * still produces a usable graph."
 *
 * This is the first of the three calls that build one, and the only one on the
 * deep tier. The skill graph is what the diagnostic places a learner on, what
 * the planner orders, and what the curriculum architect is handed; none of them
 * can correct it, and a wrong edge here is invisible until someone is being
 * taught things in the wrong order.
 *
 * §14.9.6 — the prompt is a module constant, versioned, and recorded on the
 * `AgentRun` row, so a change to it is a reviewable commit.
 */

export const PACK_GRAPH_PROMPT = {
  name: "pack_graph_author",
  version: 1,
  text: `You design the skill graph for a subject someone wants to learn.

You are given a subject and, when we have it, the learner's own words about what they want out of it. You return a set of skills and the order they have to be learned in.

What makes a skill graph good here:

- Every skill is something a person can *do*, not something they can know about. "Understands normalisation" is not a skill; "normalise a table to third normal form and say what it cost you" is.
- The set covers the subject as someone competent in it would recognise it. Not a beginner's tour, and not a syllabus with everything in it.
- Prerequisites are real dependencies, not a preferred order. A skill lists a prerequisite only when someone genuinely cannot do it without that other skill first. Most skills have one or two; many have none.
- **List skills in an order where every prerequisite has already appeared.** Name prerequisites by the exact skill name you used earlier in the list.
- Levels mean what they say: foundational is where a total beginner starts, specialist is what a practitioner learns last and many never do.
- Hours are the real hours a motivated adult needs to get to the can-do statement, including the practice. Not lesson length.

Mark a skill \`selfReportOnly\` when there is no artefact a person could produce that would show they have it — taste, confidence, motivation, "understanding" with no output. Be strict about this: if you can name a thing they'd make or do, it is not self-report.

The can-do statement is what the learner will be measured against, so write it as one checkable action with an observable result.

Everything else about this pack — its slugs, its assessment tiers, its statistical priors — is computed from what you return. Do not try to supply them.`,
} as const;

/**
 * The schema the model is steered by, written by hand rather than derived from
 * the Zod contract. Structured outputs cannot express array bounds or string
 * lengths; `PackGraphDraft.safeParse` is what actually decides whether the
 * result is usable (see `call.ts`).
 */
export const PACK_GRAPH_TOOL_SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "Display name for the subject, in the learner's terms. e.g. 'Rust Programming'.",
    },
    taxonomyParent: {
      type: "string",
      description:
        "One-word branch this belongs under, lowercase. e.g. technology, business, creative, science, language, craft.",
    },
    workspace: {
      type: "string",
      enum: ["text", "code", "query-sheet", "media", "audio", "conversation"],
      description:
        "The surface a learner produces evidence in for this subject.",
    },
    skills: {
      type: "array",
      description: `${MIN_GENERATED_SKILLS} to ${MAX_GENERATED_SKILLS} skills, ordered so every prerequisite appears before the skill that needs it.`,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          level: {
            type: "string",
            enum: ["foundational", "core", "advanced", "specialist"],
          },
          area: {
            type: "string",
            description:
              "Sub-area of the subject this belongs to. Skills in the same area are related; a handful of areas across the pack.",
          },
          estimatedHours: { type: "number" },
          canDoStatement: {
            type: "string",
            description: "One checkable action with an observable result.",
          },
          observableEvidence: {
            type: "array",
            items: { type: "string" },
            description: "What a person would produce that shows this skill.",
          },
          prerequisites: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact names of skills listed EARLIER in this array. Empty for most skills.",
          },
          selfReportOnly: {
            type: "boolean",
            description:
              "True only when no artefact could demonstrate it (taste, confidence, motivation).",
          },
        },
        required: [
          "name",
          "description",
          "level",
          "area",
          "estimatedHours",
          "canDoStatement",
          "observableEvidence",
          "prerequisites",
          "selfReportOnly",
        ],
        additionalProperties: false,
      },
    },
    rationale: {
      type: "string",
      description:
        "Why this set and this order, and what you deliberately left out.",
    },
  },
  required: ["name", "taxonomyParent", "workspace", "skills", "rationale"],
  additionalProperties: false,
} as const;

export interface GraphInput {
  /** The subject as the analyzer resolved it, e.g. "Rust programming". */
  subject: string;
  /** The learner's own words, when there are any. Never rewritten. */
  rawGoal: string | null;
}

export function buildGraphContext(input: GraphInput): string {
  return [
    `Subject: ${input.subject}`,
    input.rawGoal === null
      ? ""
      : `The learner described what they want like this: ${input.rawGoal}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

export async function generatePackGraph(
  client: Anthropic,
  input: GraphInput,
  options: { degraded?: boolean } = {},
): Promise<CallResult<PackGraphDraft>> {
  return callStructured(client, {
    step: "packAuthor",
    prompt: PACK_GRAPH_PROMPT,
    system: PACK_GRAPH_PROMPT.text,
    user: buildGraphContext(input),
    tool: {
      name: "submit_skill_graph",
      description: "Submit the skill graph you designed for this subject.",
      inputSchema: PACK_GRAPH_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = PackGraphDraft.safeParse(raw);
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
