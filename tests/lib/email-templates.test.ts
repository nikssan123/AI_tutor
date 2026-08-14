import { describe, expect, it } from "vitest";
import {
  changeEmailMessage,
  escapeHtml,
  humanDuration,
  resetPasswordMessage,
  verifyCodeMessage,
  verifyEmailMessage,
} from "@/lib/email/templates";

/**
 * The templates are pure, so these are cheap. They are worth having anyway:
 * every assertion below is about a property that is invisible until a real
 * person receives a broken email, by which time the fix ships a day late.
 */

describe("escapeHtml", () => {
  it("neutralises every character that can break out of an attribute", () => {
    expect(escapeHtml(`<a href="x" class='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes the ampersand first, so escapes are not double-escaped", () => {
    // Getting this order wrong turns `&` into `&amp;amp;` on screen.
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("humanDuration", () => {
  it.each([
    [60, "1 minute"],
    [600, "10 minutes"],
    [1, "1 minute"],
    [3600, "1 hour"],
    [7200, "2 hours"],
    [60 * 60 * 24, "24 hours"],
    [60 * 60 * 24 * 3, "3 days"],
  ])("renders %i seconds as %s", (seconds, expected) => {
    expect(humanDuration(seconds)).toBe(expected);
  });

  it("says 24 hours rather than 1 day", () => {
    // "1 day" reads as "some time tomorrow"; 24 hours is a deadline.
    expect(humanDuration(86_400)).toBe("24 hours");
  });
});

describe("every message", () => {
  const cases = [
    verifyEmailMessage({
      to: "a@b.co",
      url: "https://x.test/verify?token=t",
      expiresIn: 3600,
    }),
    resetPasswordMessage({
      to: "a@b.co",
      url: "https://x.test/reset?token=t",
      expiresIn: 3600,
    }),
    changeEmailMessage({
      to: "old@b.co",
      newEmail: "new@b.co",
      url: "https://x.test/verify?token=t",
      expiresIn: 3600,
    }),
  ];

  it.each(cases)("carries a plain-text body as well as HTML ($subject)", (message) => {
    // An HTML-only mail from a young sending domain is a spam signal, and
    // plain text is what a screen reader gets.
    expect(message.text.length).toBeGreaterThan(80);
    expect(message.html).toContain("<div");
  });

  it.each(cases)("prints the raw URL as well as the button ($subject)", (message) => {
    // Corporate clients strip styled anchors often enough that a button-only
    // mail is a dead end for a real share of recipients.
    expect(message.text).toContain("https://x.test/");
    expect(message.html).toContain("Or paste this into your browser");
  });

  it.each(cases)("says how long the link lasts ($subject)", (message) => {
    expect(message.text).toContain("1 hour");
  });

  it.each(cases)("names the product in the subject ($subject)", (message) => {
    expect(message.subject).toContain("MeritKeep");
  });
});

describe("verifyEmailMessage", () => {
  it("tells someone who didn't sign up that ignoring it is safe", () => {
    const message = verifyEmailMessage({
      to: "a@b.co",
      url: "https://x.test/v",
      expiresIn: 86_400,
    });
    expect(message.text).toMatch(/didn't create this account/i);
    expect(message.text).toContain("24 hours");
  });
});

describe("resetPasswordMessage", () => {
  it("states that ignoring it leaves the password unchanged", () => {
    // This mail goes to people who did not ask for it. Saying nothing has
    // happened is the difference between a scare and a support ticket.
    const message = resetPasswordMessage({
      to: "a@b.co",
      url: "https://x.test/r",
      expiresIn: 3600,
    });
    expect(message.text).toMatch(/your password has not changed/i);
    expect(message.text).toMatch(/only be used once/i);
  });
});

describe("changeEmailMessage", () => {
  it("names both addresses so the reader can see what is moving where", () => {
    const message = changeEmailMessage({
      to: "old@b.co",
      newEmail: "new@b.co",
      url: "https://x.test/c",
      expiresIn: 3600,
    });
    expect(message.text).toContain("old@b.co");
    expect(message.text).toContain("new@b.co");
  });

  it("tells the old address to change its password, not merely to ignore it", () => {
    // An unexpected change-email request is evidence of a live intruder, which
    // is a different situation from an unexpected reset request.
    const message = changeEmailMessage({
      to: "old@b.co",
      newEmail: "new@b.co",
      url: "https://x.test/c",
      expiresIn: 3600,
    });
    expect(message.text).toMatch(/change your password/i);
  });
});

describe("verifyCodeMessage", () => {
  const message = verifyCodeMessage({
    to: "a@b.co",
    code: "123456",
    expiresIn: 600,
  });

  it("carries the code in both bodies", () => {
    expect(message.text).toContain("123456");
    expect(message.html).toContain("123456");
  });

  it("keeps the code out of the subject line", () => {
    // A subject is visible on a lock screen and in a notification. A code that
    // can be read without unlocking the phone is a code the person behind you
    // can use.
    expect(message.subject).not.toContain("123456");
    expect(message.subject).toMatch(/confirmation code/i);
  });

  it("has no link in it at all", () => {
    // Which is half the point of a code: a mail with no URL cannot be
    // re-pointed somewhere else and still look like ours.
    expect(message.html).not.toContain("<a ");
    expect(message.text).not.toMatch(/https?:\/\//);
  });

  it("says how long it lasts and that it is single-use", () => {
    expect(message.text).toContain("10 minutes");
    expect(message.text).toMatch(/only once/i);
  });

  it("tells someone who didn't ask that the code is what protects them", () => {
    expect(message.text).toMatch(/nobody can do anything/i);
  });

  it("escapes the code before putting it in the HTML", () => {
    // The generator only emits digits, so this is belt-and-braces — but it is
    // the kind of belt that stops a custom generateOTP becoming an injection.
    const injected = verifyCodeMessage({
      to: "a@b.co",
      code: "<script>",
      expiresIn: 600,
    });
    expect(injected.html).not.toContain("<script>");
  });
});

describe("html safety", () => {
  it("escapes an address that contains markup", () => {
    const message = changeEmailMessage({
      to: '"><script>alert(1)</script>@b.co',
      newEmail: "new@b.co",
      url: "https://x.test/c",
      expiresIn: 3600,
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("escapes the URL it puts in the href", () => {
    const message = verifyEmailMessage({
      to: "a@b.co",
      url: 'https://x.test/v?a=1&b="2"',
      expiresIn: 3600,
    });
    expect(message.html).toContain("a=1&amp;b=&quot;2&quot;");
    expect(message.html).not.toMatch(/href="[^"]*"2"/);
  });
});
