import type { EnvLike } from "@/lib/env-types";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { canonical } from "@/lib/site";
import { dark, geometry, light, type Palette } from "@/lib/theme";
import type { ThemeChoice } from "@/lib/theme-script";
import { copyFor } from "./copy";

/**
 * One layout, four languages, two bodies.
 *
 * Everything that turns copy into a sendable message lives here so that
 * `templates.ts` (what auth sends) and `catalog.ts` (what an operator sends)
 * cannot drift apart in their escaping, their frame or their plain-text
 * fallback. They differ in words only.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Overrides the transport's configured sender. Support mail comes from a
   * mailbox a person reads; auth mail does not, and leaves this unset.
   */
  from?: string;
  /**
   * Where a reply goes — for threaded mail, an address carrying the thread id,
   * so the answer lands back on the conversation it belongs to.
   */
  replyTo?: string;
  /** `In-Reply-To` and `References`, when this message continues a thread. */
  headers?: Record<string, string>;
}

/** The parts of a message that are not the frame. */
export interface Content {
  heading: string;
  body: string[];
  action?: { label: string; url: string };
  /** A confirmation code, shown large instead of a button. */
  code?: string;
  /** Who it is from, when a human sent it. */
  signature?: string;
  footer: string;
}

/**
 * Escaping is not optional here, even when the only interpolated values are a
 * URL we generated and a name.
 *
 * The name is whatever the account holder typed at sign-up, and the mail may go
 * to an address that is not theirs — `changeEmail` deliberately mails the *old*
 * address, and an operator reply quotes a stranger's own words back at them. So
 * an unescaped value is a way to inject markup into a message someone else
 * reads. The URL is escaped for the reason it always is: it lands in an `href`.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * `{token}` → value.
 *
 * An unknown token is deliberately left standing rather than blanked. Both are
 * bugs, but `Hi {nmae}` is one an operator sees in the preview and fixes before
 * sending, while `Hi ` is one that reads as merely curt and ships.
 */
export function fill(
  template: string,
  values: Record<string, string | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => {
    const value = values[key];
    return value === undefined ? token : value;
  });
}

/**
 * How long a link is good for, in the reader's language.
 *
 * The number and its unit come from `Intl`, not from a hand-written table:
 * Bulgarian and German both inflect the unit by count, and a plural rule
 * written here would be wrong in at least one language on at least one number.
 * ICU already knows all four.
 */
export function humanDuration(
  seconds: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const unit = (value: number, name: "day" | "hour" | "minute") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "long",
    }).format(value);

  const hours = Math.round(seconds / 3600);
  if (hours >= 24) {
    const days = Math.round(hours / 24);
    // "1 day" reads as "some time tomorrow". 24 hours is a deadline.
    return days === 1 ? unit(24, "hour") : unit(days, "day");
  }
  if (hours >= 1) return unit(hours, "hour");

  return unit(Math.max(1, Math.round(seconds / 60)), "minute");
}

/**
 * Body entries split on newlines.
 *
 * Copy paragraphs never contain one, but an operator's freeform reply is
 * whatever they typed into a textarea — and a support answer that arrives as a
 * single 400-word block because its line breaks were dropped is worse than no
 * answer at all.
 */
function paragraphs(body: string[]): string[] {
  return body.flatMap((line) => line.split(/\n+/)).filter((line) => line !== "");
}

/**
 * The typeface, which is the one design token this file cannot honour.
 *
 * §8.5.3 specifies Instrument Sans, and a webfont in an email is either ignored
 * or — in the clients that do fetch it — a second network request that marks
 * the message as tracked. So the frame uses the reader's system face, which is
 * what every other well-behaved sender does. Everything else on this page comes
 * from `src/lib/theme.ts` by import, so the palette cannot drift from the
 * product's.
 */
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The pieces of the frame that carry a colour, and therefore have to be written
 * twice — once inline for the theme we are rendering, once inside a media query
 * for the client that resolves the theme itself.
 */
const PARTS = [
  "page",
  "card",
  "brand",
  "heading",
  "body",
  "code",
  "button",
  "hint",
  "link",
  "footer",
  "sign",
] as const;

type Part = (typeof PARTS)[number];

/**
 * One palette in, one set of declarations out.
 *
 * The whole point of the indirection: the light frame, the dark frame and the
 * `prefers-color-scheme` override are the same table evaluated three times, so
 * a colour cannot be corrected in one theme and forgotten in the other. That is
 * the failure §8.5.4 warns about — "hand-maintaining two copies of a palette is
 * how themes silently diverge" — and an email is where nobody would notice it,
 * because nobody reads their own transactional mail in both themes.
 *
 * Sizes are absolute px rather than the `rem` of `typeScale`: `rem` resolves
 * against a root font size that several clients rewrite.
 */
function partStyles(p: Palette): Record<Part, string> {
  return {
    page: `margin:0;padding:32px 16px;background:${p.ground};font-family:${FONT}`,
    card: `max-width:544px;margin:0 auto;padding:32px;background:${p.surface};border:1px solid ${p.hairline};border-radius:${geometry.radiusCard}`,
    brand: `font-size:15px;line-height:1.4;font-weight:650;letter-spacing:-0.02em;color:${p.ink}`,
    heading: `margin:0 0 20px;font-size:24px;line-height:1.25;font-weight:650;letter-spacing:-0.02em;color:${p.ink}`,
    body: `margin:0 0 16px;font-size:16px;line-height:1.6;color:${p.ink}`,
    // Ink on the weak accent rather than accent on it: this block exists to be
    // read off one screen and typed into another, so it is held to the body
    // text bar and gets its brand from the ground and the rule, not the digits.
    code: `margin:24px 0;padding:16px 20px;background:${p.accentWeak};border:1px solid ${p.accent};border-radius:${geometry.radiusControl};font-size:32px;line-height:1.2;font-weight:650;letter-spacing:8px;text-align:center;color:${p.ink}`,
    // `onAccent`, not white. §8.5.3 is explicit that white on the dark theme's
    // mint measures 2.17:1, which would make the one button in the message its
    // least readable element.
    button: `display:inline-block;padding:12px 20px;border-radius:${geometry.radiusControl};background:${p.accent};color:${p.onAccent};font-size:16px;font-weight:550;text-decoration:none`,
    hint: `margin:0 0 16px;font-size:13px;line-height:1.6;color:${p.inkFaint}`,
    link: `color:${p.accent};word-break:break-all`,
    footer: `margin:28px 0 0;padding-top:20px;border-top:1px solid ${p.hairline};font-size:13px;line-height:1.6;color:${p.inkFaint}`,
    // The sign-off name sits at the footer's weight, not the header's: it is
    // the same lockup at the other end of the message, and a second 15px
    // wordmark down there would read as a second header.
    sign: `font-size:13px;line-height:1.4;font-weight:650;letter-spacing:-0.02em;color:${p.inkMuted}`,
  };
}

/** `class` and `style` together, so a call site cannot set one and not the other. */
function attrs(styles: Record<Part, string>, part: Part): string {
  return `class="mk-${part}" style="${styles[part]}"`;
}

/**
 * Inline styles beat a stylesheet, so the override has to shout.
 *
 * Every declaration, not only the coloured ones. They come off the same table
 * either way, so re-stating a margin costs a few bytes and buys the absence of
 * a rule — nobody has to remember which half of a declaration list is allowed
 * to be overridden, because the answer is all of it.
 */
function important(declarations: string): string {
  return declarations
    .split(";")
    .map((declaration) => `${declaration}!important`)
    .join(";");
}

/** What a client that resolves the theme itself should do instead. */
function darkOverrides(): string {
  const styles = partStyles(dark);
  const rules = PARTS.map(
    (part) => `.mk-${part}{${important(styles[part])}}`,
  ).join("");

  // The mark is a raster, so it cannot inherit ink the way the wordmark beside
  // it does. Two images, one hidden, is the only swap available here.
  return `${rules}.mk-mark-light{display:none!important}.mk-mark-dark{display:inline-block!important}`;
}

/**
 * What we tell the client we have already handled.
 *
 * Without this, a client in dark mode runs its own inversion over a message
 * that is already dark and hands the reader grey text on grey. `light dark`
 * says "either is fine, we wrote both"; a single value says "we meant this
 * one", which is what an explicit choice in Settings → Appearance is.
 */
const SCHEME: Record<ThemeChoice, string> = {
  light: "light",
  dark: "dark",
  system: "light dark",
};

/**
 * Whether an origin is one a stranger's mail client can actually fetch from.
 *
 * This exists because of a combination that is normal rather than exotic:
 * `RESEND_API_KEY` set in `.env.local` and `NEXT_PUBLIC_SITE_URL` unset, which
 * is a local dev server sending *real* mail with `siteUrl()` still resolving to
 * `http://localhost:3000`. Gmail fetches images through its own proxy, and that
 * proxy has no idea what your laptop is, so every message arrives with a broken
 * image where the mark should be — which is worse than no mark at all, because
 * a placeholder icon looks like the sender is broken.
 *
 * The same guard covers a preview deployment whose assets have not shipped yet
 * and anything else pointing at a name only the sender can resolve.
 */
function reachable(origin: string): boolean {
  // `canParse` rather than a try/catch around `new URL`, and not `URL.parse`:
  // the engines floor here is Node 22, and `URL.parse` only exists from 22.1.
  // A crash inside a password-reset send is not the place to find that out.
  if (!URL.canParse(origin)) return false;
  const { hostname: host } = new URL(origin);

  return (
    host !== "localhost" &&
    !host.endsWith(".localhost") &&
    !host.endsWith(".local") &&
    // Covers 127.0.0.1 and 0.0.0.0; a bare IP is never a canonical origin here.
    !/^\d+\.\d+\.\d+\.\d+$/.test(host) &&
    host.includes(".")
  );
}

/** The mark, as a raster, in the one variant that belongs on this ground. */
function markImage(
  variant: "light" | "dark",
  shown: boolean,
  size: number,
  env?: EnvLike,
): string {
  const src = escapeHtml(canonical(`/brand/mark-${variant}.png`, env));
  // `mso-hide` as well as `display:none`: Outlook's Word engine honours neither
  // the media query nor `display` on an image, and would draw both marks.
  const display = shown ? "display:inline-block" : "display:none;mso-hide:all";
  // Decorative — the wordmark beside it is real text and carries the name, so
  // alt text here would make a screen reader say "MeritKeep MeritKeep".
  return `<img src="${src}" width="${size}" height="${size}" alt="" class="mk-mark-${variant}" style="${display};border:0" />`;
}

/**
 * The mark, in whichever variants this theme needs — or nothing at all.
 *
 * Nothing is a real answer here, and the reason the header below is built the
 * way it is: the wordmark beside the mark is live text, so a message with no
 * mark still reads as ours. That is also what a reader with images turned off
 * sees, which means the no-image case is a layout we ship to a good share of
 * recipients whether we plan for it or not.
 */
function marks(theme: ThemeChoice, size: number, env?: EnvLike): string {
  if (!reachable(canonical("/", env))) return "";

  return theme === "system"
    ? `${markImage("light", true, size, env)}${markImage("dark", false, size, env)}`
    : markImage(theme, true, size, env);
}

/**
 * The lockup: mark, then name, on one baseline.
 *
 * A table, because `flex` and `gap` are not available here and a floated image
 * next to text is how the alignment breaks in Outlook. The mark's cell is
 * dropped entirely rather than left empty when there is no mark, so the name
 * does not sit behind 8px of padding that leads nowhere.
 */
function lockup(
  styles: Record<Part, string>,
  part: Part,
  theme: ThemeChoice,
  brand: string,
  size: number,
  margin: string,
  env?: EnvLike,
): string {
  const mark = marks(theme, size, env);

  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${margin}"><tr>`,
    mark === "" ? "" : `<td style="padding-right:8px;line-height:1">${mark}</td>`,
    `<td ${attrs(styles, part)}>${escapeHtml(brand)}</td>`,
    `</tr></table>`,
  ].join("");
}

/**
 * The header, which is the branding this frame spent its first year without.
 *
 * The name is live text rather than part of the image on purpose: remote images
 * are blocked by default in a good share of clients, and a blocked logo should
 * degrade to the product's name set in its own weight, not to a grey rectangle.
 */
function brandHeader(
  styles: Record<Part, string>,
  theme: ThemeChoice,
  brand: string,
  env?: EnvLike,
): string {
  return lockup(styles, "brand", theme, brand, 24, "margin:0 0 28px", env);
}

export interface FrameOptions {
  /**
   * The reader's appearance choice, from `user.theme`.
   *
   * `"system"` is the honest default and not a fallback: it renders the light
   * frame with a `prefers-color-scheme` override attached, which is the same
   * resolution order the app itself uses — an explicit `data-theme` wins, and
   * otherwise the device decides.
   */
  theme?: ThemeChoice;
  env?: EnvLike;
}

/**
 * Deliberately not the design system: `src/components/ui` compiles to Tailwind
 * classes against CSS custom properties, and neither survives an email client.
 * Everything here is inline and in absolute units — but the *values* are the
 * product's own tokens, imported from `src/lib/theme.ts`, so the message looks
 * like the thing it was sent by rather than like a generic blue-button email.
 *
 * Dark is honoured two ways, because the two failure modes are different. A
 * reader who chose dark in Settings → Appearance gets a dark frame inline,
 * which works in every client including the ones that support no CSS at all. A
 * reader who left it on System gets the light frame plus a
 * `prefers-color-scheme` block, which the clients that know the answer will
 * apply. `<style>` in the head is not universally supported, which is exactly
 * why it carries the case where being ignored is still correct.
 *
 * A whole document rather than a bare `<div>`, for one reason: `lang`. Without
 * it Gmail offers to translate a Bulgarian message it has decided is English,
 * and a screen reader reads German copy with English phonemes.
 */
export function renderHtml(
  subject: string,
  content: Content,
  locale: Locale,
  options: FrameOptions = {},
): string {
  const theme = options.theme ?? "system";
  const copy = copyFor(locale);
  const styles = partStyles(theme === "dark" ? dark : light);
  const p = (line: string) =>
    `<p ${attrs(styles, "body")}>${escapeHtml(line)}</p>`;

  const parts: string[] = [brandHeader(styles, theme, copy.brand, options.env)];

  if (content.heading !== "") {
    parts.push(
      `<h1 ${attrs(styles, "heading")}>${escapeHtml(content.heading)}</h1>`,
    );
  }

  parts.push(...paragraphs(content.body).map(p));

  if (content.code !== undefined) {
    // Letter-spaced and large, because the whole job of this block is to be
    // read off one screen and typed into another.
    parts.push(
      `<p ${attrs(styles, "code")}>${escapeHtml(content.code)}</p>`,
    );
  }

  if (content.action !== undefined) {
    const href = escapeHtml(content.action.url);
    parts.push(
      `<p style="margin:24px 0"><a href="${href}" ${attrs(styles, "button")}>${escapeHtml(content.action.label)}</a></p>`,
      // The raw URL under the button on purpose: corporate mail clients strip
      // styled anchors often enough that a button-only mail is a dead end for a
      // meaningful share of recipients.
      `<p ${attrs(styles, "hint")}>${escapeHtml(copy.paste)}<br><a href="${href}" ${attrs(styles, "link")}>${href}</a></p>`,
    );
  }

  if (content.signature !== undefined) parts.push(p(content.signature));

  // The footer signs off with the mark as well as the name. It used to be the
  // brand on a bare second line, which is the one place in the message where
  // the product's name appeared as an afterthought rather than as a signature.
  parts.push(
    `<p ${attrs(styles, "footer")}>${escapeHtml(content.footer)}</p>`,
    lockup(styles, "sign", theme, copy.brand, 16, "margin:12px 0 0", options.env),
  );

  const scheme = SCHEME[theme];
  const sheet = [
    `:root{color-scheme:${scheme};supported-color-schemes:${scheme}}`,
    // Only System asks a question the client can answer. An explicit choice
    // ships one palette and no media query, because a reader who set dark in
    // the product did not ask their laptop's daylight sensor for a second
    // opinion.
    theme === "system"
      ? `@media (prefers-color-scheme:dark){${darkOverrides()}}`
      : "",
  ].join("");

  return [
    "<!doctype html>",
    `<html lang="${locale}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width">',
    `<meta name="color-scheme" content="${scheme}">`,
    `<meta name="supported-color-schemes" content="${scheme}">`,
    `<title>${escapeHtml(subject)}</title>`,
    `<style>${sheet}</style>`,
    "</head>",
    `<body ${attrs(styles, "page")}>`,
    `<div ${attrs(styles, "card")}>`,
    parts.join(""),
    "</div></body></html>",
  ].join("");
}

/**
 * The plain-text half, which is not a courtesy.
 *
 * An HTML-only mail from a young sending domain is the single strongest spam
 * signal it can emit, and text is what a screen reader and a terminal client
 * actually get.
 */
export function renderText(content: Content, locale: Locale): string {
  const copy = copyFor(locale);
  const blocks: string[] = [];

  if (content.heading !== "") blocks.push(content.heading);
  blocks.push(...paragraphs(content.body));

  if (content.code !== undefined) {
    blocks.push(`${copy.codeLabel}: ${content.code}`);
  }
  if (content.action !== undefined) {
    blocks.push(`${content.action.label}: ${content.action.url}`);
  }
  if (content.signature !== undefined) blocks.push(content.signature);

  blocks.push(`${content.footer}\n${copy.brand}`);

  return blocks.join("\n\n");
}

/** Both bodies, one message. */
export function renderMessage(input: {
  to: string;
  subject: string;
  locale: Locale;
  content: Content;
  theme?: ThemeChoice;
  env?: EnvLike;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}): EmailMessage {
  return {
    to: input.to,
    subject: input.subject,
    text: renderText(input.content, input.locale),
    html: renderHtml(input.subject, input.content, input.locale, {
      theme: input.theme,
      env: input.env,
    }),
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    ...(input.headers === undefined ? {} : { headers: input.headers }),
  };
}
