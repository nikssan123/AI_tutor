import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, type CallResult } from "@/lib/ai/call";
import {
  ItemBankDraft,
  MIN_ITEMS_PER_SKILL,
  type DraftSkill,
} from "@/lib/contracts/pack";

/**
 * The item bank for a generated pack.
 *
 * IMPLEMENTATION.md pass 6 recorded that the item bank is the bottleneck: the
 * adaptive diagnostic can only place a learner on a skill it has items for, and
 * `validatePack` lets a non-curated pack ship with gaps (as a warning, by
 * design). "Allowed to be thin" and "should be thin" are different things, so
 * the generator targets three items per skill rather than the one the validator
 * would accept — a diagnostic with one item per skill cannot narrow anything.
 *
 * Generated in batches by area rather than in one call, because a single call
 * for forty items runs long, and a batch that fails costs one area rather than
 * the whole bank.
 */

export const PACK_ITEMS_PROMPT = {
  name: "pack_item_author",
  // 2: asks for the answer position to vary. `balanceAnswerPositions`
  // guarantees it regardless, but a bank that arrives already spread needs less
  // rearranging — and the version is what ties an `AgentRun` row to the text
  // that produced it, so the two must move together.
  version: 2,
  text: `You write assessment items that find out whether someone can already do a skill.

You are given a group of skills from one subject, each with the can-do statement it will be measured against. You return items that test them.

The purpose is placement, not teaching. An item earns its place by *separating* people who can do the thing from people who cannot — so avoid anything answerable from general knowledge, and avoid anything that only checks whether they remember a word.

Write mostly items that make the person produce something:

- \`short_text\` — a sentence or two they have to compose. The default.
- \`explain\` — they explain why something behaves as it does.
- \`code_read\` — they read a fragment and say what it does or what is wrong with it.
- \`micro_artifact\` — they write the actual thing, small.
- \`mcq\` — use sparingly, and only where the wrong options are genuinely tempting to someone with a real misconception.

**At most one item in three may be \`mcq\`.** Items that make someone produce an answer tell you far more than items that make them pick one.

Spread difficulty across the range for each skill: one an early learner would get, one a competent person would get, one that separates competent from strong. Difficulty is 0 to 1 on the same scale as mastery.

For free-text items, \`concepts\` is what a correct answer must contain — the learner marks themselves against it, so write checkable claims and not a model answer. For multiple choice, give \`options\` and the 0-based \`correct\` index — and vary which position holds the answer, because a bank whose answers sit mostly in one slot can be scored by guessing that slot.

Each skill you are given carries a short reference like \`s3\`. Put that reference in the item's \`skill\` field — not the skill's name.`,
} as const;

export const PACK_ITEMS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: {
            type: "string",
            description:
              "The reference of the skill this assesses, e.g. \"s3\". Not the name.",
          },
          type: {
            type: "string",
            enum: [
              "mcq",
              "short_text",
              "explain",
              "code_read",
              "micro_artifact",
            ],
          },
          difficulty: {
            type: "number",
            description: "0 to 1, same scale as mastery.",
          },
          prompt: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Multiple choice only. 2 to 5 options.",
          },
          correct: {
            type: "integer",
            description: "Multiple choice only. 0-based index into options.",
          },
          concepts: {
            type: "array",
            items: { type: "string" },
            description:
              "Free-text only. Checkable claims a correct answer must contain.",
          },
        },
        required: ["skill", "type", "difficulty", "prompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export interface ItemsInput {
  subject: string;
  /**
   * One area's worth of skills, each with the reference the model must quote
   * back. The reference is assigned against the *whole* graph by the caller, so
   * it stays stable across batches.
   */
  skills: Array<{ ref: string; skill: DraftSkill }>;
}

/**
 * The skill list, written so the reference is the only thing that looks like an
 * identifier. Every other field is on its own labelled line — nothing sits
 * directly after the name where it could be read as part of it.
 */
export function buildItemsContext(input: ItemsInput): string {
  const skills = input.skills
    .map(({ ref, skill }) =>
      [
        `${ref}:`,
        `  name: ${skill.name}`,
        `  level: ${skill.level}`,
        `  can do: ${skill.canDoStatement}`,
        `  evidence: ${skill.observableEvidence.join("; ")}`,
      ].join("\n"),
    )
    .join("\n\n");

  return [
    `Subject: ${input.subject}`,
    "",
    `Write at least ${MIN_ITEMS_PER_SKILL} items for each of these skills. Use the reference (${input.skills
      .map((s) => s.ref)
      .join(", ")}) in each item's \`skill\` field.`,
    "",
    skills,
  ].join("\n");
}

export async function generateItems(
  client: Anthropic,
  input: ItemsInput,
  options: { degraded?: boolean } = {},
): Promise<CallResult<ItemBankDraft>> {
  return callStructured(client, {
    step: "packItems",
    prompt: PACK_ITEMS_PROMPT,
    system: PACK_ITEMS_PROMPT.text,
    user: buildItemsContext(input),
    tool: {
      name: "submit_items",
      description: "Submit the assessment items you wrote.",
      inputSchema: PACK_ITEMS_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = ItemBankDraft.safeParse(raw);
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

/**
 * Skills grouped into generation batches.
 *
 * By area, because items for related skills are written better together — the
 * model can tell that two skills in the same area need different questions.
 * Large areas are split so no single call is asked for thirty items at once.
 */
export const MAX_SKILLS_PER_BATCH = 5;

export type RefSkill = { ref: string; skill: DraftSkill };

/**
 * References are assigned over the whole graph before batching, so `s7` means
 * the same skill whichever batch it lands in — and the caller can resolve any
 * item back without knowing which call produced it.
 */
export function batchSkills(skills: RefSkill[]): RefSkill[][] {
  const byArea = new Map<string, RefSkill[]>();
  for (const entry of skills) {
    const bucket = byArea.get(entry.skill.area);
    if (bucket) bucket.push(entry);
    else byArea.set(entry.skill.area, [entry]);
  }

  const batches: RefSkill[][] = [];
  for (const group of byArea.values()) {
    for (let i = 0; i < group.length; i += MAX_SKILLS_PER_BATCH) {
      batches.push(group.slice(i, i + MAX_SKILLS_PER_BATCH));
    }
  }

  return batches;
}
