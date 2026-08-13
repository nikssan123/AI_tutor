import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema } from "@/db";
import type { EnvLike } from "@/lib/env-types";
import { siteUrl } from "@/lib/site";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-shared";
import {
  changeEmailMessage,
  deliver,
  resetPasswordMessage,
  verifyEmailMessage,
} from "@/lib/email";

/**
 * §18.1 — Better Auth, self-hosted and Postgres-backed. No per-MAU cost, owns
 * its own tables, TypeScript-native.
 *
 * Email and password, plus Google when it is configured. Everything that needs
 * an email — verification, password reset, changing an address — goes through
 * `@/lib/email`, which prints to the console until `RESEND_API_KEY` exists, so
 * none of these flows are dark in development.
 */

/**
 * A verification link lasts a day, a reset link an hour.
 *
 * The asymmetry is deliberate. A verification link proves an address exists;
 * losing that race costs a resend. A reset link *is* the account for as long as
 * it is valid, and it usually sits in a mailbox someone else may later read, so
 * it gets the shortest window a person can still act inside.
 */
export const VERIFICATION_TTL_SECONDS = 60 * 60 * 24;
export const RESET_TTL_SECONDS = 60 * 60;

/*
 * Re-exported, not redefined: the sign-in form is a Client Component and cannot
 * import this module — the Drizzle adapter below would take `@/db` into the
 * browser bundle with it. Server code keeps importing them from here.
 */
export { MIN_PASSWORD_LENGTH, VERIFY_CALLBACK } from "@/lib/auth-shared";

/**
 * The origin Better Auth builds its links against.
 *
 * One source of truth, because these strings end up in emails: a wrong value
 * here is not a broken page someone reloads, it is a dead link in a message
 * that has already been delivered and cannot be edited. `BETTER_AUTH_URL` wins
 * so the auth origin can be pinned independently, and everything else falls
 * through to the canonical site origin (§13.3) rather than to a second default.
 */
export function authBaseUrl(env: EnvLike = process.env): string {
  const configured = env.BETTER_AUTH_URL;
  return configured ? configured.replace(/\/$/, "") : siteUrl(env);
}

/**
 * Google is configuration, not code — but it is configuration that must be
 * *absent* rather than blank when it is unset. An empty client id registers a
 * provider that fails at the redirect with an opaque Google error page, which
 * is a worse outcome than a sign-in screen that simply does not offer it.
 */
export function googleEnabled(env: EnvLike = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function socialProviders(env: EnvLike) {
  if (!googleEnabled(env)) return {};

  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      // Someone who signed in with the wrong Google account has no way back if
      // Google silently reuses its own session; the picker is the escape hatch.
      prompt: "select_account" as const,
    },
  };
}

export function createAuth(env: EnvLike = process.env) {
  return betterAuth({
    baseURL: authBaseUrl(env),
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
      /**
       * Verification is sent, but not required to sign in.
       *
       * §8's whole shape is "show value first" — the diagnostic runs before
       * signup, and the screen after signup is the plan. Putting an inbox
       * round-trip in the middle of that is where people leave. So an
       * unverified account works, and `/account` says, in words, what it
       * cannot do yet: recover itself.
       *
       * Flipping this to `true` is a one-line policy change if abuse ever
       * makes it worth the funnel.
       */
      requireEmailVerification: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,

      sendResetPassword: ({ user, url }) =>
        deliver(
          resetPasswordMessage({
            to: user.email,
            url,
            expiresIn: RESET_TTL_SECONDS,
          }),
        ).then(() => undefined),
      resetPasswordTokenExpiresIn: RESET_TTL_SECONDS,

      /**
       * A reset is what someone does *after* losing control of an account, so
       * it has to end every session the thief is holding. Better Auth defaults
       * this off, which leaves the attacker signed in on their own machine
       * while the owner congratulates themselves on a new password.
       */
      revokeSessionsOnPasswordReset: true,
    },

    emailVerification: {
      sendVerificationEmail: ({ user, url }) =>
        deliver(
          verifyEmailMessage({
            to: user.email,
            url,
            expiresIn: VERIFICATION_TTL_SECONDS,
          }),
        ).then(() => undefined),
      /**
       * Explicitly `true`: left undefined it follows `requireEmailVerification`,
       * which is `false` here — so the default would send nothing at all and the
       * whole flow would exist without ever being triggered.
       */
      sendOnSignUp: true,
      // Clicking the link in the mail client signs you in there. Someone who
      // verifies on their phone should land in the product, not on a login form.
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_TTL_SECONDS,
    },

    user: {
      /**
       * `input: false` is load-bearing, not decoration.
       *
       * Better Auth accepts additional fields from the client by default —
       * `RemoveFieldsWithInputFalse` in `better-auth/dist/db/field.d.mts` is
       * what strips a field from the sign-up and update-user payloads, and it
       * only applies when you opt in. Without it, `POST /api/auth/sign-up/email`
       * with `{"role":"admin"}` promotes the caller, and `{"plan":"pro"}` hands
       * out a paid plan for free.
       *
       * So the rule here: a field the *account holder* owns (handle, locale,
       * timezone) stays writable. A field that grants access or costs money is
       * server-owned and must be `input: false`.
       */
      additionalFields: {
        handle: { type: "string", required: false },
        locale: { type: "string", required: false, defaultValue: "en" },
        timezone: { type: "string", required: false, defaultValue: "UTC" },
        plan: {
          type: "string",
          required: false,
          defaultValue: "free",
          input: false,
        },
        stripeCustomerId: { type: "string", required: false, input: false },
        role: {
          type: "string",
          required: false,
          defaultValue: "user",
          input: false,
        },
      },

      changeEmail: {
        enabled: true,
        /**
         * The approval mail goes to the address being *left behind*.
         *
         * That is the whole security property. A stolen session can ask to move
         * an account to the thief's inbox, and the only thing that stops it is
         * that the request has to be approved from the address the real owner
         * still reads. It also means that mail is how an owner finds out — so
         * it tells them to change their password, not merely to ignore it.
         */
        sendChangeEmailConfirmation: ({ user, newEmail, url }) =>
          deliver(
            changeEmailMessage({
              to: user.email,
              newEmail,
              url,
              expiresIn: VERIFICATION_TTL_SECONDS,
            }),
          ).then(() => undefined),
      },
    },

    account: {
      accountLinking: {
        enabled: true,
        /**
         * Google is trusted to have verified the address it hands us, so
         * signing in with Google lands on the existing account rather than
         * failing with "account not linked".
         *
         * `requireLocalEmailVerified` stays `true` — Better Auth's own default,
         * pinned here because it is the thing that closes the takeover: without
         * it, anyone can register `victim@gmail.com` with a password, never
         * verify it, and wait for the real owner to sign in with Google — at
         * which point the two are linked and the attacker's password still
         * works on the victim's account.
         */
        trustedProviders: ["google"],
        requireLocalEmailVerified: true,
      },
    },

    socialProviders: socialProviders(env),

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },

    /**
     * Lets `auth.api.*` set and clear cookies when it is called from a Server
     * Action — which is what makes sign-out, and every form on `/account`,
     * work without shipping the client SDK to those routes. Must stay last:
     * the plugin wraps whatever ran before it.
     */
    plugins: [nextCookies()],
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
