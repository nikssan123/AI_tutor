"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { isLearnerAction, RESULT_OF } from "@/lib/goals/lifecycle";
import { setGoalStatus } from "@/lib/goals/store";

/**
 * Pause a course, stop it, or pick one back up.
 *
 * A form POST rather than anything client-side, like every other transition in
 * the product: the screen stays a pure function of what is stored, and a
 * refresh re-reads rather than re-submits.
 *
 * There is deliberately no "finish" here. §4.2 law 1 allows a mastery claim
 * only from a graded observation on the learner's own work, and a button
 * marking a whole course complete is that same self-declaration one level up.
 * `achieved` is written by `markAchievedIfComplete` when the evidence says so
 * and at no other time.
 */
export async function courseAction(formData: FormData): Promise<void> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const goalId = formData.get("goalId");
  const action = formData.get("action");

  // Both come off a form, so both are untrusted. An unknown action is dropped
  // rather than defaulted — a default here would pick a status on the
  // learner's behalf, and two of the three are hard to undo.
  if (typeof goalId !== "string" || !isLearnerAction(action)) {
    redirect("/progress");
  }

  await setGoalStatus(getDb(), session.user.id, goalId, RESULT_OF[action]);

  // Every authenticated screen reads the goal, and three of them change shape
  // entirely depending on whether one is running.
  revalidatePath("/", "layout");
  redirect(action === "resume" ? "/today" : "/progress");
}
