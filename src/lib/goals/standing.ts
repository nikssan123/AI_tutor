import type { Db } from "@/db";
import { buildInFlightFor, type PackBuild } from "@/lib/packs/build";
import type { CourseSummary } from "@/components/course-list";
import { coursesFor, pickUpAgain } from "./courses";
import { loadIntake } from "./intake-store";
import { resumableIntake, type ResumableIntake } from "./onboarding";

/**
 * Where a learner stands when no course is running.
 *
 * `/today` learned to answer that question — a conversation left half-answered,
 * a course put aside — and `/calendar`, `/mastery` and `/progress` did not. So
 * the product could tell you on one screen that you were partway through
 * creating a subject and, on the next tab along, that you had nothing at all and
 * should go and pick something. The state was never in doubt; three of the four
 * screens simply never asked for it.
 *
 * Assembled here rather than per page for the reason `CourseList` exists: what
 * the learner is in the middle of is one fact, and four screens each deciding
 * what to load is how they came to disagree in the first place.
 *
 * `LearnerStanding` rather than `Standing`, which the ledger already uses for
 * where a single *skill* stands. Two meanings for one word in one product is
 * the thing every comment in `mastery/` is written to avoid.
 */

export interface LearnerStanding {
  /**
   * A pack being authored for them right now (§7.1's Generated tier).
   *
   * First among the three because it is the only one where something is
   * happening without the learner: the honest offer is "go and watch", and
   * every other offer on the screen would be asking them to start a second
   * thing while the first is still being written.
   */
  building: PackBuild | undefined;
  /** A goal conversation they walked away from. */
  resume: ResumableIntake | undefined;
  /** Courses they can put back on their Today. */
  again: CourseSummary[];
}

export async function standingFor(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<LearnerStanding> {
  const [intake, courses, building] = await Promise.all([
    loadIntake(db, userId),
    coursesFor(db, userId),
    buildInFlightFor(db, userId, now),
  ]);

  return {
    building,
    resume: resumableIntake(intake),
    again: pickUpAgain(courses),
  };
}
