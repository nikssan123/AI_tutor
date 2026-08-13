"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { getAnthropic } from "@/lib/ai/client";
import { resolvePack } from "@/lib/content/resolve";
import { toEngineGraph } from "@/lib/packs/validate";
import { activeGoal, masteryFor } from "@/lib/goals/store";
import { projectSkills } from "@/lib/goals/projection";
import { generateValidatedCurriculum } from "@/lib/curriculum/generate";
import { saveCurriculum } from "@/lib/curriculum/store";

/**
 * Builds the curriculum for a goal, on request.
 *
 * §14.9.3 — "sync only where a human is waiting." Generation takes tens of
 * seconds, so it is deliberately *not* on the goal form: creating a goal stays
 * instant, and the wait happens on the screen that is about to show the result,
 * where the learner asked for it. Moving it to Inngest is E7's job, which is
 * also when there is a session runner for the result to feed.
 */
export async function buildPathAction(goalId: string): Promise<void> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const db = getDb();
  const goal = await activeGoal(db, session.user.id);
  if (!goal || goal.id !== goalId) redirect("/today");

  const pack = await resolvePack(db, goal.packSlug);
  if (!pack) redirect("/today");

  const now = new Date().toISOString();
  const graph = toEngineGraph(pack);
  const mastery = await masteryFor(db, session.user.id, goal.packSlug);
  const projection = projectSkills({ graph, mastery, now });

  const outcome = await generateValidatedCurriculum(
    {
      client: getAnthropic(),
      db,
      userId: session.user.id,
      // Everyone is on the free cap until E13 brings billing. The cap being
      // real from the start is the point — §14.9.7's failure mode is a single
      // bug producing a 100× day, and that does not wait for a pricing page.
      plan: "free",
      projects: pack.projects.map((p) => ({
        rubricId: p.rubric,
        title: p.title,
        targetSkillIds: p.targetSkills,
        estimatedMinutes: p.estimatedMinutes,
      })),
    },
    {
      graph,
      goalSkillIds: projection.requiredSkillIds,
      mastery,
      now,
      constraints: {
        weeklyHours: goal.spec.weeklyHours,
        deadline: goal.spec.deadline,
      },
      rubricCriteria: new Map(
        pack.rubrics.map((r) => [r.slug, r.criteria.length]),
      ),
      rawGoal: goal.spec.rawGoal,
    },
  );

  if (outcome.draft !== null) {
    await saveCurriculum(db, {
      goalId: goal.id,
      packSlug: goal.packSlug,
      draft: outcome.draft,
      report: outcome.report,
      source: outcome.source,
      now: new Date(),
    });
  }

  revalidatePath(`/goals/${goalId}/path`);
}
