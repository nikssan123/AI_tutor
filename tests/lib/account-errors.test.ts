import { describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

const { accountError, accountOk, explain, isHandleTaken, messageForCode } =
  await import("@/lib/account/errors");

describe("explain", () => {
  it("replaces Better Auth's terse codes with something actionable", () => {
    // "Session is not fresh" is the right register for an API and the wrong one
    // for someone who just wants to know what to do next.
    const error = new APIError("FORBIDDEN", {
      code: "SESSION_NOT_FRESH",
      message: "Session is not fresh",
    });

    expect(explain(error, "fallback")).toMatch(/sign out and back in/i);
  });

  it("tells someone with no password why unlinking is refused", () => {
    const error = new APIError("BAD_REQUEST", {
      code: "FAILED_TO_UNLINK_LAST_ACCOUNT",
      message: "You can't unlink your last account",
    });

    expect(explain(error, "fallback")).toMatch(/set a password first/i);
  });

  it("passes through a message it has no better version of", () => {
    const error = new APIError("BAD_REQUEST", { message: "Email is the same" });
    expect(explain(error, "fallback")).toBe("Email is the same");
  });

  it("falls back when the error carries no message at all", () => {
    expect(explain(new APIError("BAD_REQUEST", {}), "fallback")).toBe("fallback");
    expect(explain(new APIError("BAD_REQUEST", { message: "" }), "f")).toBe("f");
    expect(explain(new APIError("BAD_REQUEST", { code: "WHO_KNOWS" }), "f")).toBe(
      "f",
    );
  });

  it("falls back for anything that isn't an APIError", () => {
    expect(explain(new Error("boom"), "fallback")).toBe("fallback");
    expect(explain(undefined, "fallback")).toBe("fallback");
    expect(explain("a string", "fallback")).toBe("fallback");
  });
});

describe("isHandleTaken", () => {
  it("recognises Postgres' unique violation, raw or wrapped", () => {
    // The uniqueness rule lives in an index, not in Better Auth, so a taken
    // handle arrives as a driver error rather than as an APIError.
    expect(isHandleTaken({ code: "23505" })).toBe(true);
    expect(isHandleTaken({ cause: { code: "23505" } })).toBe(true);
  });

  it("is not fooled by other errors", () => {
    expect(isHandleTaken({ code: "23503" })).toBe(false);
    expect(isHandleTaken(new Error("boom"))).toBe(false);
    expect(isHandleTaken(null)).toBe(false);
    expect(isHandleTaken(undefined)).toBe(false);
  });

  it("is what explain reports first", () => {
    expect(explain({ code: "23505" }, "fallback")).toMatch(/handle is taken/i);
  });
});

describe("messageForCode", () => {
  it("translates a code that arrived in a query string", () => {
    // Better Auth's own callbacks redirect with ?error=TOKEN_EXPIRED, so the
    // page has to translate with no error object in hand.
    expect(messageForCode("TOKEN_EXPIRED", "fallback")).toMatch(/expired/i);
  });

  it("falls back for anything it doesn't recognise", () => {
    // Which is how the pages let a finished sentence through untouched: they
    // pass the query value as its own fallback.
    const sentence = "Those two passwords don't match.";
    expect(messageForCode(sentence, sentence)).toBe(sentence);
    expect(messageForCode("WHO_KNOWS", "fallback")).toBe("fallback");
    expect(messageForCode(undefined, "fallback")).toBe("fallback");
  });
});

describe("accountOk / accountError", () => {
  it("carry the sentence in the query string", () => {
    // Messages travel in the URL rather than component state, which is what
    // lets /account be a server-rendered page with no client JS.
    expect(() => accountOk("Saved.")).toThrow("REDIRECT:/account?ok=Saved.");
    expect(() => accountError("Nope.")).toThrow("REDIRECT:/account?error=Nope.");
  });

  it("encode a message containing URL syntax", () => {
    expect(() => accountOk("a&b=c")).toThrow("REDIRECT:/account?ok=a%26b%3Dc");
  });
});
