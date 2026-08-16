import { SubjectIcon } from "@/components/icons";
import { Button, Row, RowList, stagger, Status } from "@/components/ui";
import {
  isResumable,
  STATUS_LABEL,
  type GoalStatus,
} from "@/lib/goals/lifecycle";
import { courseAction } from "@/lib/goals/course-actions";

/**
 * A learner's courses, with whatever they are allowed to do to each.
 *
 * Shared by `/progress` (where the running one is managed), `/today` (where a
 * paused one is a better offer than a fresh start) and `/subjects` (where
 * picking one back up beats picking a new one). One component because the
 * actions are irreversible enough that three screens wording them differently
 * would be a genuine hazard, not just untidy.
 */

export interface CourseSummary {
  goalId: string;
  name: string;
  taxonomyParent: string | null;
  status: GoalStatus;
}

const TONE: Record<GoalStatus, "verified" | "neutral" | "attention"> = {
  // "Finished" is the accent, because the accent means verified (§8.5.3) and a
  // finished course is the one status in this list that had to be earned.
  achieved: "verified",
  active: "verified",
  paused: "attention",
  abandoned: "neutral",
};

/** A single form button, so the row never grows a menu. */
function Action({
  goalId,
  action,
  label,
}: {
  goalId: string;
  action: "pause" | "abandon" | "resume";
  label: string;
}) {
  return (
    <form action={courseAction}>
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="action" value={action} />
      <Button type="submit" variant="text">
        {label}
      </Button>
    </form>
  );
}

export function CourseRow({
  course,
  index = 0,
  actions = true,
}: {
  course: CourseSummary;
  index?: number;
  /**
   * Whether the row carries the buttons that change a course.
   *
   * False in exactly one place, and for a reason worth stating: the assistant
   * renders this list inside a chat thread, and a widget there is inert by rule
   * (`ASSISTANT-PLAN.md` §6.1) — no forms, no buttons that mutate, links only.
   * Two of these three actions are hard to walk back, and a surface whose whole
   * premise is that it only *reads* must not be the fourth place they can be
   * pressed.
   */
  actions?: boolean;
}) {
  return (
    <Row className="rise flex-wrap" style={stagger(index)}>
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-accent">
          <SubjectIcon taxonomyParent={course.taxonomyParent} />
        </span>
        <span className="min-w-0 font-[550]">{course.name}</span>
      </span>

      <span className="flex shrink-0 flex-wrap items-center gap-3">
        <Status tone={TONE[course.status]}>{STATUS_LABEL[course.status]}</Status>

        {actions && course.status === "active" ? (
          <>
            <Action goalId={course.goalId} action="pause" label="Put aside" />
            <Action goalId={course.goalId} action="abandon" label="Stop it" />
          </>
        ) : null}

        {actions && isResumable(course.status) ? (
          <Action goalId={course.goalId} action="resume" label="Pick it up" />
        ) : null}

        {/*
         * A finished course has no action, and that is the honest shape. It
         * cannot be "un-finished", and offering to restart it would invite the
         * learner to re-run a path they have already proved every skill on —
         * what is left of it is decay, which `/mastery` and `/calendar` already
         * show and date.
         */}
      </span>
    </Row>
  );
}

export function CourseList({
  courses,
  actions = true,
}: {
  courses: readonly CourseSummary[];
  /** See `CourseRow` — false only where the surface may not mutate anything. */
  actions?: boolean;
}) {
  return (
    <RowList className="shadow-[var(--shadow-raised)]">
      {courses.map((course, i) => (
        <CourseRow
          key={course.goalId}
          course={course}
          index={i}
          actions={actions}
        />
      ))}
    </RowList>
  );
}
