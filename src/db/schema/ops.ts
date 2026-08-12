import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { learningGoal } from "./learner";
import { skill } from "./domain";
import { learningSession } from "./curriculum";

export const interaction = pgTable(
  "interaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => learningSession.id, {
      onDelete: "cascade",
    }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    /** §14.9.4 — a silent cache miss triples the bill with no error, so record it. */
    cacheReadTokens: integer("cache_read_tokens"),
    model: text("model"),
    costCents: real("cost_cents"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("interaction_user_idx").on(t.userId)],
);

/**
 * §14.8 — every AgentRun records the exact prompt version, model and cost.
 * Prompts are versioned files in git, loaded by (name, version); never
 * hot-edited in a database.
 */
export const agentRun = pgTable(
  "agent_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    agentName: text("agent_name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    /** ok | schema_invalid | refusal | rate_limited | timeout | failed */
    status: text("status").notNull(),
    costCents: real("cost_cents"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_run_agent_idx").on(t.agentName, t.createdAt)],
);

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  rating: integer("rating"),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const progress = pgTable("progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => learningGoal.id, { onDelete: "cascade" }),
  week: text("week").notNull(),
  hoursLogged: real("hours_logged").notNull().default(0),
  skillsAdvanced: integer("skills_advanced").notNull().default(0),
  artifactsProduced: integer("artifacts_produced").notNull().default(0),
  retentionScore: real("retention_score"),
});

/** §15 — phase 2, high value. Fed by the diagnostic's `misconception` field. */
export const misconception = pgTable("misconception", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id")
    .notNull()
    .references(() => skill.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/**
 * §14.7 — RAG is a scoped augmentation, not the architecture. Only the vetted
 * Resource corpus and pack content are embedded; the open web is never queried
 * at request time (that is the Resource Researcher's offline job).
 */
export const resource = pgTable(
  "resource",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    domainAuthority: integer("domain_authority"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    skillIds: jsonb("skill_ids"),
    qualityNote: text("quality_note"),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (t) => [index("resource_url_idx").on(t.url)],
);

/**
 * §14.9.7 limit 1 — per-user monthly AI spend cap, enforced in application code
 * and checked *before* every call. Degrade Opus -> Sonnet, then queue, then notify.
 */
export const spendLedger = pgTable(
  "spend_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    costCents: real("cost_cents").notNull().default(0),
    evaluationsUsed: integer("evaluations_used").notNull().default(0),
    degraded: boolean("degraded").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("spend_ledger_user_period_idx").on(t.userId, t.period)],
);
