import { z } from "zod";

/**
 * What a running session stores between requests.
 *
 * §14.9.2 defines `SessionBlock`, which is what a session is *made of*; nothing
 * in the plan says what a half-finished one looks like, because until E7 no
 * session was ever half-finished. These are those contracts.
 *
 * They are parsed on the way out of the database rather than trusted, for the
 * same reason `activeGoal` parses `GoalSpec`: a row written by an older shape of
 * the code must degrade into something the screen can explain, not into a crash
 * on a page the learner is halfway through.
 */

/** How a check block's answer was decided. */
export const GradedBy = z.enum([
  /** A model marked it against the expected answer (§14.2's free-text grader). */
  "model",
  /** The learner marked their own answer — §7.2 Tier 5, never counted. */
  "self",
  /** Nothing marked it: the grader was unavailable and said so. */
  "ungraded",
]);
export type GradedBy = z.infer<typeof GradedBy>;

export const BlockResponse = z.object({
  /** Index into the session's stored `blocks`. */
  blockIndex: z.number().int().min(0),
  /** Verbatim. Never rewritten, so a disputed grade can be re-read. */
  answer: z.string().max(10_000),
  correct: z.boolean().nullable(),
  gradedBy: GradedBy,
  /** One sentence back to the learner. Empty when nothing graded it. */
  feedback: z.string().max(2_000),
  /** §7.2 — the tier the observation was recorded at, if it moved mastery. */
  evidenceTier: z.number().int().min(1).max(5).nullable(),
  at: z.iso.datetime(),
});
export type BlockResponse = z.infer<typeof BlockResponse>;

export const SessionResponses = z.array(BlockResponse);

/**
 * A tutor turn as stored on `Interaction`. `role` matches the API's own naming
 * so the transcript can be replayed into a request without a translation step.
 */
export const TutorTurn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(10_000),
});
export type TutorTurn = z.infer<typeof TutorTurn>;

/** §14.9.4 layer 2 — the shape cached in the `lesson` table's `content`. */
export const LessonContent = z.object({
  /** One line naming what the learner will be able to do afterwards. */
  objective: z.string().min(1).max(300),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1).max(120),
        body: z.string().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(5),
  /**
   * A worked example, in full. §16.4 fades scaffolding as mastery rises, so
   * this is what a backed-off session leans on when a learner has stalled.
   */
  workedExample: z.string().min(1).max(4_000),
  /** The mistake this skill is usually lost to. */
  commonMistake: z.string().min(1).max(1_000),
});
export type LessonContent = z.infer<typeof LessonContent>;
