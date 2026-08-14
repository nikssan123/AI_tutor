/**
 * Every word the product ever emails, in English.
 *
 * This module is the shape as well as the content: the other three locales are
 * declared as `EmailStrings`, so a key that exists here and not there is a
 * type error rather than a German reader receiving an English paragraph. That
 * is the whole string-completeness gate PLAN-LOCALIZATION §13 asks for, and it
 * costs nothing to run because `pnpm typecheck` already does.
 *
 * `{token}` placeholders are filled by `fill()` in `../render.ts`. They are
 * substituted *before* HTML escaping, so a value carrying markup is neutralised
 * on the way out — see `escapeHtml`.
 *
 * Translations of the operator templates are honest machine-assisted drafts
 * except Bulgarian. HUMAN-REVIEW.md tracks which ones a native speaker has
 * actually read; do not treat an unreviewed language as finished copy.
 */

export const en = {
  /** The product name, as it appears in a subject line and a signature. */
  brand: "MeritKeep",

  /** Under the button, where a client has stripped the anchor. */
  paste: "Or paste this into your browser:",

  /** Above the six digits, in the plain-text body. */
  codeLabel: "Your code",

  /**
   * The four messages auth sends. Nobody chooses to receive one of these, so
   * every single one ends by saying what happens if you ignore it.
   */
  system: {
    verifyCode: {
      subject: "Your confirmation code · {brand}",
      heading: "Confirm your email",
      body: [
        "Type this code into the page you left open to confirm this address.",
        "It works for {duration}, and only once.",
      ],
      footer:
        "Didn't ask for this? Ignore it. Nobody can do anything with your address without this code.",
    },

    verifyEmail: {
      subject: "Confirm your email · {brand}",
      heading: "Confirm your email",
      body: [
        "Confirm this address so we can send you a password reset if you ever need one.",
        "The link works for {duration}.",
      ],
      action: "Confirm this address",
      footer:
        "If you didn't create this account, ignore this email — nothing happens until the link is used.",
    },

    resetPassword: {
      subject: "Reset your password · {brand}",
      heading: "Reset your password",
      body: [
        "Someone asked for a password reset on this account. If it was you, set a new one here.",
        "The link works for {duration} and can only be used once.",
      ],
      action: "Set a new password",
      footer:
        "Didn't ask for this? Ignore it. Your password has not changed, and whoever asked cannot see this email.",
    },

    changeEmail: {
      subject: "Approve your new email address · {brand}",
      heading: "Approve your new email address",
      body: [
        "You asked to change this account's email from {oldEmail} to {newEmail}.",
        "Nothing changes until you approve it from this address. The link works for {duration}.",
      ],
      action: "Approve the change",
      footer:
        "Didn't ask for this? Don't use the link, and change your password. Someone else may be signed in to your account.",
    },
  },

  /**
   * The messages a person sends, from `/admin/mail`.
   *
   * All five are signed and end with an invitation to reply, because they all
   * arrive from a mailbox a human reads — which is the only reason they are
   * worth sending at all.
   */
  operator: {
    welcome: {
      subject: "Welcome to {brand}, {name}",
      heading: "Welcome to {brand}",
      body: [
        "Hi {name} — thanks for signing up.",
        "{brand} is built around one idea: you don't get credit for watching a lesson, you get credit for work that stands up to marking. So the fastest way to see whether it suits you is to hand something in.",
        "If anything is unclear, or it isn't doing what you hoped, reply to this email. It comes straight to me.",
      ],
      action: "Pick up where you left off",
      signature: "— {sender}",
      footer:
        "You're getting this because you created a {brand} account. Reply any time.",
    },

    checkIn: {
      subject: "How's {goal} going?",
      heading: "How's it going?",
      body: [
        "Hi {name} — you set out to work on {goal}, and it's been quiet for a bit.",
        "No guilt intended: I'd genuinely like to know whether something got in the way, or whether the plan we built simply wasn't the right one. Either answer is useful, and the second one is a bug I can fix.",
      ],
      action: "See where you got to",
      signature: "— {sender}",
      footer:
        "You're getting this because you have an active goal on {brand}. Reply and tell me to stop, and I will.",
    },

    packReady: {
      subject: "{topic} is ready on {brand}",
      heading: "{topic} is ready",
      body: [
        "Hi {name} — you asked for {topic}, and it's now built: a skill map, graded work, and a plan that adapts to what you can already show.",
        "It starts with a short diagnostic rather than lesson one, so anything you already know you'll skip past.",
      ],
      action: "Start {topic}",
      signature: "— {sender}",
      footer: "You're getting this because you asked us for this subject.",
    },

    reply: {
      subject: "Re: {subject}",
      heading: "",
      body: ["Hi {name},", "{message}"],
      signature: "— {sender}, {brand}",
      footer: "Just reply to this email and it lands straight back with us.",
    },

    resolved: {
      subject: "Re: {subject}",
      heading: "",
      body: [
        "Hi {name},",
        "{message}",
        "I'm marking this one as done at our end — but if it's still not right, reply and it reopens.",
      ],
      signature: "— {sender}, {brand}",
      footer: "Just reply to this email and it lands straight back with us.",
    },
  },
};

/**
 * The shape every other locale must fill.
 *
 * Derived rather than declared, so adding a paragraph to the English copy is
 * what makes the other three fail to compile — which is the correct order of
 * events. Arrays are `string[]`, not tuples, so a language that needs three
 * sentences where English needs two is free to use them.
 */
export type EmailStrings = typeof en;
