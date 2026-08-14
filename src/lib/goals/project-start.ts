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
 * These seed §8 screen 3's conversation rather than creating a goal outright,
 * and that is the design rather than a shortcut. A `GoalSpec` needs weekly
 * hours, a stated level, a deadline and a motivation; a project slug knows none
 * of them. Writing the goal here would mean inventing four answers the learner
 * never gave — the same move `activeGoal` refuses when it declines to plan
 * against a spec that no longer parses, and for the same reason: a plan built
 * on invented answers is one the learner never asked for. Seeding the intake
 * means they still answer for their own plan, and `/start` already carries the
 * seed through sign-in, so the brief they clicked from is not lost on the way.
 *
 * Built on `customPathHref` rather than beside it. That function owns the shape
 * of the link and the encoding it needs — subject names contain ampersands and
 * slashes — and a second module spelling out `?topic=` itself is how the two
 * drift apart.
 */

/** A full sentence rather than a bare noun: this becomes their opening line. */
export function projectStartHref(title: string, topicName: string): string {
  return customPathHref(
    `I want to learn ${topicName} so I can do the "${title}" project.`,
  );
}

/** The same offer from a subject page, where there is no one brief to name. */
export function topicStartHref(topicName: string): string {
  return customPathHref(`I want to learn ${topicName}.`);
}
