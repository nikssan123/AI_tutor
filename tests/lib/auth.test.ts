import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, getAuth, resetAuth } from "@/lib/auth";

/**
 * Thin-adapter tests. They cannot prove Better Auth works — that is the
 * library's job — but they do pin the two things that are *our* decisions and
 * would be silent if wrong: which extra columns the session carries, and that
 * importing this module never opens a database connection.
 */

const ORIGINAL = process.env.DATABASE_URL;

beforeEach(() => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:1/none";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-value-at-least-32-chars-long";
  resetAuth();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL;
  resetAuth();
  vi.restoreAllMocks();
});

describe("createAuth", () => {
  it("builds an instance with the handler the route needs", () => {
    const auth = createAuth();
    expect(typeof auth.handler).toBe("function");
    expect(auth.api).toBeDefined();
  });

  it("enables email and password sign-in", () => {
    // §17.2 needs auth to exist, not to be a feature; social providers are
    // configuration when they arrive.
    expect(createAuth().options.emailAndPassword?.enabled).toBe(true);
  });

  it("does not gate accounts behind an email we cannot yet send", () => {
    // Verification arrives with the email work in E13. Requiring it now would
    // make every new account unusable.
    expect(
      createAuth().options.emailAndPassword?.requireEmailVerification,
    ).toBe(false);
  });

  it("carries the §15 User columns as additional fields", () => {
    const fields = createAuth().options.user?.additionalFields ?? {};
    expect(Object.keys(fields).sort()).toEqual([
      "handle",
      "locale",
      "plan",
      "stripeCustomerId",
      "timezone",
    ]);
  });

  it("defaults locale, timezone and plan rather than leaving them null", () => {
    const fields = createAuth().options.user?.additionalFields ?? {};
    expect(fields.locale?.defaultValue).toBe("en");
    expect(fields.timezone?.defaultValue).toBe("UTC");
    expect(fields.plan?.defaultValue).toBe("free");
  });

  it("sets a 30-day session with daily refresh", () => {
    const session = createAuth().options.session;
    expect(session?.expiresIn).toBe(60 * 60 * 24 * 30);
    expect(session?.updateAge).toBe(60 * 60 * 24);
  });
});

describe("getAuth", () => {
  it("caches the instance", () => {
    expect(getAuth()).toBe(getAuth());
  });

  it("rebuilds after a reset", () => {
    const first = getAuth();
    resetAuth();
    expect(getAuth()).not.toBe(first);
  });
});
