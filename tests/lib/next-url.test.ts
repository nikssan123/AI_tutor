import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESTINATION,
  safeDestination,
  withDestination,
} from "@/lib/account/next-url";

/**
 * A `?next=` a visitor can set is a `?next=` an attacker can set. The whole
 * value of this module is what it *refuses*, so that is what is tested hardest:
 * "sign in on the real domain, then get sent to a fake one" is the phishing
 * hand-off an unchecked redirect parameter hands out for free.
 */
describe("safeDestination", () => {
  it("keeps a same-site path, including its query", () => {
    expect(safeDestination("/start?topic=basket%20weaving")).toBe(
      "/start?topic=basket%20weaving",
    );
  });

  it("falls back when nothing was asked for", () => {
    expect(safeDestination(undefined)).toBe(DEFAULT_DESTINATION);
    expect(safeDestination(null)).toBe(DEFAULT_DESTINATION);
    expect(safeDestination("")).toBe(DEFAULT_DESTINATION);
  });

  it("refuses an absolute URL", () => {
    expect(safeDestination("https://evil.example/login")).toBe(
      DEFAULT_DESTINATION,
    );
  });

  it("refuses a bare hostname, which the browser reads as off-site", () => {
    expect(safeDestination("evil.example")).toBe(DEFAULT_DESTINATION);
  });

  it("refuses a protocol-relative URL — the one that looks like a path", () => {
    // `//evil.example` starts with a slash and is a different origin. This is
    // the check a hand-rolled `startsWith("/")` guard always misses.
    expect(safeDestination("//evil.example")).toBe(DEFAULT_DESTINATION);
  });

  it("refuses a backslash, which browsers normalise into that same URL", () => {
    expect(safeDestination("/\\evil.example")).toBe(DEFAULT_DESTINATION);
  });

  it("refuses control characters, which are header injection in a Location", () => {
    expect(safeDestination("/start\r\nSet-Cookie: a=b")).toBe(
      DEFAULT_DESTINATION,
    );
    expect(safeDestination("/start\x7f")).toBe(DEFAULT_DESTINATION);
  });

  it("refuses a parameter long enough to be used as a payload", () => {
    expect(safeDestination(`/start?topic=${"x".repeat(700)}`)).toBe(
      DEFAULT_DESTINATION,
    );
  });

  it("allows a path right up to the limit", () => {
    const path = `/${"x".repeat(599)}`;
    expect(path).toHaveLength(600);
    expect(safeDestination(path)).toBe(path);
  });
});

describe("withDestination", () => {
  it("appends the destination, encoded", () => {
    expect(withDestination("/sign-in", "/start?topic=basket weaving")).toBe(
      "/sign-in?next=%2Fstart%3Ftopic%3Dbasket%20weaving",
    );
  });

  it("joins with & when the screen already has a query", () => {
    expect(withDestination("/sign-up?error=nope", "/start?topic=rust")).toBe(
      "/sign-up?error=nope&next=%2Fstart%3Ftopic%3Drust",
    );
  });

  it("leaves the parameter off when the destination is the default", () => {
    // `?next=/today` in the address bar is noise and one more thing to keep
    // in step across five screens.
    expect(withDestination("/sign-in", DEFAULT_DESTINATION)).toBe("/sign-in");
  });

  it("drops a hostile destination rather than passing it along", () => {
    expect(withDestination("/sign-in", "https://evil.example")).toBe("/sign-in");
  });
});
