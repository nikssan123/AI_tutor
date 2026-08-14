/**
 * The three transactional emails auth needs, as pure functions.
 *
 * Pure on purpose: a template that reads the environment or reaches for a
 * transport cannot be asserted on cheaply, and these are the messages nobody
 * ever looks at again once they work. Every one returns both a `text` and an
 * `html` body — a link-only HTML mail with no plain-text alternative is the
 * single strongest spam signal a new sending domain can emit, and text is what
 * a screen reader and a terminal client actually get.
 *
 * §18.1 names Resend + React Email. React Email is a build-time JSX renderer
 * and these are three messages with one button each, so it would add a
 * dependency and a compile step to save nothing. If the product ever sends
 * digests (§24 E13), that is the point to reconsider.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** The product name as it appears in a subject line and a signature. */
const BRAND = "MeritKeep";

/**
 * Escaping is not optional here, even though the only interpolated values are a
 * URL we generated and a name.
 *
 * The name is whatever the account holder typed at sign-up, and the mail goes
 * to an address that may not be theirs — `changeEmail` deliberately mails the
 * *old* address. So an unescaped name is a way to inject markup into a message
 * a stranger reads. The URL is escaped for the same reason it always is: it
 * lands in an `href` attribute.
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
 * How long a link is good for, in words rather than seconds.
 *
 * Every one of these mails has to say it, because "this link has expired" is
 * the most common way a verification flow fails and the only defence is telling
 * people up front.
 */
export function humanDuration(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  if (hours >= 24) {
    const days = Math.round(hours / 24);
    return days === 1 ? "24 hours" : `${days} days`;
  }
  if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;

  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * One layout for all three messages.
 *
 * Deliberately not the design system: `src/components/ui` compiles to Tailwind
 * classes against CSS custom properties, and neither survives an email client.
 * Everything here is inline, in absolute units, on a white card — the one place
 * in the product where the dark palette is not honoured, because there is no
 * reliable way to detect it and a half-applied theme is worse than none.
 *
 * The raw URL is printed under the button on purpose. Corporate mail clients
 * strip styled anchors often enough that a button-only mail is a dead end for a
 * meaningful share of recipients.
 */
function layout(options: {
  heading: string;
  body: string[];
  action: { label: string; url: string };
  footer: string;
}): string {
  const paragraphs = options.body
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#111827">${escapeHtml(line)}</p>`,
    )
    .join("");

  const href = escapeHtml(options.action.url);

  return [
    `<div style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    `<div style="max-width:520px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px">`,
    `<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:650;color:#111827">${escapeHtml(options.heading)}</h1>`,
    paragraphs,
    `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1d4ed8;color:#ffffff;font-size:16px;font-weight:550;text-decoration:none">${escapeHtml(options.action.label)}</a></p>`,
    `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b7280">Or paste this into your browser:<br><a href="${href}" style="color:#1d4ed8;word-break:break-all">${href}</a></p>`,
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.6;color:#6b7280">${escapeHtml(options.footer)}<br>${BRAND}</p>`,
    `</div></div>`,
  ].join("");
}

function plain(options: {
  heading: string;
  body: string[];
  action: { label: string; url: string };
  footer: string;
}): string {
  return [
    options.heading,
    "",
    ...options.body,
    "",
    `${options.action.label}: ${options.action.url}`,
    "",
    options.footer,
    BRAND,
  ].join("\n");
}

function compose(
  to: string,
  subject: string,
  content: {
    heading: string;
    body: string[];
    action: { label: string; url: string };
    footer: string;
  },
): EmailMessage {
  return { to, subject, text: plain(content), html: layout(content) };
}

/**
 * A code, not a link.
 *
 * Sign-up asks for the code on the page the person is already looking at, which
 * means the mail has nothing to click — and that is worth having deliberately:
 * a message with no link in it cannot be turned into a phishing template by
 * swapping the URL, and it works when the mail client opens in the wrong
 * browser, which is where link verification quietly loses people.
 *
 * Letter-spaced and large, because the whole job of this email is to be read
 * off one screen and typed into another.
 */
function composeCode(
  to: string,
  subject: string,
  content: { heading: string; body: string[]; code: string; footer: string },
): EmailMessage {
  const text = [
    content.heading,
    "",
    ...content.body,
    "",
    `Your code: ${content.code}`,
    "",
    content.footer,
    BRAND,
  ].join("\n");

  const paragraphs = content.body
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#111827">${escapeHtml(line)}</p>`,
    )
    .join("");

  const html = [
    `<div style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    `<div style="max-width:520px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px">`,
    `<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:650;color:#111827">${escapeHtml(content.heading)}</h1>`,
    paragraphs,
    `<p style="margin:24px 0;padding:16px 20px;background:#f5f5f5;border-radius:8px;font-size:32px;line-height:1.2;font-weight:650;letter-spacing:8px;text-align:center;color:#111827">${escapeHtml(content.code)}</p>`,
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.6;color:#6b7280">${escapeHtml(content.footer)}<br>${BRAND}</p>`,
    `</div></div>`,
  ].join("");

  return { to, subject, text, html };
}

/**
 * The code that confirms an address at sign-up, and whenever someone asks for
 * another one from `/account`.
 *
 * The code is in the body but **not** the subject line: a subject is visible on
 * a lock screen and in a notification, and a six-digit code that can be read
 * without unlocking the phone is a code anyone standing behind you can use.
 */
export function verifyCodeMessage(input: {
  to: string;
  code: string;
  expiresIn: number;
}): EmailMessage {
  return composeCode(input.to, `Your confirmation code · ${BRAND}`, {
    heading: "Confirm your email",
    body: [
      "Type this code into the page you left open to confirm this address.",
      `It works for ${humanDuration(input.expiresIn)}, and only once.`,
    ],
    code: input.code,
    footer:
      "Didn't ask for this? Ignore it. Nobody can do anything with your address without this code.",
  });
}

/**
 * Sent on sign-up, on request from `/account`, and — when the account holder
 * has never verified — to the *new* address of an email change. Better Auth
 * calls one function for all three, so the copy has to be true in all three;
 * that is why it says "this address" rather than "your account's email".
 */
export function verifyEmailMessage(input: {
  to: string;
  url: string;
  expiresIn: number;
}): EmailMessage {
  return compose(input.to, `Confirm your email · ${BRAND}`, {
    heading: "Confirm your email",
    body: [
      "Confirm this address so we can send you a password reset if you ever need one.",
      `The link works for ${humanDuration(input.expiresIn)}.`,
    ],
    action: { label: "Confirm this address", url: input.url },
    footer: "If you didn't create this account, ignore this email — nothing happens until the link is used.",
  });
}

export function resetPasswordMessage(input: {
  to: string;
  url: string;
  expiresIn: number;
}): EmailMessage {
  return compose(input.to, `Reset your password · ${BRAND}`, {
    heading: "Reset your password",
    body: [
      "Someone asked for a password reset on this account. If it was you, set a new one here.",
      `The link works for ${humanDuration(input.expiresIn)} and can only be used once.`,
    ],
    action: { label: "Set a new password", url: input.url },
    // The security-relevant sentence, and the reason this mail is worth
    // sending even to someone who did not ask for it: it is how an account
    // holder finds out that a stranger knows their address.
    footer:
      "Didn't ask for this? Ignore it. Your password has not changed, and whoever asked cannot see this email.",
  });
}

/**
 * Sent to the **old** address when a verified account changes its email, which
 * is Better Auth's flow and the right one: the address losing access is the one
 * that gets to approve the change, so a stolen session cannot quietly move the
 * account somewhere the owner can't reach.
 */
export function changeEmailMessage(input: {
  to: string;
  newEmail: string;
  url: string;
  expiresIn: number;
}): EmailMessage {
  return compose(input.to, `Approve your new email address · ${BRAND}`, {
    heading: "Approve your new email address",
    body: [
      `You asked to change this account's email from ${input.to} to ${input.newEmail}.`,
      `Nothing changes until you approve it from this address. The link works for ${humanDuration(input.expiresIn)}.`,
    ],
    action: { label: "Approve the change", url: input.url },
    footer:
      "Didn't ask for this? Don't use the link, and change your password. Someone else may be signed in to your account.",
  });
}
