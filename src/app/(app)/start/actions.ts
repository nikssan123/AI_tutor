"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { findPack } from "@/lib/content";
import { cookieName } from "@/lib/check/session";
import { masteryFromCheck, parseGoalForm } from "@/lib/goals/intake";
import { createGoal } from "@/lib/goals/store";

/**
 * §24 E3 — creating the goal, as a plain form POST.
 *
 * No client JavaScript, for the same reason the Skill Check has none: this is
 * the one screen between signing up and having a plan, and a form that needs a
 * bundle to download before it works is a form some people never submit.
 */
export async function createGoalAction(formData: FormData): Promise<void> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const topic = String(formData.get("topic") ?? "");
  const pack = findPack(topic);
  if (!pack) redirect("/start?error=subject");

  const parsed = parseGoalForm(formData, pack);
  if (!parsed.ok) {
    redirect(`/start?error=${encodeURIComponent(parsed.error)}`);
  }

  const jar = await cookies();
  const now = new Date();

  // §24 E11 — whatever the learner already answered anonymously comes with
  // them. Replayed through the engine rather than trusted (see intake.ts).
  const mastery = masteryFromCheck(
    pack,
    jar.get(cookieName(topic))?.value,
    now.toISOString(),
  );

  await createGoal(getDb(), {
    userId: session.user.id,
    packSlug: pack.slug,
    spec: parsed.spec,
    mastery,
    now,
  });

  redirect("/today");
}
