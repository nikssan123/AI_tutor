"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { activeGoal } from "@/lib/goals/store";
import { normaliseArtefact } from "@/lib/evaluation";
import { acceptImages } from "@/lib/submissions/images";
import { createSubmission } from "@/lib/submissions/store";
import { projectForBlock } from "@/lib/submissions/project";
import { EVENTS, inngest } from "@/lib/inngest/client";
import { entitlementsForUser } from "@/lib/billing/store";
import { consumeEvaluation } from "@/lib/billing/quota";
import { capture } from "@/lib/observability";

/**
 * Handing work in — §24 E8's front door.
 *
 * A form POST like everything else here, and for the same reason: this is the
 * moment the product either does the thing it promised or does not, and it must
 * not depend on a bundle downloading first.
 *
 * Nothing but `async` actions may be exported from this file — see
 * `@/lib/submissions/project`, which is where the one helper that used to live
 * here went after it broke the session page at bundle time.
 */

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

  /*
   * §24 E8.5 — the photographs, checked before anything is charged for.
   *
   * Ahead of the quota claim on purpose, and for the same reason the quota
   * claim is ahead of the row: a hand-in that will be refused must not cost an
   * evaluation. `acceptImages` decides against the *project's* declaration, so
   * a brief that takes none quietly ignores files rather than failing on them.
   */
  const files = formData
    .getAll("photos")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  const { images, refused } = await acceptImages(files, project.evidence);
  if (refused) redirect(`${returnTo}?error=${refused}`);

  /*
   * §14.9.7 limit 2 — "blocked with an upgrade prompt. This is the product's
   * meter (§20.1)."
   *
   * Claimed here, before the row and before the job, for two reasons. The
   * learner finds out at the moment they press the button rather than after
   * forty-five seconds of waiting for a grade that was never coming; and a
   * submission that will not be marked never becomes a queued row that has to
   * be explained later.
   */
  const { entitlements } = await entitlementsForUser(
    db,
    session.user.id,
    session.user.plan,
  );
  const quota = await consumeEvaluation(
    db,
    session.user.id,
    entitlements.evaluationsPerMonth,
  );

  if (!quota.ok) {
    capture(
      "quota_reached",
      { quota_type: "evaluation", used: quota.used, limit: quota.limit },
      session.user.id,
    );
    redirect(`${returnTo}?error=quota`);
  }

  const submissionId = await createSubmission(db, {
    userId: session.user.id,
    packSlug: pack.slug,
    projectSlug: project.slug,
    artefact: text,
    truncated,
    images,
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
