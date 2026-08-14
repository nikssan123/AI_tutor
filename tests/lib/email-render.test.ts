import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  fill,
  humanDuration,
  renderHtml,
  renderMessage,
  renderText,
  type Content,
} from "@/lib/email/render";

/**
 * The frame every message is poured into.
 *
 * These are the assertions about properties that are invisible until a real
 * person receives a broken email, by which time the fix ships a day late.
 */

const base: Content = {
  heading: "Heading",
  body: ["First.", "Second."],
  footer: "Footer.",
};

describe("escapeHtml", () => {
  it("neutralises every character that can break out of an attribute", () => {
    expect(escapeHtml(`<a href="x" class='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes the ampersand first, so escapes are not double-escaped", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("fill", () => {
  it("substitutes every known token, however often it appears", () => {
    expect(fill("{a} and {a} and {b}", { a: "x", b: "y" })).toBe(
      "x and x and y",
    );
  });

  it("leaves an unknown token standing rather than blanking it", () => {
    // Both are bugs. `Hi {nmae}` is one the operator sees in the preview and
    // fixes; `Hi ` is one that reads as merely curt and ships.
    expect(fill("Hi {nmae}", { name: "Ana" })).toBe("Hi {nmae}");
  });

  it("treats an explicitly undefined value as unknown", () => {
    expect(fill("Hi {name}", { name: undefined })).toBe("Hi {name}");
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
  ])("renders %i seconds as %s in English", (seconds, expected) => {
    expect(humanDuration(seconds)).toBe(expected);
  });

  it("says 24 hours rather than 1 day", () => {
    // "1 day" reads as "some time tomorrow"; 24 hours is a deadline.
    expect(humanDuration(86_400)).toBe("24 hours");
  });

  it.each([
    ["de" as const, 3600, "1 Stunde"],
    ["de" as const, 7200, "2 Stunden"],
    ["bg" as const, 3600, "1 час"],
    ["bg" as const, 7200, "2 часа"],
    ["es" as const, 600, "10 minutos"],
    ["es" as const, 60 * 60 * 24 * 3, "3 días"],
  ])("inflects for %s", (locale, seconds, expected) => {
    // The reason this comes from Intl rather than a table here: German and
    // Bulgarian both change the unit with the count, and a hand-written plural
    // rule would be wrong in at least one language on at least one number.
    expect(humanDuration(seconds, locale)).toBe(expected);
  });
});

describe("renderHtml", () => {
  it("is a whole document, tagged with the language", () => {
    // Without `lang`, Gmail offers to translate Bulgarian it has decided is
    // English, and a screen reader reads German with English phonemes.
    const html = renderHtml("Subject", base, "bg");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="bg">');
    expect(html).toContain("<title>Subject</title>");
  });

  it("omits the heading element when the heading is empty", () => {
    expect(renderHtml("s", { ...base, heading: "" }, "en")).not.toContain("<h1");
    expect(renderHtml("s", base, "en")).toContain("<h1");
  });

  it("renders a button and the raw URL under it", () => {
    const html = renderHtml(
      "s",
      { ...base, action: { label: "Go", url: "https://x.test/a?b=c&d=e" } },
      "en",
    );
    expect(html).toContain("Or paste this into your browser");
    // Escaped, because it lands in an href.
    expect(html).toContain("https://x.test/a?b=c&amp;d=e");
    expect(html).not.toContain("b=c&d=e");
  });

  it("uses the reader's language for the frame, not English", () => {
    const html = renderHtml(
      "s",
      { ...base, action: { label: "Los", url: "https://x.test" } },
      "de",
    );
    expect(html).toContain("Oder fügen Sie diesen Link");
  });

  it("renders a code block instead of a button", () => {
    const html = renderHtml("s", { ...base, code: "123456" }, "en");
    expect(html).toContain("123456");
    expect(html).not.toContain("<a ");
  });

  it("renders the signature when there is one", () => {
    expect(renderHtml("s", { ...base, signature: "— Ana" }, "en")).toContain(
      "— Ana",
    );
  });

  it("escapes every interpolated value", () => {
    const html = renderHtml(
      "<script>t</script>",
      {
        heading: "<script>h</script>",
        body: ["<script>b</script>"],
        code: "<script>c</script>",
        signature: "<script>s</script>",
        footer: "<script>f</script>",
      },
      "en",
    );
    expect(html).not.toContain("<script>");
    // Six: the title, and each of the five content fields.
    expect(html.match(/&lt;script&gt;/g)?.length).toBe(6);
  });

  it("splits a multi-line body into paragraphs", () => {
    // An operator's freeform answer is whatever they typed into a textarea, and
    // a 400-word block whose line breaks were dropped is worse than no answer.
    const html = renderHtml("s", { ...base, body: ["one\n\ntwo\nthree"] }, "en");
    expect(html.match(/<p style="margin:0 0 16px/g)?.length).toBe(3);
  });
});

describe("renderText", () => {
  it("separates paragraphs with a blank line and signs off with the brand", () => {
    expect(renderText(base, "en")).toBe(
      "Heading\n\nFirst.\n\nSecond.\n\nFooter.\nMeritKeep",
    );
  });

  it("drops an empty heading rather than opening with a blank line", () => {
    expect(renderText({ ...base, heading: "" }, "en").startsWith("First.")).toBe(
      true,
    );
  });

  it("labels the code in the reader's language", () => {
    expect(renderText({ ...base, code: "123456" }, "bg")).toContain(
      "Вашият код: 123456",
    );
  });

  it("prints the action as a label and a URL", () => {
    expect(
      renderText(
        { ...base, action: { label: "Go", url: "https://x.test/a" } },
        "en",
      ),
    ).toContain("Go: https://x.test/a");
  });

  it("includes the signature", () => {
    expect(renderText({ ...base, signature: "— Ana" }, "en")).toContain("— Ana");
  });
});

describe("renderMessage", () => {
  it("carries both bodies", () => {
    const message = renderMessage({
      to: "a@b.co",
      subject: "S",
      locale: "en",
      content: base,
    });

    expect(message.to).toBe("a@b.co");
    expect(message.text).toContain("First.");
    expect(message.html).toContain("<div");
  });

  it("omits the optional envelope fields rather than setting them undefined", () => {
    // `JSON.stringify` drops an undefined value, so this is cosmetic on the
    // wire — but a `from: undefined` in a recorded message is a value a test
    // has to know to ignore.
    const message = renderMessage({
      to: "a@b.co",
      subject: "S",
      locale: "en",
      content: base,
    });

    expect(Object.keys(message).sort()).toEqual([
      "html",
      "subject",
      "text",
      "to",
    ]);
  });

  it("passes through the envelope fields when given", () => {
    const message = renderMessage({
      to: "a@b.co",
      subject: "S",
      locale: "en",
      content: base,
      from: "Us <s@m.co>",
      replyTo: "s+1@m.co",
      headers: { "In-Reply-To": "<x@y>" },
    });

    expect(message.from).toBe("Us <s@m.co>");
    expect(message.replyTo).toBe("s+1@m.co");
    expect(message.headers).toEqual({ "In-Reply-To": "<x@y>" });
  });
});
