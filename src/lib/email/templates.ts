import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { copyFor } from "./copy";
import { fill, humanDuration, renderMessage, type EmailMessage } from "./render";

/**
 * The four transactional emails auth needs, as pure functions of a locale.
 *
 * Pure on purpose: a template that reads the environment or reaches for a
 * transport cannot be asserted on cheaply, and these are the messages nobody
 * ever looks at again once they work.
 *
 * The locale comes from `user.locale` at the call site (PLAN-LOCALIZATION §2)
 * and defaults to English, because two of these callers — a password reset for
 * an address that may not have an account, a confirmation code sent seconds
 * after sign-up — can genuinely fail to know it. Defaulting is right there;
 * blocking a password reset to look up a language is not.
 *
 * §18.1 names Resend + React Email. React Email is a build-time JSX renderer
 * and these are four messages with one button each, so it would add a
 * dependency and a compile step to save nothing.
 */

export type { EmailMessage } from "./render";
export { escapeHtml, fill, humanDuration } from "./render";

/**
 * A code, not a link.
 *
 * Sign-up asks for the code on the page the person is already looking at, which
 * means the mail has nothing to click — and that is worth having deliberately:
 * a message with no link in it cannot be turned into a phishing template by
 * swapping the URL, and it works when the mail client opens in the wrong
 * browser, which is where link verification quietly loses people.
 *
 * The code is in the body but **not** the subject line: a subject is visible on
 * a lock screen and in a notification, and a six-digit code that can be read
 * without unlocking the phone is a code anyone standing behind you can use.
 */
export function verifyCodeMessage(input: {
  to: string;
  code: string;
  expiresIn: number;
  locale?: Locale;
}): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const copy = copyFor(locale);
  const values = {
    brand: copy.brand,
    duration: humanDuration(input.expiresIn, locale),
  };

  return renderMessage({
    to: input.to,
    subject: fill(copy.system.verifyCode.subject, values),
    locale,
    content: {
      heading: fill(copy.system.verifyCode.heading, values),
      body: copy.system.verifyCode.body.map((line) => fill(line, values)),
      code: input.code,
      footer: fill(copy.system.verifyCode.footer, values),
    },
  });
}

/**
 * Sent on request from `/account`, and — when the account holder has never
 * verified — to the *new* address of an email change. Better Auth calls one
 * function for both, so the copy has to be true in both; that is why it says
 * "this address" rather than "your account's email".
 */
export function verifyEmailMessage(input: {
  to: string;
  url: string;
  expiresIn: number;
  locale?: Locale;
}): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const copy = copyFor(locale);
  const values = {
    brand: copy.brand,
    duration: humanDuration(input.expiresIn, locale),
  };

  return renderMessage({
    to: input.to,
    subject: fill(copy.system.verifyEmail.subject, values),
    locale,
    content: {
      heading: fill(copy.system.verifyEmail.heading, values),
      body: copy.system.verifyEmail.body.map((line) => fill(line, values)),
      action: { label: copy.system.verifyEmail.action, url: input.url },
      footer: fill(copy.system.verifyEmail.footer, values),
    },
  });
}

export function resetPasswordMessage(input: {
  to: string;
  url: string;
  expiresIn: number;
  locale?: Locale;
}): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const copy = copyFor(locale);
  const values = {
    brand: copy.brand,
    duration: humanDuration(input.expiresIn, locale),
  };

  return renderMessage({
    to: input.to,
    subject: fill(copy.system.resetPassword.subject, values),
    locale,
    content: {
      heading: fill(copy.system.resetPassword.heading, values),
      body: copy.system.resetPassword.body.map((line) => fill(line, values)),
      action: { label: copy.system.resetPassword.action, url: input.url },
      // The security-relevant sentence, and the reason this mail is worth
      // sending even to someone who did not ask for it: it is how an account
      // holder finds out that a stranger knows their address.
      footer: fill(copy.system.resetPassword.footer, values),
    },
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
  locale?: Locale;
}): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const copy = copyFor(locale);
  const values = {
    brand: copy.brand,
    duration: humanDuration(input.expiresIn, locale),
    oldEmail: input.to,
    newEmail: input.newEmail,
  };

  return renderMessage({
    to: input.to,
    subject: fill(copy.system.changeEmail.subject, values),
    locale,
    content: {
      heading: fill(copy.system.changeEmail.heading, values),
      body: copy.system.changeEmail.body.map((line) => fill(line, values)),
      action: { label: copy.system.changeEmail.action, url: input.url },
      footer: fill(copy.system.changeEmail.footer, values),
    },
  });
}
