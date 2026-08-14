import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getConsoleConnection } from "@/lib/admin/console-db";
import { MAX_ROWS, STATEMENT_TIMEOUT_MS } from "@/lib/admin/sql";
import { Meta, stagger } from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { ConsoleForm } from "./console-form";

export const metadata: Metadata = {
  title: "SQL",
  robots: { index: false, follow: false },
};

/**
 * The SQL console.
 *
 * The page's own job is small: prove the caller is an admin, and tell the form
 * which database it is pointed at. Everything that makes this safe to exist
 * lives in `src/lib/admin/sql.ts`, which documents the layers.
 */
export default async function SqlPage() {
  await requireAdmin();

  const { database, leastPrivilege } = getConsoleConnection();

  return (
    <AppFrame width="full">
      <AppHeader
        eyebrow="Operations"
        title="SQL"
        lead="One statement at a time, against a role that cannot read a credential."
        facts={
          <>
            <Meta>{database}</Meta>
            <Meta>{STATEMENT_TIMEOUT_MS / 1000}s timeout</Meta>
            <Meta>{MAX_ROWS} rows max</Meta>
            <Link
              href="/admin/audit"
              className="text-[length:var(--text-meta-size)] font-[550] text-accent underline-offset-4 hover:underline"
            >
              Everything here is logged
            </Link>
          </>
        }
      />

      <section className="rise" style={stagger(1)}>
        <ConsoleForm database={database} leastPrivilege={leastPrivilege} />
      </section>
    </AppFrame>
  );
}
