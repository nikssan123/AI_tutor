"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { discardPack, promotePack } from "@/lib/admin/generated";

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
