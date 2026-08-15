import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { lessonDelivery, lesson as lessonTable } from "@/db/schema";
import { callStructured, type CallResult } from "@/lib/ai/call";
import { packId as packPackId, skillId as packSkillId } from "@/lib/packs/ids";
import { LessonContent } from "@/lib/contracts/session";
import type { PriorDomain } from "@/lib/contracts/goal";
import { stableStringify } from "@/lib/engine/planner";

/**
 * §24 E7 — the Lesson Generator, and §14.9.4 layer 2, the cache that makes it
 * affordable.
 *
 * "Generated lessons keyed by (skillId, level, styleHash) are reusable across
 * learners. Expect a 40–60% hit rate once a pack has a few hundred users; the
 * marginal cost of a cached lesson is a DB read."
 *
 * That reuse is the reason nothing learner-specific goes into a lesson. A lesson
 * that opened "you struggled with this on Tuesday" would be correct for one
 * person and a cache entry nobody else can be served — the tutor is where
 * personal context belongs, and it has the whole Learner Context Block.
 */

export const LESSON_PROMPT = {
  name: "lesson_generator",
  version: 1,
  text: `You write one short lesson for one skill, for an adult learning it deliberately.

You are given the skill, what the learner should be able to do afterwards, roughly how long they have, and how far along someone at this level is. You return the lesson through a tool call.

What a good lesson here looks like:

- It teaches the one skill named and stops. Adjacent material belongs in another lesson.
- It is written to be read once and acted on. No preamble, no "in this lesson we will", no summary of itself.
- Every claim is concrete enough to be checked. Prefer a specific example over a description of the kind of example someone might use.
- The worked example is complete and worked *through* — each step shown, and the reason for the step given. This is the part a stuck learner reads.
- The common mistake is the one people actually make, described precisely enough to recognise in your own work.

Plain language. Short sentences. Second person. No emoji, no headings inside a section body, no markdown tables.

This lesson is shown to many learners at the same level, so write nothing that assumes a particular person, history or timetable.`,
} as const;

export const LESSON_TOOL_SCHEMA = {
  type: "object",
  properties: {
    objective: {
      type: "string",
      description: "One line: what the learner can do after reading this.",
    },
    sections: {
      type: "array",
      description: "One to five sections, in reading order.",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
        },
        required: ["heading", "body"],
        additionalProperties: false,
      },
    },
    workedExample: {
      type: "string",
      description: "A complete example, each step shown and justified.",
    },
    commonMistake: {
      type: "string",
      description: "The mistake people actually make, described recognisably.",
    },
  },
  required: ["objective", "sections", "workedExample", "commonMistake"],
  additionalProperties: false,
} as const;

/** How much support the lesson leads with — §16.4's fading scaffolding. */
export type SupportLevel = "worked_example" | "standard";

export interface LessonRequest {
  packSlug: string;
  skillSlug: string;
  skillName: string;
  canDoStatement: string;
  /** The learner's band, not a number — see `masteryBand`. Part of the cache key. */
  level: string;
  minutes: number;
  support: SupportLevel;
  /**
   * What the learner already works with, from a closed set (§ PLAN-ADAPTATION
   * step 5). The fifth and last cache dimension.
   *
   * A closed set is the entire point. The free-text `existingAssets` it is
   * derived from would give a better analogy and a cache hit rate of zero;
   * four values fragment a lesson into at most four buckets per band, each one
   * still shared with everyone who answered the same way.
   */
  priorDomain: PriorDomain;
}

/**
 * Length is bucketed rather than exact, because a 12-minute and a 13-minute
 * lesson are the same lesson and keying on the exact number would miss the
 * cache for no gain.
 */
export function minutesBucket(minutes: number): number {
  if (minutes <= 10) return 10;
  if (minutes <= 20) return 20;
  if (minutes <= 40) return 40;
  return 60;
}

/**
 * The third part of §14.9.4's cache key: everything that changes the shape of
 * the lesson without changing which skill it teaches. Serialised with sorted
 * keys so the hash cannot depend on the order a caller wrote the object.
 */
export function styleHashFor(request: LessonRequest): string {
  return createHash("sha256")
    .update(
      stableStringify({
        pack: request.packSlug,
        minutes: minutesBucket(request.minutes),
        support: request.support,
        priorDomain: request.priorDomain,
        prompt: `${LESSON_PROMPT.name}@${LESSON_PROMPT.version}`,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * The analogy the reader already has, offered rather than imposed.
 *
 * "Where it genuinely fits" is doing real work in that sentence. Told only that
 * a reader knows spreadsheets, a model will reach for a pivot-table metaphor in
 * a lesson about NULL semantics, where it is worse than no analogy at all — the
 * reader now has to unlearn the comparison as well as learn the skill. The
 * permission to ignore it has to be as explicit as the fact itself.
 *
 * `none` adds no line, so those lessons are byte-for-byte the prompt that was
 * being sent before this existed.
 */
export function priorDomainLine(priorDomain: PriorDomain): string[] {
  const known: Record<Exclude<PriorDomain, "none">, string> = {
    spreadsheets: "spreadsheets — formulas, pivot tables, that way of thinking about rows and columns",
    programming: "programming in some language",
    statistics: "statistics",
  };

  if (priorDomain === "none") return [];
  return [
    `This learner already works with ${known[priorDomain]}. Where an analogy to that genuinely fits, use it and name it. Where it does not, ignore this entirely — a forced comparison leaves them unlearning it as well as learning the skill.`,
  ];
}

export function buildLessonPrompt(request: LessonRequest): string {
  return [
    `Skill: ${request.skillName}`,
    `After this lesson the learner can: ${request.canDoStatement}`,
    `Reading time: about ${minutesBucket(request.minutes)} minutes.`,
    `Learner level: ${request.level}.`,
    request.support === "worked_example"
      ? "This learner has tried this skill and not got it yet. Lead with the worked example and keep the explanation behind it short."
      : "Lead with the explanation, then the worked example.",
    ...priorDomainLine(request.priorDomain),
  ].join("\n");
}

export async function generateLesson(
  client: Anthropic,
  request: LessonRequest,
  options: { degraded?: boolean } = {},
): Promise<CallResult<LessonContent>> {
  return callStructured(client, {
    step: "lessonGenerator",
    prompt: LESSON_PROMPT,
    system: LESSON_PROMPT.text,
    user: buildLessonPrompt(request),
    tool: {
      name: "submit_lesson",
      description: "Submit the lesson you wrote.",
      inputSchema: LESSON_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = LessonContent.safeParse(raw);
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
    maxTokens: 4_000,
  });
}

/** §14.9.4 layer 2 — the read half. */
export async function cachedLesson(
  db: Db,
  request: LessonRequest,
): Promise<LessonContent | undefined> {
  const rows = await db
    .select({ content: lessonTable.content })
    .from(lessonTable)
    .where(
      and(
        eq(lessonTable.skillId, packSkillId(request.packSlug, request.skillSlug)),
        eq(lessonTable.level, request.level),
        eq(lessonTable.styleHash, styleHashFor(request)),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  // A cached row written under an older contract is treated as a miss rather
  // than served: regenerating costs a few cents, and serving a half-shaped
  // lesson costs a learner their session.
  const parsed = LessonContent.safeParse(row.content);
  return parsed.success ? parsed.data : undefined;
}

export async function saveLesson(
  db: Db,
  request: LessonRequest,
  content: LessonContent,
  now: Date,
): Promise<void> {
  await db
    .insert(lessonTable)
    .values({
      skillId: packSkillId(request.packSlug, request.skillSlug),
      level: request.level,
      styleHash: styleHashFor(request),
      content,
      promptVersion: `${LESSON_PROMPT.name}@${LESSON_PROMPT.version}`,
      createdAt: now,
    })
    // Two learners can miss the cache on the same skill at the same moment. The
    // second write is the same lesson by construction, so it updates rather than
    // failing the request that produced it.
    .onConflictDoUpdate({
      target: [lessonTable.skillId, lessonTable.level, lessonTable.styleHash],
      set: { content, promptVersion: `${LESSON_PROMPT.name}@${LESSON_PROMPT.version}` },
    });
}

/* ── The paywall's meter ──────────────────────────────────────────────────── */

/**
 * Skills this learner has already been served a lesson for, on this course.
 *
 * A set rather than a count, because the question is asked two ways and both
 * matter: *how many* have they had, and *is this one of them*. A learner
 * returning to the lesson they already read must be let back in — the allowance
 * buys a lesson, not one viewing of it — and a count alone cannot tell a
 * re-read from a second lesson.
 */
export async function lessonsDeliveredOn(
  db: Db,
  userId: string,
  packSlug: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ skillId: lessonDelivery.skillId })
    .from(lessonDelivery)
    .where(
      and(
        eq(lessonDelivery.userId, userId),
        eq(lessonDelivery.packId, packPackId(packSlug)),
      ),
    );

  return new Set(rows.map((r) => r.skillId));
}

/**
 * Records that a lesson reached a learner.
 *
 * Written after the content is in hand rather than before, so a generation that
 * failed does not spend the allowance on a lesson nobody read. Idempotent by
 * primary key: the lesson body re-renders on every refresh, and an insert that
 * counted twice would cost somebody their free lesson for pressing reload.
 */
export async function recordLessonDelivery(
  db: Db,
  input: { userId: string; packSlug: string; skillSlug: string; now: Date },
): Promise<void> {
  await db
    .insert(lessonDelivery)
    .values({
      userId: input.userId,
      skillId: packSkillId(input.packSlug, input.skillSlug),
      packId: packPackId(input.packSlug),
      deliveredAt: input.now,
    })
    .onConflictDoNothing();
}
