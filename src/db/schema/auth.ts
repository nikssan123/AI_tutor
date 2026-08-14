import {
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Better Auth core tables (§18.1 — self-hosted, owns its own tables, no per-MAU cost).
 *
 * The `user` table carries the §15 `User` fields as additional columns
 * (handle, locale, timezone, plan, stripeCustomerId) rather than living in a
 * side table, because every one of them is read on nearly every request.
 */
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),

    // §15 User — additional fields, surfaced through Better Auth `additionalFields`.
    handle: text("handle"),
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone").notNull().default("UTC"),

    /**
     * The appearance choice, kept here for the same reason `locale` is: it is
     * read at *send* time, in a job or a callback that has no browser attached
     * to it.
     *
     * The toggle already writes `localStorage` and a cookie, and both are
     * enough for the page the person is looking at. Neither survives the trip
     * to an email — a password reset is composed from whatever request asked
     * for it, and an operator's support reply is composed from the operator's
     * browser, so a cookie would theme a stranger's mail with the wrong
     * person's preference. `"system"` is not a missing answer; it is the
     * answer, and it means the mail hands the decision to the reader's client.
     */
    theme: text("theme").notNull().default("system"),
    plan: text("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),

    /**
     * Authorization for `/admin`. A string rather than an `isAdmin` boolean
     * because the second role we need is "read-only support", not a second
     * god-mode — and a boolean cannot express that without a second migration.
     *
     * Defaults to `user`, is never null, and is not writable by the account it
     * belongs to: `src/lib/auth.ts` marks it `input: false` so it cannot be set
     * through sign-up or update-user. Granting it is a deliberate act performed
     * by `pnpm admin:grant`.
     */
    role: text("role").notNull().default("user"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("user_email_idx").on(t.email),
    // Handles are optional but must be unique when set — they appear in the
    // public Proof Page URL `/p/{handle}/{slug}` (§8, screen 12).
    uniqueIndex("user_handle_idx").on(t.handle),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("session_token_idx").on(t.token)],
);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
