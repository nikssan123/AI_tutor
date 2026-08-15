import {
  boolean,
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
    /**
     * `human` | `model` | null — §7.1. Null is "nobody has checked this", and
     * it is what `isTopicIndexable` requires a positive value against, so a
     * pack seeded without one cannot reach the index by omission.
     */
    reviewKind: text("review_kind"),
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

/**
 * §7.1's `resource_index` — the vetted external references for a pack.
 *
 * A table rather than a column on `domain_pack`, for the reason skills and items
 * are tables: a link checker updates one row at a time, and the freshness sweep
 * §14.6 wants is a query over rows, not a read-modify-write of a JSON blob that
 * two writers can lose halfway through.
 *
 * `published_at` is text, not a date. It is a date-only string the *source*
 * stated (`2024-03-11`), and putting it through a timestamp column would attach
 * a timezone nobody claimed and shift it by a day depending on where the server
 * is. `checked_at` is a real instant, because we made it.
 */
export const packResource = pgTable(
  "pack_resource",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => domainPack.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    /** Who stands behind it — an institution, a project, or a person. */
    publisher: text("publisher").notNull(),
    /** tutorial | reference | course | book | specification | video | dataset */
    kind: text("kind").notNull(),
    /** Skill ids this covers. Jsonb, as `project.target_skill_ids` already is. */
    skillIds: jsonb("skill_ids").notNull(),
    /** What it is good for and where it stops — never a summary of the page. */
    assessment: text("assessment").notNull(),
    /** YYYY-MM-DD as stated by the source, or null where it states none. */
    publishedAt: text("published_at"),
    /** When the link checker last looked. Null means nobody has. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /**
     * What that check found — a finding with `checked_at` on it, never a claim
     * about right now. Defaults true so a resource seeded before any check is
     * treated as intact rather than as known-dead.
     */
    reachable: boolean("reachable").notNull().default(true),
  },
  (t) => [
    uniqueIndex("pack_resource_pack_slug_idx").on(t.packId, t.slug),
    // The freshness sweep reads by pack; the re-check reads everything stale.
    index("pack_resource_checked_idx").on(t.checkedAt),
  ],
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
