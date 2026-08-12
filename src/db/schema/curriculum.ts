import {
  date,
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
import { skill } from "./domain";

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
    durationMinutes: real("duration_minutes"),
    selfReportedDifficulty: integer("self_reported_difficulty"),
  },
  (t) => [index("learning_session_user_idx").on(t.userId)],
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
