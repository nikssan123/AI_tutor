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
  /**
   * The six messages money sends (PLAN-MONETIZATION §10).
   *
   * Different from the auth block above in one way that matters: these are the
   * only emails in the product that can cost the reader something by being
   * ignored. So every one of them states the amount, the date and the way out —
   * `trialEnding` most of all, because §13 risk 3 counts a renewal somebody did
   * not expect as the trial's main danger, and a chargeback costs the fee plus
   * a fixed penalty on top of the refund.
   */
  billing: {
    trialStarted: {
      subject: "Your 4 days of Pro start now · {brand}",
      heading: "You're on Pro",
      body: [
        "Everything is unlocked for the next four days: the full curriculum, the tutor, and {evaluations} graded projects.",
        "On {renewsOn} it becomes {price} a month. Cancel before then and you pay nothing more than the {trialPrice} you already have.",
        "The fastest way to find out whether this works on you is to hand something in. Nothing else here is evidence.",
      ],
      action: "Hand something in",
      footer: "You can cancel in two clicks from your account, any time.",
    },

    trialEnding: {
      subject: "Your trial renews tomorrow · {brand}",
      heading: "Tomorrow, this becomes {price} a month",
      body: [
        "Your four days of Pro end on {renewsOn}, and the subscription starts then at {price} a month.",
        "If that is what you want, there is nothing to do.",
        "If it is not, cancel now and you keep Pro until {renewsOn} anyway.",
      ],
      action: "Keep or cancel",
      footer:
        "We would rather you cancelled than forgot. This email exists so it is never a surprise.",
    },

    trialConverted: {
      subject: "You're on Pro · {brand}",
      heading: "You're on Pro",
      body: [
        "Your trial has become a subscription at {price} a month. The next payment is on {renewsOn}.",
        "That is {evaluations} graded projects a month, marked against the same public rubrics, with the evidence quoted back from your own work.",
      ],
      action: "Pick up where you left off",
      footer: "Invoices and payment details live in your account.",
    },

    paymentFailed: {
      subject: "We couldn't take your payment · {brand}",
      heading: "That payment didn't go through",
      body: [
        "Your card was declined, which is usually an expiry date rather than anything worth worrying about.",
        "We'll try again over the next few days. Nothing stops in the meantime — you keep everything while we sort it out.",
      ],
      action: "Update your card",
      footer:
        "If it still hasn't worked in a couple of weeks, the account drops to Free and nothing is lost.",
    },

    cancelled: {
      subject: "Cancelled — you keep Pro until {endsOn} · {brand}",
      heading: "You still have Pro until {endsOn}",
      body: [
        "Nothing more will be charged. Everything keeps working until {endsOn}, and after that the account moves to Free.",
        "Your mastery ledger stays exactly where it is. Everything you have had marked is still yours to point at.",
        "Thank you for telling us why — it is the only way this gets better.",
      ],
      action: "Change your mind",
      footer: "Come back whenever. Your evidence will be waiting.",
    },

    referralRewarded: {
      subject: "{friend} joined — here's your {days} days · {brand}",
      heading: "{days} days of Pro, on us",
      body: [
        "{friend} subscribed, so the {days} days of Pro we promised you are on your account from today.",
        "Nothing to activate and nothing to pay. It simply runs until {endsOn}.",
      ],
      action: "Use them",
      footer: "Invite someone else and the same thing happens again.",
    },
  },

  /**
   * Mail the product sends about a learner's own work, rather than about their
   * money or their credentials.
   *
   * `packReady` exists because a generated pack is the one thing this product
   * does that takes minutes and happens off the request path. Somebody asks for
   * a subject, watches a progress screen for a while, and closes the tab —
   * and until this message there was nothing at all to bring them back. The
   * build finished, the course sat there, and the only mail the pipeline ever
   * sent went to *us*, on failure.
   *
   * **It sells nothing**, and that is deliberate. There is a paid plan behind
   * this course and the app says so the moment they arrive (`pack_built` in
   * `src/lib/billing/nudge.ts`); an email that opened with the price would be
   * charging admission to a thing they already commissioned. This says the work
   * is done and where to find it.
   */
  lifecycle: {
    packReady: {
      subject: "{topic} is ready · {brand}",
      heading: "Your course is written",
      body: [
        "You asked us to build {topic}, and it now exists — the whole skill map, in the order the skills actually build on each other, with graded work at the end of it.",
        "It opens with a short diagnostic rather than with lesson one, so whatever you can already do, you skip past.",
      ],
      action: "See your plan",
      footer: "You're getting this because you asked us to build this subject.",
    },
  },

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
