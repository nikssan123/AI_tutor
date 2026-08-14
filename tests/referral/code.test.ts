import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  CODE_PATTERN,
  generateCode,
  isReferralCode,
  normalizeCode,
} from "@/lib/referral/code";

/**
 * Referral codes.
 *
 * A code is read off a screenshot and typed into a phone, so the tests are
 * about the alphabet and about leniency at the door — not about entropy, which
 * is not the property under threat here.
 */

describe("the alphabet", () => {
  it("excludes the characters that are read wrong", () => {
    // i/l/1 and o/0 are the whole reason a code typed off a photo fails.
    const codes = Array.from({ length: 200 }, () => generateCode()).join("");
    for (const character of ["i", "l", "o", "0", "1"]) {
      expect(codes).not.toContain(character);
    }
  });

  it("is lowercase throughout", () => {
    const code = generateCode();
    expect(code).toBe(code.toLowerCase());
  });
});

describe("generateCode", () => {
  it("is the declared length", () => {
    expect(generateCode()).toHaveLength(CODE_LENGTH);
  });

  it("produces something the pattern accepts", () => {
    for (let i = 0; i < 50; i++) {
      expect(CODE_PATTERN.test(generateCode())).toBe(true);
    }
  });

  it("does not repeat itself in a hundred tries", () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateCode()));
    expect(seen.size).toBe(100);
  });

  it("rejects biased bytes rather than folding them in", () => {
    // 31 does not divide 256, so a plain modulo would over-represent the front
    // of the alphabet. Feeding it only out-of-range bytes first proves the
    // rejection path runs rather than silently wrapping.
    const bytes = [255, 254, 253, 252, 251, 250, 249, 248];
    let call = 0;
    const source = (n: number) =>
      new Uint8Array(
        Array.from({ length: n }, () => (call++ < 8 ? bytes[call - 1]! : 0)),
      );

    const code = generateCode(source);
    expect(code).toHaveLength(CODE_LENGTH);
    // Byte 0 maps to the first letter of the alphabet.
    expect(code).toBe("a".repeat(CODE_LENGTH));
  });
});

describe("isReferralCode", () => {
  it("accepts a code it just made", () => {
    expect(isReferralCode(generateCode())).toBe(true);
  });

  it.each([
    ["short", "abc"],
    ["long", "abcdefghij"],
    ["excluded character", "abcdefgi"],
    ["uppercase", "ABCDEFGH"],
    ["punctuation", "abcd-fgh"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(isReferralCode(value)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}]])("rejects %s", (value) => {
    expect(isReferralCode(value)).toBe(false);
  });
});

describe("normalizeCode", () => {
  it.each([
    ["  ABCD2345 ", "abcd2345"],
    ["@abcd2345", "abcd2345"],
    ["/abcd2345", "abcd2345"],
    ["r/abcd2345", "abcd2345"],
    ["/r/abcd2345", "abcd2345"],
  ])("reads %o as %o", (input, expected) => {
    // People paste the URL and the handle as often as they type the code, and
    // refusing those is refusing a customer over punctuation.
    expect(normalizeCode(input)).toBe(expected);
  });

  it("leaves a plain code alone", () => {
    expect(normalizeCode("abcd2345")).toBe("abcd2345");
  });
});
