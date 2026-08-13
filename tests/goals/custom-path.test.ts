import { describe, expect, it } from "vitest";
import {
  CUSTOM_PATH_HREF,
  customPathHref,
} from "@/lib/goals/custom-path";

/**
 * The link three screens build. It is one function precisely because a subject
 * that survives two of the three is worse than one that survives none.
 */
describe("customPathHref", () => {
  it("carries the typed subject to the intake", () => {
    expect(customPathHref("quantum error correction")).toBe(
      "/start?topic=quantum%20error%20correction",
    );
  });

  it("encodes what a person actually types", () => {
    // Ampersands and slashes are ordinary in subject names ("SQL & Data
    // Analysis"), and unencoded they truncate the parameter.
    expect(customPathHref("R&D / statistics")).toBe(
      "/start?topic=R%26D%20%2F%20statistics",
    );
  });

  it("sends an empty search to a bare /start rather than ?topic=", () => {
    expect(customPathHref("   ")).toBe(CUSTOM_PATH_HREF);
  });
});
