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
