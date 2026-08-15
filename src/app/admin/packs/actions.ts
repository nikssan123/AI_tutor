"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { discardPack, promotePack } from "@/lib/admin/generated";
import { findBuild, startBuild } from "@/lib/packs/build";
import { EVENTS, inngest } from "@/lib/inngest/client";

/**
 * The two decisions a reviewer can make about a Generated pack.
 *
 * Both re-check their own preconditions rather than trusting the page that
 * rendered the button — `requireAdmin` because a server action is a public
 * endpoint whatever the page around it looked like, and the promotion gate
 * because the numbers can move between a reviewer loading the queue and
 * clicking.
 */

export async function promotePackAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const slug = String(formData.get("slug") ?? "");

  // The reviewer's own name goes on the pack: §7.1's `reviewedBy` is a claim
  // about who read it, and "system" would make the field worthless.
  await promotePack(getDb(), slug, admin.email);
  revalidatePath("/admin/packs");
}

export async function discardPackAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const slug = String(formData.get("slug") ?? "");

  await discardPack(getDb(), slug);
  revalidatePath("/admin/packs");
}

/**
 * Retries a build that stopped — the only place a retry can now be started.
 *
 * It used to be a button on the learner's wait screen, which asked somebody
 * with no way to tell a bad subject from a bad afternoon to spend four model
 * calls and about a pound on a guess. Here the person pressing it has the drop
 * log, the reason, and the rest of the queue in front of them.
 *
 * `startBuild` before the dispatch, exactly as `/start` does: it claims the
 * slug, so two operators reading the same list cannot start two runs of the
 * same subject. A slug already building is left alone rather than restarted —
 * the answer to "is this one moving" is the wait the row is already recording.
 */
export async function retryBuildAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const db = getDb();
  const slug = String(formData.get("slug") ?? "").trim();
  if (slug.length === 0) return;

  const build = await findBuild(db, slug);
  if (!build) return;

  /*
   * The learner who asked, not the operator pressing the button.
   *
   * `requestedBy` decides two things downstream — whose ceiling the run is
   * charged against, and whether the catalogue subsidises it — and both should
   * answer for the person who wanted the subject. An admin retry that put the
   * operator's own id on the row would bill support for a learner's course, and
   * would quietly move the subject out from under `mayBuild`'s "you already own
   * this one" so the learner could no longer see it as theirs.
   */
  const started = await startBuild(db, {
    slug,
    subject: build.subject,
    userId: build.requestedBy ?? admin.userId,
  });

  if (started.kind === "started") {
    await inngest.send({
      name: EVENTS.buildPack,
      data: {
        slug,
        subject: build.subject,
        userId: build.requestedBy ?? admin.userId,
      },
    });
  }

  revalidatePath("/admin/packs");
}
