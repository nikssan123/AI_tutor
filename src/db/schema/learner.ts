import {
  boolean,
  date,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { domainPack } from "./domain";

export const learnerProfile = pgTable("learner_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  weeklyHours: real("weekly_hours").notNull().default(3),
  preferredSessionLength: real("preferred_session_length").notNull().default(30),
  /**
   * §16.4 — learning styles are captured for UX comfort only and are rejected
   * as an adaptation axis. Nothing in the planner reads this.
   */
  learningStylePrefs: jsonb("learning_style_prefs"),
  constraints: jsonb("constraints"),
  motivation: text("motivation"),
  notificationPrefs: jsonb("notification_prefs"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const learningGoal = pgTable("learning_goal", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  packId: uuid("pack_id").references(() => domainPack.id),
  rawGoalText: text("raw_goal_text").notNull(),
  /** The validated `GoalSpec` from §14.9.2, stored whole. */
  goalSpec: jsonb("goal_spec"),
  targetOutcome: text("target_outcome"),
  deadline: date("deadline"),
  /** active | paused | achieved | abandoned */
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * §8 screen 3's conversation, between requests.
 *
 * A row rather than a cookie, unlike the Skill Check's. The check stores nine
 * answers of one bit each; this holds up to six exchanges of prose, which does
 * not fit in the 4KB a cookie gets — and unlike the check, the learner is
 * already signed in here, so there is a user to key it to and nothing anonymous
 * to protect.
 *
 * One row per learner, replaced when they start again: an abandoned intake is
 * something to resume, not history worth keeping.
 */
export const goalIntake = pgTable("goal_intake", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** `Message[]` — see `goals/analyzer.ts`. */
  messages: jsonb("messages").notNull(),
  /** The analyzer's latest `captured`, so a refresh does not lose the sidebar. */
  captured: jsonb("captured"),
  /** Chips offered with the last question, so a refresh keeps them tappable. */
  chips: jsonb("chips"),
  clarity: real("clarity").notNull().default(0),
  /** Set once the analyzer has closed, so the page shows the handoff. */
  done: boolean("done").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
