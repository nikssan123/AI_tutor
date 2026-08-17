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
import { dark, light } from "@/lib/theme";

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

const ACTION = { label: "Go", url: "https://x.test/a" };

/**
 * An origin a stranger's mail client could actually fetch from.
 *
 * Needed by every assertion about the mark: without it `siteUrl()` resolves to
 * localhost and the frame deliberately ships no image at all.
 */
const PUBLIC = { NEXT_PUBLIC_SITE_URL: "https://x.test" };

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
    expect(html.match(/class="mk-body"/g)?.length).toBe(3);
  });
});

/**
 * The branding, which is the half of this that a reader notices consciously.
 */
describe("renderHtml branding", () => {
  it("opens on the wordmark, as live text rather than an image", () => {
    // Remote images are blocked by default in a good share of clients. A
    // blocked logo has to degrade to the product's name, not to a grey box.
    const html = renderHtml("s", base, "en");
    const header = html.slice(0, html.indexOf("<h1"));
    expect(header).toContain(">MeritKeep<");
  });

  it("hangs the mark on a public URL, because email cannot render an SVG", () => {
    const html = renderHtml("s", base, "en", {
      theme: "light",
      env: PUBLIC,
    });
    expect(html).toContain('src="https://x.test/brand/mark-light.png"');
  });

  it("signs off with the lockup as well as opening on it", () => {
    // The brand used to be a bare second line under the footer sentence — the
    // one place in the message where the product's name read as an
    // afterthought rather than as a signature.
    const html = renderHtml("s", base, "en", { env: PUBLIC });
    expect(html).toContain('class="mk-sign"');
    expect(html.match(/mark-light\.png/g)?.length).toBe(2);
    // Smaller than the header's 24, so the second lockup does not read as a
    // second header.
    expect(html).toContain('width="16" height="16"');
  });

  it("drops the mark rather than shipping an image no client can fetch", () => {
    // `RESEND_API_KEY` set and `NEXT_PUBLIC_SITE_URL` unset is a local dev
    // server sending real mail with `siteUrl()` still on localhost. Gmail
    // fetches through its own proxy, which has no idea what your laptop is, so
    // every message arrived with a broken-image icon where the mark should be.
    // A placeholder looks like the sender is broken; no mark just looks quiet.
    for (const origin of [
      undefined,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://0.0.0.0:8080",
      "http://app.localhost:3000",
      "http://macbook.local",
      "not-a-url",
    ]) {
      const html = renderHtml("s", base, "en", {
        env: origin === undefined ? {} : { NEXT_PUBLIC_SITE_URL: origin },
      });
      expect(html, origin).not.toContain("<img");
      // The wordmark is live text, so the header still says who sent this.
      expect(html, origin).toContain(">MeritKeep<");
    }
  });

  it("keeps the mark for an origin a stranger can actually resolve", () => {
    for (const origin of [
      "https://meritkeep.com",
      "https://preview-abc.vercel.app",
    ]) {
      const html = renderHtml("s", base, "en", {
        env: { NEXT_PUBLIC_SITE_URL: origin },
      });
      expect(html, origin).toContain(`${origin}/brand/mark-light.png`);
    }
  });

  it("closes the gap left by the missing mark instead of padding nothing", () => {
    const html = renderHtml("s", base, "en", {
      env: { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" },
    });
    expect(html).not.toContain("padding-right:8px");
  });

  it("gives the mark no alt text, because the name is already beside it", () => {
    // Otherwise a screen reader announces "MeritKeep MeritKeep".
    expect(renderHtml("s", base, "en", { env: PUBLIC })).toContain('alt=""');
  });

  it("paints the frame in the product's own tokens, not in generic blue", () => {
    // The frame used to be #1d4ed8 on #f5f5f5 — a palette that appears nowhere
    // else in the product. These come from `src/lib/theme.ts` by import.
    const html = renderHtml("s", { ...base, action: ACTION }, "en");
    expect(html).toContain(light.accent);
    expect(html).toContain(light.ground);
    expect(html).not.toContain("#1d4ed8");
  });

  it("puts the readable ink on the accent button, never white", () => {
    // §8.5.3: white on the dark theme's mint measures 2.17:1, which would make
    // the one button in the message its least readable element.
    const html = renderHtml("s", { ...base, action: ACTION }, "en", {
      theme: "dark",
    });
    expect(html).toContain(`background:${dark.accent};color:${dark.onAccent}`);
  });
});

/**
 * The theme, which is the half a reader only notices when it is wrong — at
 * night, on a phone, as a white rectangle.
 */
describe("renderHtml themes", () => {
  it("paints the dark palette inline for someone who chose dark", () => {
    // Inline, so it survives a client that supports no stylesheet at all.
    const html = renderHtml("s", base, "en", { theme: "dark" });
    expect(html).toContain(`background:${dark.ground}`);
    expect(html).toContain(`background:${dark.surface}`);
    expect(html).toContain(`color:${dark.ink}`);
    expect(html).not.toContain(light.ground);
  });

  it("paints the light palette for someone who chose light", () => {
    const html = renderHtml("s", base, "en", { theme: "light" });
    expect(html).toContain(`background:${light.ground}`);
    expect(html).not.toContain(dark.ground);
  });

  it("defaults to System, which is what an untouched account has", () => {
    expect(renderHtml("s", base, "en")).toBe(
      renderHtml("s", base, "en", { theme: "system" }),
    );
  });

  it("hands System to the client with a prefers-color-scheme block", () => {
    // The same resolution order the app uses: an explicit choice wins, and
    // otherwise the device decides.
    const html = renderHtml("s", base, "en", { theme: "system" });
    expect(html).toContain("@media (prefers-color-scheme:dark)");
    expect(html).toContain(`background:${light.ground}`);
    expect(html).toContain(`background:${dark.ground}!important`);
  });

  it("ships no media query for an explicit choice", () => {
    // Someone who set dark in Settings → Appearance did not ask their laptop's
    // daylight sensor for a second opinion.
    for (const theme of ["light", "dark"] as const) {
      expect(renderHtml("s", base, "en", { theme })).not.toContain("@media");
    }
  });

  it("shouts over its own inline styles, which otherwise win", () => {
    const html = renderHtml("s", base, "en", { theme: "system" });
    const block = html.slice(html.indexOf("@media"), html.indexOf("</style>"));
    // Every declaration, not only the coloured ones: they are generated from
    // one table, so a rule about which half may be overridden would be a rule
    // someone has to remember.
    expect(block).not.toMatch(/[^!]important/);
    expect(block.match(/!important/g)!.length).toBeGreaterThan(20);
  });

  it("declares the schemes it handles, so no client inverts it again", () => {
    // Without this a client in dark mode runs its own inversion over a message
    // that is already dark and hands the reader grey on grey.
    expect(renderHtml("s", base, "en", { theme: "dark" })).toContain(
      '<meta name="color-scheme" content="dark">',
    );
    expect(renderHtml("s", base, "en", { theme: "system" })).toContain(
      '<meta name="color-scheme" content="light dark">',
    );
    expect(renderHtml("s", base, "en", { theme: "light" })).toContain(
      "color-scheme:light;supported-color-schemes:light",
    );
  });

  it("swaps the mark with the ground, because a raster cannot inherit ink", () => {
    const html = renderHtml("s", base, "en", { theme: "system", env: PUBLIC });
    expect(html).toContain("mark-light.png");
    expect(html).toContain("mark-dark.png");
    // Hidden two ways: Outlook's Word engine honours neither the media query
    // nor `display` on an image, and would draw both marks side by side.
    expect(html).toContain("display:none;mso-hide:all");
    expect(html).toContain(".mk-mark-dark{display:inline-block!important}");
  });

  it("sends one mark, not two, when the theme is not in question", () => {
    const html = renderHtml("s", base, "en", { theme: "dark", env: PUBLIC });
    expect(html).toContain("mark-dark.png");
    expect(html).not.toContain("mark-light.png");
    expect(html).not.toContain("mso-hide");
  });

  it("leaves the plain-text half alone", () => {
    // There is nothing to theme in it, and a client that shows text is a
    // client with no palette to honour.
    const dark = renderMessage({
      to: "a@b.co",
      subject: "S",
      locale: "en",
      content: base,
      theme: "dark",
    });
    const light = renderMessage({
      to: "a@b.co",
      subject: "S",
      locale: "en",
      content: base,
      theme: "light",
    });

    expect(dark.text).toBe(light.text);
    expect(dark.html).not.toBe(light.html);
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
