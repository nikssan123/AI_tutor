"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { activeGoal } from "@/lib/goals/store";
import { normaliseArtefact } from "@/lib/evaluation";
import { createSubmission } from "@/lib/submissions/store";
import { EVENTS, inngest } from "@/lib/inngest/client";
import type { DomainPack } from "@/lib/packs/types";

/**
 * Handing work in — §24 E8's front door.
 *
 * A form POST like everything else here, and for the same reason: this is the
 * moment the product either does the thing it promised or does not, and it must
 * not depend on a bundle downloading first.
 */

/**
 * The project an `apply` block is asking for.
 *
 * A block carries a rubric id rather than a project slug (§14.9.2's session
 * contract), so the project is the one that publishes that rubric. Falling back
 * to a project targeting the skill covers a block composed before the pack had
 * rubrics on its projects — a thin pack, not a broken one.
 */
export function projectForBlock(
  pack: DomainPack,
  rubricId: string | null,
  skillSlug: string,
) {
  const byRubric = rubricId
    ? pack.projects.find((p) => p.rubric === rubricId)
    : undefined;

  return (
    byRubric ?? pack.projects.find((p) => p.targetSkills.includes(skillSlug))
  );
}

export async function submitWorkAction(formData: FormData): Promise<void> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const db = getDb();
  const goal = await activeGoal(db, session.user.id);
  if (!goal) redirect("/today");

  const pack = await resolvePack(db, goal.packSlug);
  if (!pack) redirect("/today");

  const skillSlug = String(formData.get("skill") ?? "");
  const rubricId = String(formData.get("rubric") ?? "") || null;
  const returnTo = String(formData.get("returnTo") ?? "/today");

  const project = projectForBlock(pack, rubricId, skillSlug);
  const skill = pack.skills.find((s) => s.slug === skillSlug);

  // Nothing to mark it against. The apply block says so rather than offering a
  // box that files work nowhere.
  if (!project || !skill) redirect(returnTo);

  const { text, truncated } = normaliseArtefact(
    String(formData.get("work") ?? ""),
  );
  if (text.length === 0) redirect(`${returnTo}?error=empty`);

  const submissionId = await createSubmission(db, {
    userId: session.user.id,
    packSlug: pack.slug,
    projectSlug: project.slug,
    artefact: text,
    truncated,
    skillSlug: skill.slug,
    now: new Date(),
  });

  // Marking is two deep-tier calls and about a minute; it cannot run here.
  await inngest.send({
    name: EVENTS.evaluate,
    data: { submissionId, userId: session.user.id },
  });

  redirect(`/submission/${submissionId}`);
}
