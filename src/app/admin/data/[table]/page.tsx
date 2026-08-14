import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { browseTable, formatCell, PAGE_SIZE } from "@/lib/admin/browse";
import { findTable, REDACTED } from "@/lib/admin/tables";
import { PLANS } from "@/lib/admin/users";
import { Card, cx, Meta, stagger, Status } from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { Cell, DataGrid } from "@/components/admin-grid";
import {
  deleteUserAction,
  revokeSessionsAction,
  setPlanAction,
} from "../actions";

export const metadata: Metadata = {
  title: "Table",
  robots: { index: false, follow: false },
};

/** Only the `user` table has quick actions; everything else is read-only. */
const ACTIONABLE = "user";

type Params = Promise<{ table: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** `searchParams` values can arrive as arrays; the browser wants one string. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  await requireAdmin();

  const { table } = await params;
  const query = await searchParams;

  // `notFound()` rather than a "no such table" message: an unknown segment
  // should not tell a prober which names exist.
  const info = findTable(table);
  if (!info) notFound();

  const result = await browseTable(getDb(), info, {
    page: one(query.page),
    sort: one(query.sort),
    direction: one(query.direction),
  });

  const notice = one(query.notice);
  const noticeOk = one(query.ok) === "1";
  const withheld = info.columns.filter((column) => column.secret);
  const actionable = info.name === ACTIONABLE;

  const href = (next: Record<string, string>) => {
    const params = new URLSearchParams({
      sort: result.sort,
      direction: result.direction,
      page: String(result.page),
      ...next,
    });
    return `/admin/data/${info.name}?${params.toString()}`;
  };

  const headers = result.columns.map((column) => (
    <Link
      key={column.name}
      href={href({
        sort: column.name,
        // Clicking the current sort column flips it; clicking a new one starts
        // at the top of that column rather than preserving an unrelated order.
        direction:
          result.sort === column.name && result.direction === "desc"
            ? "asc"
            : "desc",
        page: "1",
      })}
      className="inline-flex items-center gap-1 hover:text-ink"
    >
      <span className="font-mono">{column.name}</span>
      {result.sort === column.name ? (
        <span aria-hidden="true">{result.direction === "asc" ? "↑" : "↓"}</span>
      ) : null}
      {column.primary ? <span title="Primary key">•</span> : null}
    </Link>
  ));

  const rows = result.rows.map((row) => {
    const cells = result.columns.map((column) => (
      <Cell key={column.name} value={formatCell(row[column.name])} />
    ));

    if (!actionable) return cells;

    return [
      ...cells,
      <UserActions
        key="actions"
        userId={String(row.id)}
        email={String(row.email)}
        plan={String(row.plan)}
        role={String(row.role)}
      />,
    ];
  });

  return (
    <AppFrame width="full">
      <AppHeader
        eyebrow="Data"
        title={info.name}
        lead={
          actionable
            ? "Row actions are typed operations, confirmed, and written to the audit log."
            : "Read-only. Use the SQL console for anything this view cannot answer."
        }
        facts={
          <>
            <Meta>{result.total.toLocaleString("en-US")} rows</Meta>
            <Meta>
              {info.columns.length} columns
              {info.primaryKey.length > 0
                ? ` · key ${info.primaryKey.join(", ")}`
                : " · no primary key"}
            </Meta>
            <Link
              href="/admin/data"
              className="text-[length:var(--text-meta-size)] font-[550] text-accent underline-offset-4 hover:underline"
            >
              All tables
            </Link>
          </>
        }
      />

      {notice ? (
        <Card
          className={cx(
            "rise border-l-4",
            noticeOk ? "border-l-accent" : "border-l-problem",
          )}
        >
          <Status tone={noticeOk ? "verified" : "problem"}>{notice}</Status>
        </Card>
      ) : null}

      {withheld.length > 0 ? (
        <Card className="rise">
          <Meta>
            Not selected: {withheld.map((column) => column.name).join(", ")}.
            These are live credentials — a session token or reset code read off
            this screen is a working login. They render as {REDACTED} and the
            console role has no grant to select them at all.
          </Meta>
        </Card>
      ) : null}

      <section className="rise flex flex-col gap-4" style={stagger(1)}>
        <DataGrid
          columns={actionable ? [...headers, "Actions"] : headers}
          rows={rows}
          stickyLast={actionable}
          empty={`${info.name} is empty.`}
        />

        {result.pages > 1 ? (
          <nav
            aria-label="Pages"
            className="flex items-center justify-between gap-4"
          >
            <Meta>
              Page {result.page} of {result.pages} · {PAGE_SIZE} per page
            </Meta>
            <span className="flex gap-4">
              {result.page > 1 ? (
                <Link
                  href={href({ page: String(result.page - 1) })}
                  className="font-[550] text-accent underline-offset-4 hover:underline"
                >
                  ← Previous
                </Link>
              ) : null}
              {result.page < result.pages ? (
                <Link
                  href={href({ page: String(result.page + 1) })}
                  className="font-[550] text-accent underline-offset-4 hover:underline"
                >
                  Next →
                </Link>
              ) : null}
            </span>
          </nav>
        ) : null}
      </section>
    </AppFrame>
  );
}

/**
 * The per-row actions, behind a `<details>`.
 *
 * A disclosure rather than a modal or a menu because it needs no JavaScript —
 * the whole admin surface stays usable with scripting off, which is also what
 * makes it testable without a browser. Delete asks for the email to be typed
 * because the id came from whichever row's button was clicked, and that is
 * exactly the mistake the confirmation exists to catch.
 */
function UserActions({
  userId,
  email,
  plan,
  role,
}: {
  userId: string;
  email: string;
  plan: string;
  role: string;
}) {
  return (
    <details className="min-w-56">
      <summary className="cursor-pointer text-accent">Actions</summary>
      <div className="mt-3 flex flex-col gap-3">
        {/*
          A select rather than a "move to the other one" button.
          `PLANS.find(c => c !== plan)` was only ever correct because there were
          exactly two plans; with four it picks whichever happens to come first
          and quietly moves a Pro learner to Free.

          Note what this still is: a change to the cached `user.plan` column
          with no invoice behind it. `setUserPlan` says "Stripe is unchanged"
          for that reason, and the supported way to give somebody a plan they
          did not buy is a `plan_grant` row that carries an end date.
        */}
        <form action={setPlanAction} className="flex flex-col gap-2">
          <input type="hidden" name="userId" value={userId} />
          <label className="flex items-center gap-2">
            <span className="sr-only">Plan</span>
            <select
              name="plan"
              defaultValue={plan}
              className="rounded-[var(--radius-control)] border border-hairline bg-ground px-2 py-1"
            >
              {PLANS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="text-accent underline-offset-4 hover:underline self-start"
          >
            Set plan
          </button>
        </form>

        <form action={revokeSessionsAction}>
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            className="text-accent underline-offset-4 hover:underline"
          >
            Sign out everywhere
          </button>
        </form>

        {role === "admin" ? (
          <Meta>
            Admins cannot be deleted here. Revoke with{" "}
            <code>pnpm admin:grant --revoke</code> first.
          </Meta>
        ) : (
          <form action={deleteUserAction} className="flex flex-col gap-2">
            <input type="hidden" name="userId" value={userId} />
            <label className="flex flex-col gap-1">
              <Meta>Type {email} to delete</Meta>
              <input
                name="confirmEmail"
                autoComplete="off"
                required
                className="rounded-[var(--radius-control)] border border-hairline bg-ground px-2 py-1 font-mono text-ink"
              />
            </label>
            <button
              type="submit"
              className="self-start text-problem underline-offset-4 hover:underline"
            >
              Delete account
            </button>
          </form>
        )}
      </div>
    </details>
  );
}
