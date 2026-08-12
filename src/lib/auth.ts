import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, schema } from "@/db";

/**
 * §18.1 — Better Auth, self-hosted and Postgres-backed. No per-MAU cost, owns
 * its own tables, TypeScript-native.
 *
 * Email and password only for now: §17.2's MVP list needs auth to exist, not to
 * be a feature. Social providers are configuration, not code, when they arrive.
 */
export function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Verification arrives with the email work in E13; until then a new
      // account is usable immediately rather than stuck behind an email we
      // cannot yet send.
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        handle: { type: "string", required: false },
        locale: { type: "string", required: false, defaultValue: "en" },
        timezone: { type: "string", required: false, defaultValue: "UTC" },
        plan: { type: "string", required: false, defaultValue: "free" },
        stripeCustomerId: { type: "string", required: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
  });
}

let cached: ReturnType<typeof createAuth> | undefined;

/** Lazily built so importing this module never opens a database connection. */
export function getAuth(): ReturnType<typeof createAuth> {
  cached ??= createAuth();
  return cached;
}

export function resetAuth(): void {
  cached = undefined;
}
