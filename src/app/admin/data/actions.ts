"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import {
  deleteUserAccount,
  revokeUserSessions,
  setUserPlan,
  type ActionResult,
} from "@/lib/admin/users";

/**
 * The `user` table's quick actions.
 *
 * Each one calls `requireAdmin()` itself. A Server Action is a public POST
 * endpoint regardless of what the page that rendered the button looked like —
 * the Next.js guide is explicit that "render-time gating is not a security
 * boundary, because requests can be sent without going through the UI"
 * (`next/dist/docs/01-app/02-guides/server-actions.md`). The button being
 * absent from a non-admin's screen protects nothing.
 *
 * The outcome comes back as a redirect carrying a notice rather than as a
 * return value, so every one of these works with scripting turned off. The
 * result is a plain `<form action={...}>` POST and a normal navigation.
 *
 * Only async functions are exported from this module — `actions:audit` enforces
 * that, because a constant exported from a `"use server"` file type-checks,
 * lints, passes tests, and then takes the route down in the bundler.
 */

/** Sends the operator back to the row they acted on, carrying the result. */
async function finish(result: ActionResult): Promise<never> {
  revalidatePath("/admin/data/user");
  const query = new URLSearchParams({
    notice: result.message,
    ok: result.ok ? "1" : "0",
  });
  redirect(`/admin/data/user?${query.toString()}`);
}

export async function setPlanAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  await finish(
    await setUserPlan(
      getDb(),
      { userId: admin.userId, email: admin.email },
      String(formData.get("userId") ?? ""),
      String(formData.get("plan") ?? ""),
    ),
  );
}

export async function revokeSessionsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  await finish(
    await revokeUserSessions(
      getDb(),
      { userId: admin.userId, email: admin.email },
      String(formData.get("userId") ?? ""),
    ),
  );
}

export async function deleteUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  await finish(
    await deleteUserAccount(
      getDb(),
      { userId: admin.userId, email: admin.email },
      String(formData.get("userId") ?? ""),
      String(formData.get("confirmEmail") ?? ""),
    ),
  );
}
