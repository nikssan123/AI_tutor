import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { toEngineGraph } from "@/lib/packs/validate";
import { citedResources } from "@/lib/packs/resources";
import { activeGoal, masteryFor } from "@/lib/goals/store";
import { projectSkills } from "@/lib/goals/projection";
import { entitlementsForUser } from "@/lib/billing/store";
import { generateValidatedCurriculum, type CurriculumSource } from "./generate";
import { saveCurriculum } from "./store";

/**
 * Cutting a goal into modules, from wherever the request came from.
 *
 * This used to be the body of `buildPathAction` and nothing else, which is why
 * it had exactly one caller and exactly one door: a button on `/path` that
 * nothing in the product linked to. A learner who never found that page never
 * had a curriculum, and a learner with no curriculum has no checkpoints —
 * so `/calendar` had nothing to date, and the outline stayed grouped by the
 * pack's own areas instead of by modules that end in something you hand in.
 *
 * §2.2 is the reason that matters rather than merely being untidy: the product
 * is differentiated on graded work, and the modules are where the graded work is
 * attached to the path. A course without them is the generated-curriculum
 * product we said we were not building.
 *
 * So the work lives here, the button keeps it, and the queue gets it too.
 */

export type BuildFailure =
  /** The goal was put aside, finished, or never belonged to this learner. */
  | "not-active"
  /** A goal outliving the pack it was created against — a deployment event. */
  | "no-pack"
  /** Too little left to teach to form a path (`canonicalCurriculum` gave up). */
  | "nothing-to-teach";

export type BuildOutcome =
  | { built: true; source: CurriculumSource }
  | { built: false; reason: BuildFailure };

export interface BuildDeps {
  db: Db;
  client: Anthropic;
}

export interface BuildInput {
  userId: string;
  goalId: string;
}

/**
 * Builds and stores the curriculum for one goal.
 *
 * **The goal has to still be the active one.** `activeGoal` plus an id check is
 * how the server action has always scoped this, and it is worth more from the
 * queue than it was from the button: an event can arrive after the learner has
 * put that course aside and started another, and spending §20.2's dearest
 * one-off on a course nobody is taking is the exact failure mode a background
 * job invites. Not an error — there is simply nothing to build.
 */
export async function buildCurriculumFor(
  deps: BuildDeps,
  input: BuildInput,
): Promise<BuildOutcome> {
  const goal = await activeGoal(deps.db, input.userId);
  if (!goal || goal.id !== input.goalId) return { built: false, reason: "not-active" };

  const pack = await resolvePack(deps.db, goal.packSlug);
  if (!pack) return { built: false, reason: "no-pack" };

  // Resolved once: the plan decides both which model tier this may use and
  // whether a model is asked at all (§14.9.7 limit 1, and `aiCurriculum`).
  const resolved = await entitlementsForUser(deps.db, input.userId, undefined);

  const now = new Date().toISOString();
  const graph = toEngineGraph(pack);
  const mastery = await masteryFor(deps.db, input.userId, goal.packSlug);
  const projection = projectSkills({
    graph,
    mastery,
    now,
    depth: goal.spec.depth,
  });

  const outcome = await generateValidatedCurriculum(
    {
      client: deps.client,
      db: deps.db,
      userId: input.userId,
      plan: resolved.planId,
      aiCurriculum: resolved.entitlements.aiCurriculum,
      projects: pack.projects.map((p) => ({
        rubricId: p.rubric,
        title: p.title,
        targetSkillIds: p.targetSkills,
        estimatedMinutes: p.estimatedMinutes,
      })),
      // §14.6 check 7 has something to check as of the Resource Researcher.
      // Empty for a pack nobody has researched, which is the honest input:
      // the check reports "not researched" rather than "all citations fresh".
      resources: citedResources(pack),
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
      rubricCriteria: new Map(pack.rubrics.map((r) => [r.slug, r.criteria.length])),
      rawGoal: goal.spec.rawGoal,
    },
  );

  if (outcome.draft === null) return { built: false, reason: "nothing-to-teach" };

  await saveCurriculum(deps.db, {
    goalId: goal.id,
    packSlug: goal.packSlug,
    draft: outcome.draft,
    report: outcome.report,
    source: outcome.source,
    now: new Date(),
  });

  return { built: true, source: outcome.source };
}
