import { describe, expect, it } from "vitest";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE,
  REFERRAL_COOKIE_OPTIONS,
} from "@/lib/referral/cookie";

/**
 * The referral cookie.
 *
 * Constants, but load-bearing ones: `/r/[code]` writes this and the Better Auth
 * `user.create.after` hook reads it, and the two agreeing is the whole
 * attribution mechanism. A silent rename in one of them loses every referral
 * and nothing fails.
 */

describe("REFERRAL_COOKIE", () => {
  it("is the name both sides use", () => {
    expect(REFERRAL_COOKIE).toBe("mk_ref");
  });
});

describe("REFERRAL_COOKIE_OPTIONS", () => {
  it("lasts ninety days", () => {
    // Long enough to survive "I'll sign up after pay day"; short enough that a
    // shared laptop does not carry one person's code into a stranger's signup.
    expect(REFERRAL_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 90);
    expect(REFERRAL_COOKIE_OPTIONS.maxAge).toBe(REFERRAL_COOKIE_MAX_AGE);
  });

  it("is unreadable from the browser", () => {
    // Nothing client-side needs it — it is spent on the server at the moment
    // an account is created.
    expect(REFERRAL_COOKIE_OPTIONS.httpOnly).toBe(true);
  });

  it("survives arriving from another site", () => {
    // `lax` rather than `strict`: the entire point is that somebody follows a
    // link from WhatsApp or a DM, and `strict` would drop the cookie on that
    // first cross-site navigation.
    expect(REFERRAL_COOKIE_OPTIONS.sameSite).toBe("lax");
  });

  it("applies to the whole site", () => {
    expect(REFERRAL_COOKIE_OPTIONS.path).toBe("/");
  });
});
