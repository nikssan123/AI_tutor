"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { getAnthropic } from "@/lib/ai/client";
import { resolvePack } from "@/lib/content/resolve";
import { toEngineGraph } from "@/lib/packs/validate";
import { activeGoal, masteryFor, setGoalDepth } from "@/lib/goals/store";
import { CourseDepthSpec } from "@/lib/contracts/goal";
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

  revalidatePath(`/goals/${goalId}/path`);
  // The header on /today prices the same projection, so leaving it cached would
  // show two different courses on two screens.
  revalidatePath("/today");
}

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
  const projection = projectSkills({
    graph,
    mastery,
    now,
    depth: goal.spec.depth,
  });

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
