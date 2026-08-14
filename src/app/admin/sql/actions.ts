"use server";

import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { getConsoleConnection } from "@/lib/admin/console-db";
import { recordAudit } from "@/lib/admin/audit";
import { runQuery, type QueryOutcome } from "@/lib/admin/sql";

/**
 * Running one statement, and remembering that it was run.
 *
 * `requireAdmin()` is called here and not merely on the page. This action is a
 * POST endpoint that exists independently of the UI around it, and it is the
 * single most valuable endpoint in the application to an attacker, so it
 * re-establishes who is calling before it does anything at all.
 *
 * The audit row is written on the *application's* connection, not the console's.
 * That is deliberate twice over: the console's transaction rolls back in read
 * mode and would take the log entry with it, and the console role has no
 * privilege to write `admin_audit` at all (see `grants.ts`) precisely so that a
 * write-mode session cannot erase its own trail.
 */

export interface ConsoleState {
  outcome: QueryOutcome | null;
  /** Echoed back so the textarea survives the round trip. */
  query: string;
  allowWrites: boolean;
}

export async function runQueryAction(
  _previous: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  const admin = await requireAdmin();

  const query = String(formData.get("query") ?? "");
  const allowWrites = formData.get("allowWrites") === "on";
  const confirm = String(formData.get("confirm") ?? "");

  const { runner, database } = getConsoleConnection();
  const actor = { actorId: admin.userId, actorEmail: admin.email };
  const action = allowWrites ? "sql.write" : "sql.read";

  // The typed confirmation is checked here, on the server, because the checkbox
  // and the text field are both just strings in a POST body that anyone with an
  // admin cookie can assemble by hand.
  if (allowWrites && confirm.trim().toLowerCase() !== database.toLowerCase()) {
    const message = `Type “${database}” in the confirmation field to run a statement in write mode. Nothing was executed.`;

    await recordAudit(getDb(), {
      ...actor,
      action,
      detail: { query },
      outcome: "denied",
      error: message,
    });

    return {
      outcome: { ok: false, error: message, durationMs: 0 },
      query,
      allowWrites,
    };
  }

  const outcome = await runQuery(runner, query, allowWrites);

  await recordAudit(getDb(), {
    ...actor,
    action,
    detail: { query },
    outcome: outcome.ok ? "ok" : "error",
    error: outcome.ok ? null : outcome.error,
    durationMs: outcome.durationMs,
    rowCount: outcome.ok ? outcome.rowCount : null,
  });

  return { outcome, query, allowWrites };
}
