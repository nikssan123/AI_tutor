/**
 * Where a turn of the intake conversation lands you.
 *
 * The composer is pinned to the bottom of the screen, which fixed one problem
 * and created another: pinned, it covers the tail of the conversation, so the
 * page opened showing a row of chips answering a question you could not read.
 *
 * So each turn redirects to the newest message rather than to the top of the
 * page. No script involved — the browser does it, which is the same bargain
 * every other transition on this screen makes.
 *
 * Shared because the id and the redirect have to agree, and they are written
 * in different files: `page.tsx` puts the id on the last message, the Server
 * Actions redirect here. A `"use server"` module may export nothing but async
 * functions, so the constant cannot live beside those redirects.
 */
export const LATEST = "latest";

/** The intake screen, opened at the newest turn. */
export const INTAKE_AT_LATEST = `/start#${LATEST}`;

/**
 * The button that builds the plan, once the conversation has closed on one.
 *
 * It sits at the end of a conversation that can be six exchanges long, and
 * everything that sends somebody back to it — the closing turn's own redirect,
 * and "Build it" on every screen that says they left one ready — was landing
 * them at the top of that scroll instead. The one thing left to do on the
 * screen was below the fold, on the screen whose entire remaining purpose is
 * that one thing.
 *
 * **The id goes on the button itself, not on the card around it, and that is
 * the whole mechanism.** A fragment whose target is focusable is focused as
 * well as scrolled to, so `#ready` puts a keyboard on the button with no script
 * running at all. Pointing it at the card instead scrolls there and *cancels*
 * the button's `autofocus` — verified in Chrome — which is the version of this
 * that looks right and does half the job.
 *
 * `autofocus` is still on the button, for the arrival this cannot cover: a
 * client-side navigation from `/today` never re-parses the document, so no
 * fragment is processed and React's mount is the only thing that can move
 * focus. The two mechanisms never both apply, and both end in the same place.
 */
export const READY = "ready";

/** The intake screen, opened on the button that builds the plan. */
export const INTAKE_AT_READY = `/start#${READY}`;
