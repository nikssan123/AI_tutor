import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { learningGoal } from "./learner";
import { domainPack, skill } from "./domain";

/**
 * §14.4 — the curriculum is a *cached projection* of the plan, never the source
 * of truth. The source of truth is (skill graph × mastery state × constraints).
 * That is what makes it genuinely adaptive rather than a static list with a bar.
 */
export const curriculum = pgTable("curriculum", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => learningGoal.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** The full §14.9.2 ValidatorReport, including every check that ran. */
  validatorReport: jsonb("validator_report"),
  /** draft | validated | active | superseded */
  status: text("status").notNull().default("draft"),
});

/**
 * A path build in flight, for the screen that has to wait for it.
 *
 * Cutting a goal into modules is up to two model calls and a validator, and it
 * used to run inside the server action the button posted to — so the learner
 * pressed "Build my path" and got a page that sat there, silent, for as long as
 * that took. §14.9.3 allows a synchronous action "only where a human is
 * waiting", and the human waiting was exactly the problem: nothing could tell
 * them anything, because the only record of the work was a promise on the
 * request.
 *
 * So the work went to the queue and this is what the queue writes down for the
 * learner to read. Same shape as `pack_build` and for the same reasons — a
 * status, a phase, and a `started_at` the screen can call stopped when it has
 * outlived the timeout — minus everything about quotas and sharing, which are
 * `pack_build`'s problems and not this one's: a curriculum belongs to a single
 * goal and is no use to anybody else.
 *
 * The goal is the primary key rather than a column, which makes the insert the
 * lock: a learner who double-presses the button starts one build, not two.
 */
export const curriculumBuild = pgTable("curriculum_build", {
  goalId: uuid("goal_id")
    .primaryKey()
    .references(() => learningGoal.id, { onDelete: "cascade" }),
  /** building | ready | failed | skipped — see `PathBuildStatus`. */
  status: text("status").notNull().default("building"),
  /** Null until the worker picks the row up: queued, not yet started. */
  stage: text("stage"),
  /** Why it stopped, or why there turned out to be nothing to build. */
  detail: text("detail"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const curriculumModule = pgTable(
  "curriculum_module",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    curriculumId: uuid("curriculum_id")
      .notNull()
      .references(() => curriculum.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    title: text("title").notNull(),
    targetSkillIds: jsonb("target_skill_ids").notNull(),
    estimatedHours: real("estimated_hours").notNull(),
    /** none | exercise | project | recording | document | media — §14.9.2 */
    outputArtifactType: text("output_artifact_type").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria"),
    rubricId: uuid("rubric_id"),
  },
  (t) => [uniqueIndex("curriculum_module_order_idx").on(t.curriculumId, t.order)],
);

/**
 * §16.1 — produced by the deterministic planner. `reason` is template-filled
 * from the score components, never LLM-generated: it must be truthful and free.
 */
export const learningPlan = pgTable(
  "learning_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => learningGoal.id, { onDelete: "cascade" }),
    plannedFor: date("planned_for").notNull(),
    /** The serialised PlannedSession — blocks, minutes, targeted skills. */
    sessionSpec: jsonb("session_spec").notNull(),
    /** Why this, today. Shown verbatim on /today. */
    reason: text("reason").notNull(),
    /** pending | started | completed | skipped | superseded */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("learning_plan_user_goal_day_idx").on(
      t.userId,
      t.goalId,
      t.plannedFor,
    ),
  ],
);

export const learningSession = pgTable(
  "learning_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => learningGoal.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => learningPlan.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** SessionBlock[] from §14.9.2. */
    blocks: jsonb("blocks").notNull(),
    /**
     * §8 screen 7 — "pause and resume mid-session". The block a learner is on
     * is a column rather than a field inside `responses` because "how far do
     * people get before they stop" is the question this table exists to answer.
     */
    blockIndex: integer("block_index").notNull().default(0),
    /** One entry per answered block: what was written, and how it was graded. */
    responses: jsonb("responses").notNull().default([]),
    durationMinutes: real("duration_minutes"),
    selfReportedDifficulty: integer("self_reported_difficulty"),
  },
  (t) => [index("learning_session_user_idx").on(t.userId)],
);

/**
 * Which lessons a learner has actually been *served*, per course.
 *
 * The free tier's paywall counts rows here: one lesson per course, and the
 * second is where the product asks to be paid for. It has to be a record of
 * what was delivered rather than a count derived from the session's blocks,
 * because a planned block and a read lesson are different things — a learner
 * who has a five-block session planned has not been given five lessons, and
 * counting the plan would lock them out before they read anything.
 *
 * Keyed by `(user_id, skill_id)` so it is idempotent by construction: the
 * lesson body is a server component and re-renders on every refresh, and an
 * insert that counted twice would spend the allowance on a page reload.
 * `pack_id` is denormalised off the skill so the count is one indexed read on
 * a path a learner is waiting on.
 */
export const lessonDelivery = pgTable(
  "lesson_delivery",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    packId: uuid("pack_id")
      .notNull()
      .references(() => domainPack.id, { onDelete: "cascade" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.skillId] }),
    index("lesson_delivery_user_pack_idx").on(t.userId, t.packId),
  ],
);

/**
 * §14.9.4 layer 2 — generated lessons keyed by (skillId, level, styleHash) are
 * reusable across learners. Expect a 40–60% hit rate once a pack has a few
 * hundred users; the marginal cost of a cached lesson is a DB read.
 */
export const lesson = pgTable(
  "lesson",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    level: text("level").notNull(),
    styleHash: text("style_hash").notNull(),
    content: jsonb("content").notNull(),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("lesson_cache_idx").on(t.skillId, t.level, t.styleHash)],
);

export const exercise = pgTable("exercise", {
  id: uuid("id").primaryKey().defaultRandom(),
  skillId: uuid("skill_id")
    .notNull()
    .references(() => skill.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  /** worked_example | partial | independent — scaffolding fades as mastery rises. */
  supportLevel: text("support_level").notNull().default("independent"),
  evidenceType: text("evidence_type").notNull(),
  rubricId: uuid("rubric_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
