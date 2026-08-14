import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { AUDIT_PAGE_SIZE, listAudit } from "@/lib/admin/audit";
import { formatCell } from "@/lib/admin/browse";
import { Meta, stagger, Status, type StatusTone } from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { Cell, DataGrid } from "@/components/admin-grid";

export const metadata: Metadata = {
  title: "Audit",
  robots: { index: false, follow: false },
};

export function toneForOutcome(outcome: string): StatusTone {
  if (outcome === "ok") return "verified";
  return outcome === "denied" ? "attention" : "problem";
}

/**
 * What the detail column shows.
 *
 * For a SQL row that is the statement itself, which is the only thing anyone
 * reading this log wants to see. For a quick action it is the before-and-after.
 */
export function summarize(detail: unknown): string {
  if (detail === null || detail === undefined) return "";
  if (typeof detail === "object" && "query" in detail) {
    return String((detail as { query: unknown }).query);
  }
  return JSON.stringify(detail);
}

/**
 * The log of every privileged act.
 *
 * Read-only, and there is no delete button by design — the console role has no
 * grant to write this table at all, so an operator who wants a row gone has to
 * go to the database with different credentials, which is exactly the friction
 * that makes the log worth keeping.
 */
export default async function AuditPage() {
  await requireAdmin();

  const entries = await listAudit(getDb());

  return (
    <AppFrame width="full">
      <AppHeader
        eyebrow="Operations"
        title="Audit"
        lead="Every query and every row action, including the ones that were refused."
        facts={
          <>
            <Meta>
              {entries.length === AUDIT_PAGE_SIZE
                ? `Latest ${AUDIT_PAGE_SIZE}`
                : `${entries.length} entries`}
            </Meta>
            <Meta>Times are UTC</Meta>
          </>
        }
      />

      <section className="rise flex flex-col gap-6" style={stagger(1)}>
        <DataGrid
          columns={["When", "Who", "Action", "Target", "Outcome", "Detail", "ms", "Rows"]}
          align={(i) => i === 6 || i === 7}
          empty="Nothing has been done through the admin console yet."
          rows={entries.map((entry) => [
            <Cell key="t" value={formatCell(entry.createdAt)} />,
            <Cell key="w" value={entry.actorEmail} />,
            <Cell key="a" value={entry.action} />,
            <Cell key="g" value={entry.target ?? "null"} />,
            <Status key="o" tone={toneForOutcome(entry.outcome)}>
              {entry.outcome}
            </Status>,
            <span
              key="d"
              className="block max-w-md whitespace-pre-wrap break-all font-mono text-ink-muted"
            >
              {entry.error ?? summarize(entry.detail)}
            </span>,
            <Cell key="m" value={entry.durationMs === null ? "null" : String(entry.durationMs)} />,
            <Cell key="r" value={entry.rowCount === null ? "null" : String(entry.rowCount)} />,
          ])}
        />
      </section>
    </AppFrame>
  );
}
