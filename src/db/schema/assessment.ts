import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { learningGoal } from "./learner";
import { domainPack, skill } from "./domain";
import { exercise } from "./curriculum";

/**
 * §15 — "calibration data lives here". `difficulty` (theta) and `discrimination`
 * plus the served/correct counters are what turn an item bank into the
 * accumulating asset described in §21. Nothing else in the system is scrapeable.
 */
export const assessmentItem = pgTable(
  "assessment_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => domainPack.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    /** mcq | short_text | explain | code_read | micro_artifact — §8 screen 4 */
    type: text("type").notNull(),
    prompt: text("prompt").notNull(),
    /**
     * prose | code — how the *answer* is typed, not what the question is
     * about. A `short_text` item can ask for a sequence of CLI commands.
     */
    answerFormat: text("answer_format").notNull().default("prose"),
    options: jsonb("options"),
    answerKey: jsonb("answer_key"),
    /** IRT-lite: item difficulty on the same 0..1 scale as mastery. */
    difficulty: doublePrecision("difficulty").notNull(),
    discrimination: doublePrecision("discrimination").notNull().default(1),
    timesServed: integer("times_served").notNull().default(0),
    timesCorrect: integer("times_correct").notNull().default(0),
  },
  (t) => [
    uniqueIndex("assessment_item_pack_slug_idx").on(t.packId, t.slug),
    index("assessment_item_skill_idx").on(t.skillId),
  ],
);

export const assessment = pgTable("assessment", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").references(() => learningGoal.id, {
    onDelete: "cascade",
  }),
  /** diagnostic | retrieval | free_check — the free `/check/*` tool runs anonymously. */
  kind: text("kind").notNull().default("diagnostic"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  anonymousId: text("anonymous_id"),
});

export const assessmentResult = pgTable(
  "assessment_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessment.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => assessmentItem.id, { onDelete: "cascade" }),
    response: text("response"),
    correct: boolean("correct"),
    partial: doublePrecision("partial"),
    confidence: doublePrecision("confidence"),
    thetaEstimate: doublePrecision("theta_estimate"),
    timeSpentSeconds: integer("time_spent_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("assessment_result_assessment_idx").on(t.assessmentId)],
);

/**
 * §4.2 law 2 — every rubric is public before the work is done. `isPublic` drives
 * both the learner-facing brief and the `/projects/*` SEO surface.
 */
export const rubric = pgTable(
  "rubric",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => domainPack.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    version: integer("version").notNull().default(1),
    /** criteria: [{ id, name, description, weight, bands: {absent,developing,competent,strong} }] */
    criteria: jsonb("criteria").notNull(),
    isPublic: boolean("is_public").notNull().default(true),
  },
  (t) => [uniqueIndex("rubric_pack_slug_idx").on(t.packId, t.slug)],
);

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => domainPack.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubric.id),
    evidenceType: text("evidence_type").notNull(),
    difficulty: doublePrecision("difficulty").notNull(),
    targetSkillIds: jsonb("target_skill_ids").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria"),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    /** Drives the `/projects/*` SEO surface (§10 B). */
    isPublic: boolean("is_public").notNull().default(false),
  },
  (t) => [uniqueIndex("project_pack_slug_idx").on(t.packId, t.slug)],
);

export const submission = pgTable(
  "submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => project.id),
    exerciseId: uuid("exercise_id").references(() => exercise.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** queued | ingesting | grading | verifying | complete | failed | human_review */
    status: text("status").notNull().default("queued"),
    /**
     * Why it failed, as one of `FAILURE_CAUSES` — a code, never a sentence.
     *
     * `status: "failed"` on its own told the learner nothing and told us
     * nothing: an empty hand-in, a withdrawn brief and a marker that fell over
     * were the same row. The copy lives in `lib/submissions/failure.ts` so it
     * can be rewritten for rows already written, and so nothing reaches a
     * learner that is not in that table.
     */
    failureCause: text("failure_cause"),
    /**
     * The machinery behind that code, for us. **Never rendered.**
     *
     * `CallResult` carries a `detail` — "gaps: Too big: expected array to have
     * <=6 items" is the string that explained the failure this column was added
     * after — and the pipeline was discarding it, keeping only the status. It
     * survives in `agent_run.error`, but nothing joins an `agent_run` to a
     * submission, so answering "why did *this* one fail" meant matching on a
     * user and a timestamp.
     */
    failureDetail: text("failure_detail"),
  },
  (t) => [index("submission_user_idx").on(t.userId)],
);

export const artifact = pgTable("artifact", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submission.id, { onDelete: "cascade" }),
  /** repo | file | image | audio | text | url — §15 */
  type: text("type").notNull(),
  storageRef: text("storage_ref").notNull(),
  sizeBytes: integer("size_bytes"),
  metadata: jsonb("metadata"),
  /** §14.9.5 — truncation is disclosed on the evaluation, never silent. */
  truncated: boolean("truncated").notNull().default(false),
});

/**
 * §14.5 — the crown jewel's output. `criterionResults` carries the evidence
 * quote per criterion; `verifierPassed` records the deterministic string-match
 * check that every quote appears verbatim in the artefact.
 */
export const evaluation = pgTable(
  "evaluation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submission.id, { onDelete: "cascade" }),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubric.id),
    rubricVersion: integer("rubric_version").notNull(),
    overallScore: doublePrecision("overall_score").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    evalTier: integer("eval_tier").notNull(),
    criterionResults: jsonb("criterion_results").notNull(),
    strengths: jsonb("strengths"),
    gaps: jsonb("gaps"),
    nextActions: jsonb("next_actions"),
    provenBy: jsonb("proven_by"),
    modelUsed: text("model_used").notNull(),
    promptVersion: text("prompt_version").notNull(),
    verifierPassed: boolean("verifier_passed").notNull(),
    deterministicChecks: jsonb("deterministic_checks"),
    humanReviewed: boolean("human_reviewed").notNull().default(false),
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("evaluation_submission_idx").on(t.submissionId)],
);

/**
 * §15 — "full audit trail; every mastery change is traceable to evidence".
 * This table is what makes §4.2 law 1 ("no mastery without evidence") auditable
 * rather than merely asserted.
 */
export const masteryUpdate = pgTable(
  "mastery_update",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    evaluationId: uuid("evaluation_id").references(() => evaluation.id),
    assessmentResultId: uuid("assessment_result_id").references(
      () => assessmentResult.id,
    ),
    priorMastery: doublePrecision("prior_mastery").notNull(),
    posteriorMastery: doublePrecision("posterior_mastery").notNull(),
    delta: doublePrecision("delta").notNull(),
    observationConfidence: doublePrecision("observation_confidence").notNull(),
    evidenceTier: integer("evidence_tier").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("mastery_update_user_skill_idx").on(t.userId, t.skillId)],
);

/**
 * §16.1 step 4 / §16.4 — the spaced-retrieval queue. `dueAt` is derived from the
 * decay half-life, so spaced repetition falls out of the mastery model rather
 * than being a separate scheduler.
 */
export const retrievalQueueItem = pgTable(
  "retrieval_queue_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => assessmentItem.id),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    lastServedAt: timestamp("last_served_at", { withTimezone: true }),
    successStreak: integer("success_streak").notNull().default(0),
    intervalDays: real("interval_days").notNull().default(7),
  },
  (t) => [index("retrieval_queue_due_idx").on(t.userId, t.dueAt)],
);
