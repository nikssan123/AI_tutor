import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
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
/**
 * `visitor` | `operator` | null — *why* a run has no user, which §19.2's free-tier
 * cap needs and could not previously ask.
 *
 * Null on every row written before this column existed, and those count as
 * visitor spend. That is the safe reading: over-counting degrades the free tier
 * conservatively, while under-counting leaves it unbounded.
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
    /** visitor | operator | null — see the note above the table. */
    origin: text("origin"),
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
 * What the tutor noticed, which is not what the tutor decided.
 *
 * PLAN-ADAPTATION step 3. These rows are **not evidence** and nothing here may
 * ever reach `learner_skill_mastery`: §7.2 puts a model's impression of a
 * conversation at tier 5, and tier 5 can never raise mastery. They feed the
 * planner's frustration damper and the next lesson's support level, both of
 * which only ever make the system gentler.
 *
 * Kept separate from `interaction` because that table is the transcript and
 * this is a reading of it — one row per labelled turn, and most turns produce
 * no row at all.
 */
export const tutorSignal = pgTable("tutor_signal", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => learningSession.id, {
    onDelete: "cascade",
  }),
  /**
   * Nullable: a `review` or `reflect` block is not about one skill, so a signal
   * raised there attaches to nothing rather than to the wrong thing.
   */
  skillId: uuid("skill_id").references(() => skill.id, { onDelete: "cascade" }),
  /** One of `TUTOR_SIGNALS`. Never "none" — an unlabelled turn writes no row. */
  signal: text("signal").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  // Unique, not merely indexed: a learner has exactly one ledger row per
  // period by definition, and accumulating spend is an upsert. Without the
  // constraint two concurrent calls each insert a row and the cap silently
  // reads half the real total — which is the one direction §14.9.7 cannot
  // tolerate being wrong in.
  (t) => [uniqueIndex("spend_ledger_user_period_idx").on(t.userId, t.period)],
);

/**
 * Every privileged act performed through `/admin`, kept forever.
 *
 * `src/lib/admin/console.ts` says a read-only console "needs no audit log to be
 * trustworthy — the day it grows a button, all three of those become required
 * at once". This is that day, and this is that log.
 *
 * Two shapes of row land here: SQL the operator typed, and the typed quick
 * actions on a table row. Both record what was attempted, not merely what
 * succeeded, because a denied `DELETE` and a rejected query are exactly the
 * events an investigation is looking for.
 *
 * There is deliberately **no foreign key** on `actorId`. A log constrained by
 * the table it observes is a log that its own subject can block: writing the
 * row that says "this account was deleted" would fail the moment the account no
 * longer existed, and a `set null` would quietly erase who acted the moment
 * they left. Both columns are therefore plain strings, kept forever. An audit
 * trail that can be argued out of existence by the data it audits is not one.
 */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The actor's id at the time. Not a reference — see above. */
    actorId: text("actor_id"),
    actorEmail: text("actor_email").notNull(),
    /** `sql.read` | `sql.write` | `user.plan` | `user.sessions` | `user.delete` */
    action: text("action").notNull(),
    /** What it was aimed at: a table name, a row id, an email. */
    target: text("target"),
    /** The query text, the old and new values — whatever makes the row legible later. */
    detail: jsonb("detail"),
    /** ok | error | denied */
    outcome: text("outcome").notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    rowCount: integer("row_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt)],
);

/**
 * §7.1's Generated tier, in progress.
 *
 * A pack takes around three minutes and several model calls to author, so it
 * cannot happen inside a request. This is the row the wait screen polls and the
 * row that stops ten people asking for Rust from starting ten generations: the
 * build is keyed by slug, not by learner, because the pack it produces is
 * shared by everyone who asks for that subject.
 */
export const packBuild = pgTable(
  "pack_build",
  {
    slug: text("slug").primaryKey(),
    /** The subject as the analyzer resolved it, for the authoring call. */
    subject: text("subject").notNull(),
    /** Who asked first. Null once they are gone; the pack outlives them. */
    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    /** building | ready | failed */
    status: text("status").notNull().default("building"),
    /**
     * How far the worker has got: graph | writing | checking | saving, and null
     * until it picks the row up. Written for one reader — the wait screen, which
     * otherwise has nothing to report for three minutes but the fact that it is
     * still waiting. See `BUILD_STAGES`.
     */
    stage: text("stage"),
    /** Why it failed, in the learner's language. */
    detail: text("detail"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("pack_build_status_idx").on(t.status, t.startedAt)],
);
