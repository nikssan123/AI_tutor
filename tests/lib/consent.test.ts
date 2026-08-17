import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE,
  CONSENT_COOKIE_OPTIONS,
  posthogCookieName,
  toConsent,
} from "@/lib/consent/cookie";

/**
 * The one question this site asks, and what happens to the answer.
 *
 * The assertions that earn their place are the ones about withdrawal. A "no"
 * that only stops future measurement, while last month's id sits on the device,
 * is a pause dressed as a withdrawal — and the visitor has no way to tell the
 * difference, which is precisely why it has to be pinned in a test.
 */

const jar = {
  get: vi.fn<(name: string) => { value: string } | undefined>(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({ cookies: async () => jar }));

const { setConsentAction } = await import("@/lib/consent/actions");

function form(value?: string): FormData {
  const data = new FormData();
  if (value !== undefined) data.set("consent", value);
  return data;
}

beforeEach(() => {
  jar.get.mockReset();
  jar.set.mockReset();
  jar.delete.mockReset();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
});

describe("toConsent", () => {
  it("reads the two answers", () => {
    expect(toConsent("granted")).toBe("granted");
    expect(toConsent("denied")).toBe("denied");
  });

  /**
   * Unanswered, not refused. A truncated or hand-edited cookie should put the
   * question back to the visitor rather than quietly answering it for them —
   * in either direction, since "denied" would suppress the banner forever on a
   * corrupted value and "granted" would be consent nobody gave.
   */
  it("treats anything else as unanswered", () => {
    for (const value of ["", "yes", "true", "GRANTED", null, undefined]) {
      expect(toConsent(value)).toBeUndefined();
    }
  });
});

describe("the cookie itself", () => {
  it("is unreadable from the browser, because nothing there reads it", () => {
    expect(CONSENT_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(CONSENT_COOKIE_OPTIONS.path).toBe("/");
  });

  it("gives both answers the same life", () => {
    // Six months. A shorter "no" than "yes" is a banner that comes back sooner
    // for the people who declined, which is a nudge however it is described.
    expect(CONSENT_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 180);
  });

  it("derives the analytics cookie name the way posthog-js does", () => {
    expect(posthogCookieName("phc_test")).toBe("ph_phc_test_posthog");
  });
});

describe("setConsentAction", () => {
  it("records a yes and leaves the analytics cookie alone", async () => {
    await setConsentAction(form("granted"));
    expect(jar.set).toHaveBeenCalledWith(
      CONSENT_COOKIE,
      "granted",
      CONSENT_COOKIE_OPTIONS,
    );
    expect(jar.delete).not.toHaveBeenCalled();
  });

  it("removes the analytics cookie when the answer is no", async () => {
    await setConsentAction(form("denied"));
    expect(jar.set).toHaveBeenCalledWith(
      CONSENT_COOKIE,
      "denied",
      CONSENT_COOKIE_OPTIONS,
    );
    expect(jar.delete).toHaveBeenCalledWith("ph_phc_test_posthog");
  });

  it("has nothing to remove when no analytics is configured", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    await setConsentAction(form("denied"));
    expect(jar.set).toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });

  /**
   * A posted value that is neither word decides nothing — the banner is still
   * on the page and still asking. Writing "denied" here would let a malformed
   * POST silently answer for somebody.
   */
  it("writes nothing for a value it does not recognise", async () => {
    await setConsentAction(form("maybe"));
    await setConsentAction(form());
    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });
});
