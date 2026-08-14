import { desc } from "drizzle-orm";
import type { Db } from "@/db";
import { adminAudit } from "@/db/schema";

/**
 * The record of everything privileged that happened through `/admin`.
 *
 * Attempts, not just successes. A `denied` row — someone tried to delete their
 * own account, a query was rejected as multi-statement — is the row an
 * investigation actually wants, and a log that only remembers what worked
 * cannot distinguish a quiet system from a thwarted one.
 *
 * Writes are never swallowed. If the log cannot be written the caller sees the
 * error, because the alternative is a console that keeps working while silently
 * no longer being accountable.
 */

export type AuditOutcome = "ok" | "error" | "denied";

export interface AuditEntry {
  actorId: string;
  actorEmail: string;
  action: string;
  target?: string | null;
  detail?: unknown;
  outcome: AuditOutcome;
  error?: string | null;
  durationMs?: number | null;
  rowCount?: number | null;
}

/**
 * Anything that can insert — the database handle or a transaction handle.
 *
 * Narrowed to `insert` precisely so a `tx` satisfies it without a cast: the
 * whole point is that a mutation passes its own transaction and the audit row
 * commits or rolls back with the change it describes.
 */
export type AuditWriter = Pick<Db, "insert">;

export async function recordAudit(
  db: AuditWriter,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(adminAudit).values({
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    action: entry.action,
    target: entry.target ?? null,
    detail: entry.detail ?? null,
    outcome: entry.outcome,
    error: entry.error ?? null,
    durationMs: entry.durationMs ?? null,
    rowCount: entry.rowCount ?? null,
  });
}

/** How many entries the log page shows before paging would be needed. */
export const AUDIT_PAGE_SIZE = 100;

export interface AuditRow {
  id: string;
  actorEmail: string;
  action: string;
  target: string | null;
  detail: unknown;
  outcome: string;
  error: string | null;
  durationMs: number | null;
  rowCount: number | null;
  createdAt: Date;
}

export async function listAudit(
  db: Db,
  limit = AUDIT_PAGE_SIZE,
): Promise<AuditRow[]> {
  return db
    .select({
      id: adminAudit.id,
      actorEmail: adminAudit.actorEmail,
      action: adminAudit.action,
      target: adminAudit.target,
      detail: adminAudit.detail,
      outcome: adminAudit.outcome,
      error: adminAudit.error,
      durationMs: adminAudit.durationMs,
      rowCount: adminAudit.rowCount,
      createdAt: adminAudit.createdAt,
    })
    .from(adminAudit)
    .orderBy(desc(adminAudit.createdAt))
    .limit(limit);
}
