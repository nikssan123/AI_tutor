"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { getAnthropic } from "@/lib/ai/client";
import { setGoalDepth } from "@/lib/goals/store";
import { CourseDepthSpec } from "@/lib/contracts/goal";
import { buildCurriculumFor } from "@/lib/curriculum/build";

/**
 * Rebuilding the curriculum for a goal, on request.
 *
 * §14.9.3 — "sync only where a human is waiting" — is why this stayed a server
 * action rather than moving wholesale to the queue. It is no longer the *only*
 * way a path gets built: creating a goal now asks for one (`start/actions.ts`),
 * and this is what remains once that is true — the door for a goal that predates
 * the automatic build, and for a learner who changed depth and wants the modules
 * re-cut around the change.
 *
 * The work itself is `buildCurriculumFor`, shared with the queue, so the two
 * cannot drift into building subtly different courses.
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

  const outcome = await buildCurriculumFor(
    { db: getDb(), client: getAnthropic() },
    { userId: session.user.id, goalId },
  );

  // Two of the three failures mean there is no path screen to come back to: the
  // goal is not this learner's active one, or the pack it was created against
  // is gone. Both used to be an ownership check and a `resolvePack` here, and
  // both still land on `/today`. The third — nothing left to teach — is a state
  // the screen itself has something to say about, so it re-renders.
  if (!outcome.built && outcome.reason !== "nothing-to-teach") redirect("/today");

  revalidatePath("/path");
}
