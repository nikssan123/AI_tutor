import { describe, expect, it } from "vitest";
import {
  DEFAULT_FROM,
  DEFAULT_SUPPORT_FROM,
  formatMailbox,
  isEmailAddress,
  parseMailbox,
  plusAddress,
  supportFrom,
  systemFrom,
  threadIdFromRecipients,
  threadReplyAddress,
} from "@/lib/email/addresses";

/**
 * Addresses, and the token that makes a reply find its conversation.
 *
 * The threading tests are the ones that matter: get `threadIdFromRecipients`
 * wrong in one direction and every reply starts a new thread, and in the other
 * a stranger's mail lands inside someone else's support conversation.
 */

const ENV = { EMAIL_SUPPORT_FROM: "MeritKeep <support@meritkeep.com>" };

describe("parseMailbox", () => {
  it.each([
    ["MeritKeep <hello@meritkeep.com>", "MeritKeep", "hello@meritkeep.com"],
    ['"Ana Ivanova" <ana@x.co>', "Ana Ivanova", "ana@x.co"],
    ["  <bare@x.co>  ", null, "bare@x.co"],
    ["plain@x.co", null, "plain@x.co"],
    ["  spaced@x.co  ", null, "spaced@x.co"],
  ])("reads %o", (value, name, address) => {
    expect(parseMailbox(value)).toEqual({ name, address });
  });
});

describe("formatMailbox", () => {
  it("round-trips a named mailbox", () => {
    const value = "MeritKeep <support@meritkeep.com>";
    expect(formatMailbox(parseMailbox(value))).toBe(value);
  });

  it("leaves a bare address bare", () => {
    expect(formatMailbox({ name: null, address: "a@b.co" })).toBe("a@b.co");
  });
});

describe("isEmailAddress", () => {
  it.each([["a@b.co"], ["first.last+tag@sub.example.com"], [" a@b.co "]])(
    "accepts %o",
    (value) => {
      expect(isEmailAddress(value)).toBe(true);
    },
  );

  it.each([[""], ["a@b"], ["ab.co"], ["a b@c.co"], ["a@b.co, c@d.co"], ["@b.co"]])(
    "rejects %o",
    (value) => {
      expect(isEmailAddress(value)).toBe(false);
    },
  );
});

describe("the two mailboxes", () => {
  it("falls back to a meritkeep.com default when nothing is configured", () => {
    expect(systemFrom({})).toBe(DEFAULT_FROM);
    expect(supportFrom({})).toBe(DEFAULT_SUPPORT_FROM);
  });

  it("reads its own variable first", () => {
    expect(systemFrom({ EMAIL_FROM: "A <a@b.co>" })).toBe("A <a@b.co>");
    expect(supportFrom({ EMAIL_SUPPORT_FROM: "S <s@b.co>" })).toBe("S <s@b.co>");
  });

  it("lets support fall through to the system address", () => {
    // One configured address is a legitimate setup; two mailboxes is the
    // recommendation, not a requirement.
    expect(supportFrom({ EMAIL_FROM: "A <a@b.co>" })).toBe("A <a@b.co>");
  });

  it("reads the real environment by default", () => {
    expect(systemFrom()).toBeTruthy();
    expect(supportFrom()).toBeTruthy();
  });
});

describe("plusAddress", () => {
  it("tags the local part", () => {
    expect(plusAddress("support@meritkeep.com", "abc")).toBe(
      "support+abc@meritkeep.com",
    );
  });

  it("leaves something that is not an address alone", () => {
    expect(plusAddress("not-an-address", "abc")).toBe("not-an-address");
  });
});

describe("threadReplyAddress", () => {
  it("keeps the display name and tags the address", () => {
    // A bare `support+9f3c…@` in a client's "to" field looks like a machine
    // address nobody should write to, which is the opposite of the point.
    expect(threadReplyAddress("t1", ENV)).toBe(
      "MeritKeep <support+t1@meritkeep.com>",
    );
  });
});

describe("threadIdFromRecipients", () => {
  const id = "9f3c1e2a-4b5d-4c6e-8f70-112233445566";

  it("finds the token on the support address", () => {
    expect(
      threadIdFromRecipients([`support+${id}@meritkeep.com`], ENV),
    ).toBe(id);
  });

  it("finds it among several recipients, and through a display name", () => {
    expect(
      threadIdFromRecipients(
        ["someone@else.com", `MeritKeep <SUPPORT+${id.toUpperCase()}@MeritKeep.com>`],
        ENV,
      ),
    ).toBe(id);
  });

  it.each([
    ["no token at all", ["support@meritkeep.com"]],
    ["a token that is not a uuid", ["support+42@meritkeep.com"]],
    ["two plus signs", [`support+a+${"b"}@meritkeep.com`]],
    ["another domain", [`support+${"9f3c1e2a-4b5d-4c6e-8f70-112233445566"}@evil.com`]],
    ["another local part", [`sales+9f3c1e2a-4b5d-4c6e-8f70-112233445566@meritkeep.com`]],
    ["nothing", []],
  ])("returns null for %s", (_name, recipients) => {
    // The local-part check is what stops a thread token pasted into a CC on an
    // unrelated address from pulling a stranger's mail into a conversation.
    expect(threadIdFromRecipients(recipients, ENV)).toBeNull();
  });

  it("reads the real environment by default", () => {
    expect(threadIdFromRecipients([])).toBeNull();
  });
});
