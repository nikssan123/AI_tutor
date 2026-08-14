"use client";

import { useActionState, useState } from "react";
import { Card, cx, Meta, Status } from "@/components/ui";
import { Cell, DataGrid } from "@/components/admin-grid";
import { MAX_ROWS } from "@/lib/admin/sql";
import { runQueryAction, type ConsoleState } from "./actions";

/**
 * The console's one client component.
 *
 * The rest of `/admin` is server-rendered forms that work with scripting off,
 * and this deliberately is not — for the same shape of reason the tutor panel
 * gives. A no-JS console would have to carry the statement in a `GET` query
 * string to render its result, and a URL that runs SQL is a URL the back button
 * re-runs, that sits in browser history, and that a proxy writes to an access
 * log. In write mode that is a statement executing twice because someone
 * reloaded. So the query is POSTed, and the result comes back in the action's
 * response rather than in an address.
 *
 * `useActionState` keeps the textarea's contents across the round trip, which
 * matters more here than anywhere else in the product: losing a query you spent
 * two minutes writing to a typo in it is the fastest way to make a tool
 * unpleasant.
 */

const INITIAL: ConsoleState = { outcome: null, query: "", allowWrites: false };

export function ConsoleForm({
  database,
  leastPrivilege,
}: {
  database: string;
  leastPrivilege: boolean;
}) {
  const [state, formAction, pending] = useActionState(runQueryAction, INITIAL);
  const [writeMode, setWriteMode] = useState(false);

  const outcome = state.outcome;

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <Meta>Statement</Meta>
          <textarea
            name="query"
            rows={8}
            required
            spellCheck={false}
            defaultValue={state.query}
            placeholder={'select id, email, plan from "user" order by created_at desc limit 20'}
            className="w-full resize-y rounded-[var(--radius-control)] border border-hairline bg-ground px-4 py-3 font-mono text-[length:var(--text-meta-size)] text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </label>

        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-hairline p-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="allowWrites"
              checked={writeMode}
              onChange={(event) => setWriteMode(event.target.checked)}
              className="size-4 accent-[var(--color-problem)]"
            />
            <span className="text-[length:var(--text-label-size)]">
              Allow writes — run outside a read-only transaction
            </span>
          </label>

          {writeMode ? (
            <label className="flex flex-col gap-1">
              <Meta>
                Type <code>{database}</code> to confirm. This commits.
              </Meta>
              <input
                name="confirm"
                autoComplete="off"
                spellCheck={false}
                className="max-w-xs rounded-[var(--radius-control)] border border-problem bg-ground px-3 py-2 font-mono text-ink"
              />
            </label>
          ) : (
            <Meta>
              Every statement runs inside <code>BEGIN READ ONLY</code>. Postgres
              rejects writes and DDL outright — there is no parser to get past.
            </Meta>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className={cx(
            "self-start rounded-[var(--radius-control)] px-5 py-2.5 font-[550] disabled:opacity-60",
            writeMode
              ? "bg-problem text-on-accent"
              : "bg-accent text-on-accent",
          )}
        >
          {pending ? "Running…" : writeMode ? "Run and commit" : "Run"}
        </button>
      </form>

      {!leastPrivilege ? (
        <Card className="border-l-4 border-l-attention">
          <Status tone="attention">
            Running as the application&rsquo;s own database role
          </Status>
          <Meta>
            <code>CONSOLE_DATABASE_URL</code> is not set, so credential columns
            are hidden by this application rather than refused by Postgres, and
            the role may be a superuser — which can read files off the database
            host even in a read-only transaction. Run{" "}
            <code>pnpm console:role</code> to fix that.
          </Meta>
        </Card>
      ) : null}

      {outcome ? <Result outcome={outcome} /> : null}
    </div>
  );
}

/**
 * Exported for its own tests, the way `/admin`'s `formatCents` is: the branches
 * here (failed, truncated, redacted, empty) are the ones worth asserting
 * directly rather than through four form submissions.
 */
export function Result({
  outcome,
}: {
  outcome: NonNullable<ConsoleState["outcome"]>;
}) {
  if (!outcome.ok) {
    return (
      <Card className="border-l-4 border-l-problem">
        <Status tone="problem">Failed</Status>
        <p className="mt-2 whitespace-pre-wrap font-mono text-[length:var(--text-meta-size)] text-ink">
          {outcome.error}
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Status tone="verified">
          {outcome.rowCount} {outcome.rowCount === 1 ? "row" : "rows"}
        </Status>
        <Meta>{outcome.durationMs} ms</Meta>
        {outcome.truncated ? (
          <Meta>Stopped at {MAX_ROWS} — the rest was never fetched.</Meta>
        ) : null}
        {outcome.redacted.length > 0 ? (
          <Meta>Withheld: {outcome.redacted.join(", ")}</Meta>
        ) : null}
      </div>

      <DataGrid
        columns={outcome.columns}
        rows={outcome.rows.map((row) =>
          row.map((value, i) => <Cell key={i} value={value} />),
        )}
        empty="The statement returned no rows."
      />
    </div>
  );
}
