import {
  doublePrecision,
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

/**
 * §7.1 — a Domain Pack is a versioned data bundle, not code. The engine is
 * domain-agnostic; packs supply domain knowledge. Maturity is declared, not
 * faked: curated / standard / generated, and the badge is shown to the user.
 */
export const domainPack = pgTable(
  "domain_pack",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    taxonomyParent: text("taxonomy_parent"),
    /** curated | standard | generated — §7.1 */
    maturity: text("maturity").notNull(),
    /** 1..5 — §7.2 evaluation-capability tier for the pack as a whole. */
    evalTier: integer("eval_tier").notNull(),
    /** Which work surface to render — §7.3. Data, never code. */
    workspace: text("workspace").notNull(),
    version: integer("version").notNull().default(1),
    /**
     * §7.1's quality gate, as a column rather than a derived guess.
     *
     * Needed twice over: without it a pack read back out of the database is not
     * the pack that was written (`quality.status` would be invented at read
     * time), and the Generated → Standard promotion path has no state to move
     * through. `draft` is the safe default — a pack that never declared a status
     * has not been reviewed.
     */
    qualityStatus: text("quality_status").notNull().default("draft"),
    qualityScore: real("quality_score"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    evaluatorConfig: jsonb("evaluator_config"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("domain_pack_slug_idx").on(t.slug)],
);

export const skill = pgTable(
  "skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => domainPack.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    /** foundational | core | advanced | specialist — §14.4 */
    level: text("level").notNull(),
    /**
     * The skill *area*. §16.4's interleaving bonus rewards switching area
     * between sessions, so this is a planner input, not a display label.
     */
    area: text("area").notNull(),
    /** 1..5 — §7.2. A tier-5 skill can never gain mastery from evidence. */
    evalTier: integer("eval_tier").notNull(),
    estimatedHours: real("estimated_hours").notNull(),
    /** { pInit, pLearn, pSlip, pGuess } — expert-seeded, refit from data later. */
    bktPriors: jsonb("bkt_priors").notNull(),
    /** "Write a SQL query joining 3 tables with correct grain" — §14.4 */
    canDoStatement: text("can_do_statement").notNull(),
    observableEvidence: jsonb("observable_evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("skill_pack_slug_idx").on(t.packId, t.slug)],
);

/**
 * §14.4 — `hard` = cannot learn without. `soft` = easier with. The planner
 * treats them very differently (§16.1). Cycle-checked at pack build time;
 * a cycle is a build failure, not a warning.
 */
export const skillDependency = pgTable(
  "skill_dependency",
  {
    fromSkillId: uuid("from_skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    toSkillId: uuid("to_skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    /** hard | soft */
    type: text("type").notNull(),
    strength: real("strength").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.fromSkillId, t.toSkillId] }),
    index("skill_dependency_to_idx").on(t.toSkillId),
  ],
);

/**
 * §15 — "the single most important table in the system".
 *
 * `mastery` is the stored belief; the *effective* mastery the planner reads is
 * `mastery × 0.5^(daysSinceLastSuccess / decayHalfLifeDays)` (§16.2), computed
 * at read time rather than stored, so it is always current without a cron job.
 */
export const learnerSkillMastery = pgTable(
  "learner_skill_mastery",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    mastery: doublePrecision("mastery").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    evidenceCount: integer("evidence_count").notNull().default(0),
    /**
     * The last *correct* observation, which is the one decay counts from. Not
     * the same as `lastPracticedAt` below: failing a retrieval is practice, and
     * it must not reset the retention clock, or a learner could hold a skill up
     * indefinitely by getting it wrong.
     */
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastPracticedAt: timestamp("last_practiced_at", { withTimezone: true }),
    /** Starts at 7, doubles on each successful spaced retrieval, capped at 180. */
    decayHalfLifeDays: real("decay_half_life_days").notNull().default(7),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.skillId] }),
    index("learner_skill_mastery_user_idx").on(t.userId),
  ],
);
