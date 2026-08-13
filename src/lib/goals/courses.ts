import type { Db } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import type { CourseSummary } from "@/components/course-list";
import { isResumable } from "./lifecycle";
import { goalsFor } from "./store";

/**
 * A learner's courses, named in the pack's own words, ready to render.
 *
 * The goal row knows its pack by slug; the *name* a learner recognises lives in
 * the pack. Resolved through `resolvePack` rather than the disk catalogue so a
 * §7.1 Generated course — which exists only in the database — is not silently
 * missing from a learner's own list.
 *
 * A goal whose pack no longer resolves is dropped rather than shown, matching
 * what `goalsFor` does with a spec it cannot parse and what `/today` does with a
 * pack that has gone: there is no honest row to draw, and a course you cannot
 * name is not one anybody can act on.
 */
export async function coursesFor(
  db: Db,
  userId: string,
): Promise<CourseSummary[]> {
  const goals = await goalsFor(db, userId);

  const resolved = await Promise.all(
    goals.map(async (goal) => {
      const pack = await resolvePack(db, goal.packSlug);
      return pack === undefined
        ? []
        : [
            {
              goalId: goal.id,
              name: pack.name,
              taxonomyParent: pack.taxonomyParent,
              status: goal.status,
            },
          ];
    }),
  );

  return resolved.flat();
}

/**
 * The courses worth offering to someone with nothing running.
 *
 * Finished ones are left out: they have no action on them (see `CourseRow`), so
 * offering one as a way back into the product would be offering a row that does
 * nothing when tapped.
 */
export function pickUpAgain(
  courses: readonly CourseSummary[],
): CourseSummary[] {
  return courses.filter((course) => isResumable(course.status));
}
