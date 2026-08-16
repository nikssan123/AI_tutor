"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { activeGoal, setGoalDepth } from "@/lib/goals/store";
import { CourseDepthSpec } from "@/lib/contracts/goal";
import { claimPathBuild, finishPathBuild } from "@/lib/curriculum/build-state";
import { EVENTS, inngest } from "@/lib/inngest/client";

/**
 * Rebuilding the curriculum for a goal, on request.
 *
 * The door for a goal that predates the automatic build — creating a goal asks
 * the queue for a path (`start/actions.ts`) — and for a learner who changed
 * depth and wants the modules re-cut around the change.
 *
 * **It used to do the work here, and §14.9.3's "sync only where a human is
 * waiting" was the argument for it.** The argument was backwards. A human
 * waiting is the reason to get the work *off* the request: a server action
 * posts over `fetch`, so there is no navigation for the browser to spin, and
 * the learner pressed a button and watched an unchanged page for up to two
 * model calls and a validator. Nothing could tell them otherwise, because the
 * only record that anything was happening was the pending request itself —
 * reload it and the evidence was gone while the work carried on invisibly.
 *
 * So this claims `curriculum_build`, hands the event to the queue and returns.
 * The row is what the screen reads, and `buildCurriculumFor` — the same
 * function, still shared, so the two doors cannot build subtly different
 * courses — now runs where it can take as long as it takes.
 */
/**
 * Move the goal to another depth (PLAN-ADAPTATION).
 *
 * The value arrives from a form, so it is parsed rather than trusted: a posted
 * string that is not one of the three depths is dropped and the page re-renders
 * unchanged, instead of writing a spec the planner would later fail to read.
 *
 * No curriculum rebuild is triggered. The projection recomputes on every render
 * from mastery and the graph, so the path screen is correct immediately; the
 * stored curriculum is a separate artefact the learner asks for explicitly, and
 * regenerating it behind a radio button would spend a model call they did not
 * request.
 */
export async function setDepthAction(
  goalId: string,
  depth: string,
): Promise<void> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const parsed = CourseDepthSpec.safeParse(depth);
  if (!parsed.success) return;

  await setGoalDepth(getDb(), session.user.id, goalId, parsed.data);

  revalidatePath("/path");
  // The header on /today prices the same projection, so leaving it cached would
  // show two different courses on two screens.
  revalidatePath("/today");
}

export async function buildPathAction(goalId: string): Promise<void> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const db = getDb();

  /*
   * The ownership check the build used to do on our behalf.
   *
   * `buildCurriculumFor` still refuses a goal that is not this learner's active
   * one — it has to, because an event can arrive after they have moved on — but
   * that check now happens in a worker, minutes later, where it can only be
   * written into a row. Somebody posting another learner's goal id at this
   * endpoint would get a claimed build and a wait screen for a course they
   * cannot see, so it is refused here too, before anything is written.
   */
  const goal = await activeGoal(db, session.user.id);
  if (!goal || goal.id !== goalId) redirect("/today");

  // A second press while one is running joins it rather than starting another
  // — the row is the lock. Either way the screen below renders the wait.
  await claimPathBuild(db, goal.id);

  try {
    await inngest.send({
      name: EVENTS.buildPath,
      data: { userId: session.user.id, goalId: goal.id },
    });
  } catch (error) {
    /*
     * The learner is standing in front of this one, which is what makes it
     * different from `/start`'s dispatch of the same event: there, nobody is
     * waiting and a failure is logged and swallowed. Here, a swallowed failure
     * is a wait screen counting up to a ten-minute timeout for a run that was
     * never queued.
     *
     * So it is written into the row it claimed, and the screen says so on the
     * next refresh. In development the usual cause is the Inngest dev server
     * not running — `pnpm inngest:dev`, or the `inngest` service in
     * `docker-compose.yml`.
     */
    console.error("[path] could not queue a path build for", goal.id, error);
    await finishPathBuild(db, goal.id, {
      status: "failed",
      detail:
        "We could not hand the build over to be run. Nothing was started, and nothing was charged for.",
    });
  }

  revalidatePath("/path");
}
