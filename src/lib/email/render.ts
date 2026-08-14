import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
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
 * Deliberately not the design system: `src/components/ui` compiles to Tailwind
 * classes against CSS custom properties, and neither survives an email client.
 * Everything here is inline, in absolute units, on a white card — the one place
 * in the product where the dark palette is not honoured, because there is no
 * reliable way to detect it and a half-applied theme is worse than none.
 *
 * A whole document rather than a bare `<div>`, for one reason: `lang`. Without
 * it Gmail offers to translate a Bulgarian message it has decided is English,
 * and a screen reader reads German copy with English phonemes.
 */
export function renderHtml(
  subject: string,
  content: Content,
  locale: Locale,
): string {
  const copy = copyFor(locale);
  const p = (line: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#111827">${escapeHtml(line)}</p>`;

  const parts: string[] = [];

  if (content.heading !== "") {
    parts.push(
      `<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:650;color:#111827">${escapeHtml(content.heading)}</h1>`,
    );
  }

  parts.push(...paragraphs(content.body).map(p));

  if (content.code !== undefined) {
    // Letter-spaced and large, because the whole job of this block is to be
    // read off one screen and typed into another.
    parts.push(
      `<p style="margin:24px 0;padding:16px 20px;background:#f5f5f5;border-radius:8px;font-size:32px;line-height:1.2;font-weight:650;letter-spacing:8px;text-align:center;color:#111827">${escapeHtml(content.code)}</p>`,
    );
  }

  if (content.action !== undefined) {
    const href = escapeHtml(content.action.url);
    parts.push(
      `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1d4ed8;color:#ffffff;font-size:16px;font-weight:550;text-decoration:none">${escapeHtml(content.action.label)}</a></p>`,
      // The raw URL under the button on purpose: corporate mail clients strip
      // styled anchors often enough that a button-only mail is a dead end for a
      // meaningful share of recipients.
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b7280">${escapeHtml(copy.paste)}<br><a href="${href}" style="color:#1d4ed8;word-break:break-all">${href}</a></p>`,
    );
  }

  if (content.signature !== undefined) parts.push(p(content.signature));

  parts.push(
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.6;color:#6b7280">${escapeHtml(content.footer)}<br>${escapeHtml(copy.brand)}</p>`,
  );

  return [
    "<!doctype html>",
    `<html lang="${locale}">`,
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    `<div style="max-width:520px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px">`,
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
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}): EmailMessage {
  return {
    to: input.to,
    subject: input.subject,
    text: renderText(input.content, input.locale),
    html: renderHtml(input.subject, input.content, input.locale),
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    ...(input.headers === undefined ? {} : { headers: input.headers }),
  };
}
