import {
  boolean,
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

/**
 * §15 — everything indexable is DB-driven and statically rendered, so SEO pages
 * are deterministic, diffable, reviewable and cacheable.
 *
 * `indexable` defaults to **false** (§12.1). The sitemap only ever contains
 * `indexable: true` rows — that single rule is the crawl-budget control.
 */
export const seoPage = pgTable(
  "seo_page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    /** learn | check | project | guide | roadmap | tool | proof */
    pageType: text("page_type").notNull(),
    locale: text("locale").notNull().default("en"),
    title: text("title").notNull(),
    metaDescription: text("meta_description").notNull(),
    h1: text("h1").notNull(),
    sections: jsonb("sections").notNull(),
    qualityScore: real("quality_score"),
    indexable: boolean("indexable").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    canonicalOf: uuid("canonical_of"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("seo_page_slug_locale_idx").on(t.slug, t.locale),
    index("seo_page_indexable_idx").on(t.indexable),
  ],
);

export const learningTopic = pgTable(
  "learning_topic",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    skillIds: jsonb("skill_ids"),
    relatedTopicIds: jsonb("related_topic_ids"),
    searchIntent: text("search_intent"),
    estimatedHours: real("estimated_hours"),
  },
  (t) => [uniqueIndex("learning_topic_slug_idx").on(t.slug)],
);

/** §2.6 — volumes and difficulty are *bands*, never laundered as exact figures. */
export const searchIntent = pgTable("search_intent", {
  id: uuid("id").primaryKey().defaultRandom(),
  keyword: text("keyword").notNull(),
  volumeBand: text("volume_band"),
  difficultyBand: text("difficulty_band"),
  /** article | tool | forum — only target terms where a tool out-serves intent. */
  serpType: text("serp_type"),
  targetPageId: uuid("target_page_id").references(() => seoPage.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

export const faq = pgTable("faq", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: uuid("page_id")
    .notNull()
    .references(() => seoPage.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  order: integer("order").notNull(),
});

/** §13.3 — typed edges, rendered contextually. Every page: ≥4 out, ≥2 in. */
export const internalLink = pgTable(
  "internal_link",
  {
    fromPageId: uuid("from_page_id")
      .notNull()
      .references(() => seoPage.id, { onDelete: "cascade" }),
    toPageId: uuid("to_page_id")
      .notNull()
      .references(() => seoPage.id, { onDelete: "cascade" }),
    /** prerequisite | next_step | related | project_for | check_for */
    linkType: text("link_type").notNull(),
    anchorText: text("anchor_text").notNull(),
  },
  // The edge *is* the identity: one link of a given type between two pages.
  // A composite primary key both enforces that and gives the row an address —
  // a table with no primary key cannot be updated or replicated safely.
  (t) => [primaryKey({ columns: [t.fromPageId, t.toPageId, t.linkType] })],
);

/**
 * §8 screen 12 — the only public per-learner surface. `noindex` until it passes
 * the §12 quality gate: ≥3 evaluated artefacts, ≥1 completed project, and a
 * non-trivial written reflection.
 */
export const publicLearningPath = pgTable(
  "public_learning_path",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => learningGoal.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    /** private (default) | unlisted | public */
    visibility: text("visibility").notNull().default("private"),
    gatePassed: boolean("gate_passed").notNull().default(false),
    viewCount: integer("view_count").notNull().default(0),
    redactions: jsonb("redactions"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("public_learning_path_slug_idx").on(t.userId, t.slug)],
);
