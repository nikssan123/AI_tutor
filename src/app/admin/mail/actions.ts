"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { TEMPLATES } from "@/lib/email/catalog";
import { changeThreadStatus, sendTemplatedEmail } from "@/lib/mail/send";

/**
 * The two things an operator can do to the outside world from `/admin/mail`.
 *
 * Each calls `requireAdmin()` itself. A Server Action is a public POST endpoint
 * regardless of what the page that rendered the button looked like — the
 * Next.js guide is explicit that "render-time gating is not a security
 * boundary, because requests can be sent without going through the UI"
 * (`next/dist/docs/01-app/02-guides/server-actions.md`). That matters more here
 * than anywhere else in the console: everything else under `/admin` changes our
 * own data, and these two send mail to a person.
 *
 * The outcome comes back as a redirect carrying a notice rather than as a
 * return value, so both work with scripting turned off — a plain
 * `<form action={…}>` POST and a normal navigation.
 *
 * Only async functions are exported — `actions:audit` enforces that, because a
 * constant exported from a `"use server"` file type-checks, lints, passes
 * tests, and then takes the route down in the bundler.
 */

/** Sends the operator back where they were, carrying the result. */
async function finish(
  path: string,
  result: { ok: boolean; message: string },
): Promise<never> {
  revalidatePath(path);
  const query = new URLSearchParams({
    notice: result.message,
    ok: result.ok ? "1" : "0",
  });
  redirect(`${path}?${query.toString()}`);
}

/**
 * Collects the variables a template declares, and nothing else.
 *
 * Reading the form by the template's own field list rather than by iterating
 * the POST body is what stops an extra field appearing in a rendered message:
 * the catalog decides what a template interpolates, not the request.
 */
async function variablesFrom(
  formData: FormData,
  templateId: string,
): Promise<Record<string, string>> {
  const template = TEMPLATES.find((entry) => entry.id === templateId);
  const values: Record<string, string> = {};

  for (const variable of template?.variables ?? []) {
    values[variable.name] = String(formData.get(variable.name) ?? "");
  }
  return values;
}

export async function sendMailAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const templateId = String(formData.get("template") ?? "");
  const threadId = String(formData.get("threadId") ?? "");

  const result = await sendTemplatedEmail(getDb(), admin, {
    templateId,
    ...(threadId === "" ? { to: String(formData.get("to") ?? "") } : { threadId }),
    locale: String(formData.get("locale") ?? ""),
    variables: await variablesFrom(formData, templateId),
  });

  // Back to the conversation when there is one to go back to — which there is
  // even for a send that failed, because the failure is recorded on it.
  await finish(
    result.threadId === undefined
      ? "/admin/mail/compose"
      : `/admin/mail/${result.threadId}`,
    result,
  );
}

export async function setThreadStatusAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const threadId = String(formData.get("threadId") ?? "");

  const result = await changeThreadStatus(
    getDb(),
    admin,
    threadId,
    String(formData.get("status")) === "closed" ? "closed" : "open",
  );

  await finish(`/admin/mail/${threadId}`, result);
}
