import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { tableCounts } from "@/lib/admin/browse";
import { listTables } from "@/lib/admin/tables";
import { Meta, stagger, Status } from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { Cell, DataGrid } from "@/components/admin-grid";

export const metadata: Metadata = {
  title: "Data",
  robots: { index: false, follow: false },
};

/**
 * Every table in the schema, with what is in it.
 *
 * The guard is called here, in the page, not in the layout — see
 * `src/lib/admin/guard.ts` for why that distinction is the security boundary
 * and not a stylistic one.
 */
export default async function DataIndexPage() {
  await requireAdmin();

  const counts = await tableCounts(getDb());
  const tables = listTables();
  const byName = new Map(counts.map((row) => [row.name, row.rows]));
  const total = counts.reduce((sum, row) => sum + row.rows, 0);

  return (
    <AppFrame>
      <AppHeader
        eyebrow="Operations"
        title="Data"
        lead="Every table this application declares, and nothing else."
        facts={
          <>
            <Meta>{tables.length} tables</Meta>
            <Meta>{total.toLocaleString("en-US")} rows</Meta>
            <Meta>
              Credential columns are never selected — see the SQL console for
              why.
            </Meta>
          </>
        }
      />

      <section className="rise flex flex-col gap-6" style={stagger(1)}>
        <DataGrid
          columns={["Table", "Rows", "Columns", "Withheld"]}
          align={(i) => i === 1 || i === 2 || i === 3}
          rows={tables.map((info) => {
            // Driven off the catalogue rather than off the counts, so a table
            // can never go missing from this page because a count did.
            const rows = byName.get(info.name)!;
            const withheld = info.columns.filter(
              (column) => column.secret,
            ).length;

            return [
              <Link
                key="n"
                href={`/admin/data/${info.name}`}
                className="font-mono font-[550] text-accent underline-offset-4 hover:underline"
              >
                {info.name}
              </Link>,
              <Cell key="r" value={rows.toLocaleString("en-US")} />,
              <Cell key="c" value={String(info.columns.length)} />,
              withheld === 0 ? (
                <span key="w" className="text-ink-faint">
                  —
                </span>
              ) : (
                <Status key="w" tone="attention">
                  {withheld}
                </Status>
              ),
            ];
          })}
        />
      </section>
    </AppFrame>
  );
}
