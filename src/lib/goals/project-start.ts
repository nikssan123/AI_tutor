import { customPathHref } from "./custom-path";

/**
 * The way out of a graded brief and a subject page.
 *
 * `/projects` and `/learn` are the two highest-priority entries in the sitemap
 * after the home page, and neither of the pages under them had an exit: every
 * link went sideways into more marketing, and the only `/start` links on the
 * whole surface were two on the home page and one on `/learn`'s *empty results*
 * card. The pages search actually delivers strangers to were the pages that
 * could not convert one, and the page that converts is the one nobody lands on.
 *
 * These reach §8 screen 3's conversation rather than creating a goal outright,
 * and that is the design rather than a shortcut. A `GoalSpec` needs weekly
 * hours, a stated level, a deadline and a motivation; a project slug knows none
 * of them. Writing the goal here would mean inventing four answers the learner
 * never gave — the same move `activeGoal` refuses when it declines to plan
 * against a spec that no longer parses.
 */

/**
 * A subject page's offer, which is the *subject's own name* and nothing else.
 *
 * This shipped as a sentence ("I want to learn SQL.") on the theory that a full
 * line reads better as a chat opener. It broke `/start`, and the way it broke
 * is worth keeping written down. That screen compares the subject it is holding
 * against the one arriving to decide whether they collide, and it renders the
 * arriving one inside `Start on “…”?`. Both expect a subject. Given a sentence,
 * the comparison never matches — so every arrival collided — and the heading
 * asked whether you wanted to start on `I want to learn SQL.`, quotes and full
 * stop included.
 *
 * The subject name is what every consumer of `?topic=` already expects, so this
 * is now a straight alias. Kept as a named function rather than inlined because
 * the call sites say what they mean, and because the sentence version is the
 * kind of good idea somebody will have again.
 */
export function topicStartHref(topicName: string): string {
  return customPathHref(topicName);
}

/** The parameter `/start` reads a brief from. */
export const PROJECT_PARAM = "project";

/**
 * The form field carrying the course the learner already chose.
 *
 * A hidden input rather than a query parameter, because the thing that needs it
 * is the *action*, and by the time the action runs the URL is whatever the form
 * posted to. It is a claim, not a fact — the action resolves it against the
 * catalogue before anything is built on it.
 *
 * Lives here rather than in the `"use server"` module that reads it: every
 * export from one of those must be an async function, and a string constant in
 * one type-checks, lints, passes its tests, then fails in the bundler and takes
 * the route down.
 */
export const PACK_FIELD = "pack";

/**
 * A brief's offer, which names the project rather than describing it.
 *
 * `?topic=` was the wrong carrier for this and a sentence was the wrong payload.
 * A click on a specific brief is not a search box: it names exactly one pack and
 * exactly one project, and `/start` can look both up. So the slug travels and
 * the wording is built at the far end from the resolved project.
 *
 * Two things follow that the sentence-in-a-URL version could not have.
 *
 * A slug that resolves to nothing is *ignored* rather than echoed, so no text a
 * visitor can put in a query string is rendered back to them as a subject.
 *
 * And `/start` can tell a deliberate choice from a typed query. That is the
 * distinction the bug turned on: an unfinished conversation about something
 * else should interrupt a vague search, and should not bury the brief somebody
 * has just read the rubric of and pressed a button on.
 */
export function projectStartHref(slug: string, error?: string): string {
  const href = `/start?${PROJECT_PARAM}=${encodeURIComponent(slug)}`;
  return error ? `${href}&error=${encodeURIComponent(error)}` : href;
}

/**
 * The learner's opening line, built at `/start` from the resolved project.
 *
 * Still a sentence, because this one really does become their first message to
 * the analyzer — it is posted as a reply, not compared against a stored subject
 * or rendered as a heading. The subject name is in it so the matcher has the
 * thing it keys on, and the brief is in it so the plan is aimed at the work the
 * reader actually turned up for.
 */
export function projectStartSeed(title: string, topicName: string): string {
  return `I want to learn ${topicName} so I can do the "${title}" project.`;
}
