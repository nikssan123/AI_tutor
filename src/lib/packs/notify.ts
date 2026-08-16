import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { user } from "@/db/schema";
import {
  deliver,
  escapeHtml,
  packReadyMessage,
  systemFrom,
  teamInbox,
} from "@/lib/email";
import { resolveLocale, type Locale } from "@/lib/i18n/locales";
import { toThemeChoice, type ThemeChoice } from "@/lib/theme-script";
import { markBuildNotified } from "./build";

/**
 * Telling the team a build stopped.
 *
 * A learner used to be handed a "Try again" button, which made a failed build
 * their problem to solve by pressing something twice. It was never a fair ask:
 * a retry is four model calls and about a pound, the learner cannot tell a bad
 * subject from a bad afternoon, and on the free tier they are spending the
 * catalogue's money to find out. So the button is gone and this takes its
 * place — the failure becomes ours, and the learner is told that it has.
 *
 * Which only means anything if somebody is actually told. Hence two writes,
 * not one: the mail goes out, and `pack_build.notified_at` records that it did.
 * A failed row with no `notified_at` is a second failure — nobody knows — and
 * it is visible at `/admin/packs` precisely because it is written down.
 */

export interface BuildFailure {
  slug: string;
  subject: string;
  /** Why it stopped, in the same words the learner was given. */
  detail: string;
  /** Who was waiting. Null for a build nobody asked for — a script, a probe. */
  userId: string | null;
}

/** The line an operator scans a full inbox for. */
export function failureSubject(failure: BuildFailure): string {
  return `Pack build stopped: ${failure.subject}`;
}

/**
 * The body, written for the person who has to decide what to do next.
 *
 * Every fact it can act on and nothing else: what was asked for, the slug the
 * admin screen keys on, why it stopped, and who is waiting. No apology and no
 * "please investigate" — an alert nobody can act on trains people to archive
 * alerts.
 */
export function failureBody(failure: BuildFailure): string {
  return [
    `A learner asked for "${failure.subject}" and the build stopped.`,
    "",
    `Subject:  ${failure.subject}`,
    `Slug:     ${failure.slug}`,
    `Reason:   ${failure.detail}`,
    `Waiting:  ${failure.userId ?? "nobody — this build was not learner-initiated"}`,
    "",
    "They have been told we are looking at it, and they have no retry button.",
    "Retrying is an admin action: /admin/packs.",
  ].join("\n");
}

/**
 * Emails the team and records that it happened.
 *
 * `deliver` rather than `sendMessage`, so a mail failure cannot take the build
 * pipeline down with it — the same argument the auth flows make. The
 * consequence is deliberate and visible: when the send fails, `notified_at`
 * stays null and the admin list shows the row as one nobody was told about,
 * which is the honest state rather than a silent one.
 */
export async function notifyBuildFailed(
  db: Db,
  failure: BuildFailure,
  now: Date = new Date(),
): Promise<boolean> {
  const text = failureBody(failure);

  const sent = await deliver({
    to: teamInbox(),
    from: systemFrom(),
    subject: failureSubject(failure),
    text,
    /*
     * Deliberately not the branded template every learner-facing message uses.
     * This is an alert to ourselves: the fastest thing to read on a phone is
     * the same monospaced block as the plain-text part, and a logo above an
     * incident makes it look like marketing. Escaped rather than interpolated —
     * the subject is a string a learner typed.
     */
    html: `<pre style="font:14px/1.5 ui-monospace,monospace">${escapeHtml(text)}</pre>`,
  });

  if (sent) await markBuildNotified(db, failure.slug, now);
  return sent;
}

/* ── The learner's side of a success ──────────────────────────────────────── */

/**
 * Telling the person who asked that their subject exists now.
 *
 * The mirror of `notifyBuildFailed`, and the more valuable of the two. A
 * generated pack is three model calls and about three minutes on a queue, which
 * is long enough that the learner who commissioned it has very often gone. Up
 * to here the pipeline mailed somebody on *failure* only: a build that worked
 * produced a finished course, a wait screen nobody was looking at, and silence.
 *
 * That is the leak this closes. Everything the product charges for sits behind
 * a learner coming back and doing some work — a lesson, a session, a graded
 * project — and none of it can happen to somebody who never found out the wait
 * was over.
 *
 * `deliver` rather than `sendMessage`, exactly like the failure path: a mail
 * that will not send must not fail the build step that has already succeeded.
 * The consequence is the honest one — the pack is still there, and they will
 * find it on their next visit.
 */
export interface BuildDelivery {
  /** For the copy, in the learner's own words. */
  subject: string;
  /** Who asked. */
  userId: string;
}

/**
 * The reader, or nothing.
 *
 * Nothing is a real answer and not an error: `requestedBy` is a nullable column
 * whose docstring says the pack outlives the person who asked for it, so a
 * build finishing after its commissioner deleted their account is a case that
 * happens rather than a case that is broken.
 */
async function reader(
  db: Db,
  userId: string,
): Promise<{ email: string; locale: Locale; theme: ThemeChoice } | undefined> {
  const [row] = await db
    .select({ email: user.email, locale: user.locale, theme: user.theme })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return row === undefined
    ? undefined
    : {
        email: row.email,
        locale: resolveLocale(row.locale),
        theme: toThemeChoice(row.theme),
      };
}

/**
 * Returns whether the learner was actually mailed, so a caller that wants to
 * know can ask — and so the test can assert the "nobody to tell" case rather
 * than inferring it from an absence.
 *
 * Deliberately **not** recorded in `pack_build.notified_at`. That column means
 * "the team was told this stopped", it is read by `/admin/packs`, which lists
 * stopped builds only, and widening it to mean two things would make the one
 * screen that depends on it ambiguous. At-most-once delivery here comes from
 * the shape of the caller instead: this runs last inside a memoised Inngest
 * step, after the write that could still fail, and `deliver` swallows its own
 * errors — so there is no path that sends twice.
 */
export async function notifyPackReady(
  db: Db,
  delivery: BuildDelivery,
): Promise<boolean> {
  const who = await reader(db, delivery.userId);
  if (!who) return false;

  return deliver(
    packReadyMessage({
      to: who.email,
      topic: delivery.subject,
      locale: who.locale,
      theme: who.theme,
    }),
  );
}
