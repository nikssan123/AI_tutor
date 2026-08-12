import {
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
