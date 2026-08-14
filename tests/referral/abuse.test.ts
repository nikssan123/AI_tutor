import { describe, expect, it } from "vitest";
import {
  canonicalEmail,
  checkAttribution,
  COLLISION_WINDOW_HOURS,
  hashSignal,
  REJECTION_REASONS,
  RULES_ENFORCED_ELSEWHERE,
} from "@/lib/referral/abuse";

/**
 * The abuse rules.
 *
 * Two directions matter equally here and the second is easier to forget: these
 * must refuse the obvious schemes, and they must **not** refuse two real people
 * in one office. Every rule below is tested from both ends for that reason.
 */

const NOW = new Date("2026-08-15T12:00:00.000Z");
const hours = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

const check = (over: Partial<Parameters<typeof checkAttribution>[0]> = {}) =>
  checkAttribution({
    referrerId: "referrer",
    refereeId: "referee",
    referrerEmail: "ana@example.com",
    refereeEmail: "bo@example.com",
    refereeIpHash: null,
    refereeUaHash: null,
    referrerIpHash: null,
    referrerUaHash: null,
    referrerSignupAt: null,
    now: NOW,
    ...over,
  });

describe("canonicalEmail", () => {
  it("lowercases and trims", () => {
    expect(canonicalEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });

  it("strips a plus tag", () => {
    // The cheapest self-referral there is.
    expect(canonicalEmail("ana+referral@example.com")).toBe("ana@example.com");
  });

  it("strips dots on Gmail, because Gmail ignores them", () => {
    expect(canonicalEmail("a.n.a@gmail.com")).toBe("ana@gmail.com");
    expect(canonicalEmail("a.n.a@googlemail.com")).toBe("ana@googlemail.com");
  });

  it("keeps dots everywhere else", () => {
    // Plenty of providers treat first.last@ and firstlast@ as two people, and
    // merging them would refuse a real referral.
    expect(canonicalEmail("first.last@example.com")).toBe(
      "first.last@example.com",
    );
  });

  it("leaves something that is not an address alone", () => {
    expect(canonicalEmail("nonsense")).toBe("nonsense");
    expect(canonicalEmail("@example.com")).toBe("@example.com");
  });
});

describe("hashSignal", () => {
  it("is stable for the same input and pepper", () => {
    expect(hashSignal("1.2.3.4", "p")).toBe(hashSignal("1.2.3.4", "p"));
  });

  it("differs under a different pepper", () => {
    // A dumped table cannot be rainbow-tabled back into a list of addresses.
    expect(hashSignal("1.2.3.4", "p")).not.toBe(hashSignal("1.2.3.4", "q"));
  });

  it("never contains the value it hashed", () => {
    expect(hashSignal("1.2.3.4", "p")).not.toContain("1.2.3.4");
  });

  it.each([[null], [undefined], [""]])("is null for %s", (value) => {
    expect(hashSignal(value, "p")).toBeNull();
  });
});

describe("checkAttribution", () => {
  it("accepts two unrelated people", () => {
    expect(check()).toEqual({ ok: true });
  });

  describe("self-referral", () => {
    it("refuses the same account", () => {
      expect(check({ refereeId: "referrer" })).toEqual({
        ok: false,
        reason: "self_referral",
      });
    });

    it("refuses a plus-tagged alias of the referrer's own address", () => {
      expect(
        check({ refereeEmail: "ana+again@example.com" }),
      ).toEqual({ ok: false, reason: "self_referral" });
    });

    it("refuses a dotted Gmail alias", () => {
      expect(
        check({
          referrerEmail: "ana@gmail.com",
          refereeEmail: "a.n.a@gmail.com",
        }),
      ).toEqual({ ok: false, reason: "self_referral" });
    });

    it("allows two different people at the same domain", () => {
      expect(
        check({
          referrerEmail: "ana@company.com",
          refereeEmail: "bo@company.com",
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("shared signals", () => {
    const collided = {
      refereeIpHash: "ip",
      refereeUaHash: "ua",
      referrerIpHash: "ip",
      referrerUaHash: "ua",
      referrerSignupAt: hours(1),
    };

    it("refuses the same machine and browser within the window", () => {
      expect(check(collided)).toEqual({
        ok: false,
        reason: "duplicate_signals",
      });
    });

    it("allows the same office on a different browser", () => {
      // An office shares an IP. Refusing on that alone refuses real people.
      expect(check({ ...collided, refereeUaHash: "other-ua" })).toEqual({
        ok: true,
      });
    });

    it("allows the same browser from a different place", () => {
      // A popular browser on a popular OS produces identical UA strings by the
      // million.
      expect(check({ ...collided, refereeIpHash: "other-ip" })).toEqual({
        ok: true,
      });
    });

    it("allows a collision outside the window", () => {
      expect(
        check({
          ...collided,
          referrerSignupAt: hours(COLLISION_WINDOW_HOURS + 1),
        }),
      ).toEqual({ ok: true });
    });

    it("allows one right at the edge of the window", () => {
      expect(
        check({ ...collided, referrerSignupAt: hours(COLLISION_WINDOW_HOURS) }),
      ).toEqual({ ok: true });
    });

    it("cannot fire when the referrer's own signals were never recorded", () => {
      // Organic signups have no referral row, so there is nothing to compare —
      // the common case, and it must not refuse.
      expect(
        check({ refereeIpHash: "ip", refereeUaHash: "ua" }),
      ).toEqual({ ok: true });
    });

    it("cannot fire on two absent signals matching each other", () => {
      // null === null must not read as "same machine".
      expect(check({ referrerSignupAt: hours(1) })).toEqual({ ok: true });
    });

    it("ignores a referrer who signed up in the future", () => {
      // Clock skew, not fraud.
      expect(
        check({ ...collided, referrerSignupAt: hours(-2) }),
      ).toEqual({ ok: true });
    });
  });
});

describe("the rules that live elsewhere", () => {
  it("names them, so the file about rules lists all of them", () => {
    expect(RULES_ENFORCED_ELSEWHERE).toHaveLength(2);
    expect(RULES_ENFORCED_ELSEWHERE.join(" ")).toMatch(/uniqueIndex/);
    expect(RULES_ENFORCED_ELSEWHERE.join(" ")).toMatch(/invoice\.paid/);
  });

  it("declares a reason for each refusal path", () => {
    expect(REJECTION_REASONS).toContain("self_referral");
    expect(REJECTION_REASONS).toContain("duplicate_signals");
    expect(REJECTION_REASONS).toContain("refunded");
  });
});
