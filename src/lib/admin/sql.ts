import { isSecretLabel, REDACTED } from "./tables";

/**
 * The SQL console's execution engine.
 *
 * The security model is layered, and the layers are deliberately not the same
 * kind of thing — a bypass of one is not a bypass of the next:
 *
 * 1. **Authorization.** `requireAdmin()` in the page and again in the action.
 * 2. **The database refuses writes.** A read-mode query runs inside
 *    `BEGIN READ ONLY`, so `UPDATE`, `DELETE` and every form of DDL are
 *    rejected by Postgres itself. There is no statement to smuggle past a
 *    parser here, because no parser is deciding.
 * 3. **A least-privilege role.** `CONSOLE_DATABASE_URL` points at a non-
 *    superuser whose grants are column-level: credential columns are simply not
 *    selectable, and `user.role` is not updatable, so the CLI-only admin-grant
 *    rule in `src/lib/admin/grant.ts` survives even in write mode. Without it
 *    the console falls back to the application's connection, which in this
 *    deployment is a superuser that can read files off the database host — so
 *    the fallback is loudly flagged in the UI rather than quietly tolerated.
 * 4. **Bounded cost.** A statement timeout, and a cursor that stops reading
 *    after `MAX_ROWS`, so `select * from a_big_table` cannot exhaust either the
 *    database's patience or this process's memory.
 * 5. **Redaction.** Result columns whose label reads like a credential are
 *    blanked, which is what covers the fallback connection in layer 3.
 * 6. **An audit row** for every attempt, written by the caller on a separate
 *    connection so the console transaction's rollback cannot take it with it.
 *
 * Note what is *not* load-bearing: the lexer below never decides whether
 * something is allowed to run. It exists so a mistake is caught early with a
 * good message, and the comments say so where it is used.
 */

/** Rows past this are not fetched at all — the cursor stops. */
export const MAX_ROWS = 500;

/** Long enough for a real analytical query, short enough to not wedge a pool. */
export const STATEMENT_TIMEOUT_MS = 5_000;

/** Cursor page size. Small enough that the overshoot past MAX_ROWS is trivial. */
export const CURSOR_SIZE = 100;

/**
 * Strips everything a `;` could be hiding inside, replacing it with spaces so
 * offsets are preserved.
 *
 * Handles the four things Postgres lets you quote with: line comments, block
 * comments (which nest), single-quoted strings (escaped by doubling), and
 * double-quoted identifiers (same). Dollar-quoting is handled by tag, because
 * `$fn$ ... $fn$` bodies routinely contain both semicolons and apostrophes.
 *
 * This is not a security boundary. It is what lets the console say "one
 * statement at a time" before running anything, instead of after.
 */
export function stripQuoted(query: string): string {
  const out: string[] = [];
  let i = 0;
  let depth = 0;

  const blank = (n: number) => out.push(" ".repeat(n));

  while (i < query.length) {
    const rest = query.slice(i);

    if (depth > 0) {
      if (rest.startsWith("/*")) {
        depth++;
        blank(2);
        i += 2;
      } else if (rest.startsWith("*/")) {
        depth--;
        blank(2);
        i += 2;
      } else {
        blank(1);
        i += 1;
      }
      continue;
    }

    if (rest.startsWith("/*")) {
      depth = 1;
      blank(2);
      i += 2;
      continue;
    }

    if (rest.startsWith("--")) {
      const end = query.indexOf("\n", i);
      const stop = end === -1 ? query.length : end;
      blank(stop - i);
      i = stop;
      continue;
    }

    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = query.indexOf(tag, i + tag.length);
      const stop = end === -1 ? query.length : end + tag.length;
      blank(stop - i);
      i = stop;
      continue;
    }

    const ch = query[i]!;
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < query.length) {
        if (query[j] === ch) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (query[j + 1] === ch) j += 2;
          else break;
        } else j += 1;
      }
      const stop = Math.min(j + 1, query.length);
      blank(stop - i);
      i = stop;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}

/**
 * Whether the operator typed more than one statement.
 *
 * Rejected because of write mode: `select 1; delete from "user"` is a
 * catastrophe that looks like a typo, and in a console that shows one result
 * grid the second statement's effect is invisible.
 */
export function hasMultipleStatements(query: string): boolean {
  return (
    stripQuoted(query)
      .split(";")
      .filter((part) => part.trim() !== "").length > 1
  );
}

/**
 * Whether a bounded cursor can serve this statement.
 *
 * A performance decision, not a safety one — safety is the enclosing READ ONLY
 * transaction. `EXPLAIN` and `SHOW` return their rows through a path a cursor
 * does not see, so they take the direct route; the row-returning statements
 * that might be enormous take the cursor.
 */
export function isCursorable(query: string): boolean {
  const first = /^\s*(\w+)/.exec(stripQuoted(query));
  if (!first) return false;
  return ["select", "with", "table", "values"].includes(
    first[1]!.toLowerCase(),
  );
}

export interface ColumnMeta {
  name: string;
}

export type ConsoleRows = Record<string, unknown>[] & {
  columns?: ColumnMeta[];
};

export interface ConsolePending extends PromiseLike<ConsoleRows> {
  cursor(
    size: number,
    fn: (rows: ConsoleRows) => Promise<void>,
  ): Promise<unknown>;
}

export interface ConsoleTx {
  unsafe(query: string): ConsolePending;
}

/** The slice of a postgres-js client this module needs; a fake in tests. */
export interface ConsoleRunner {
  begin<T>(options: string, fn: (tx: ConsoleTx) => Promise<T>): Promise<T>;
}

export interface QueryOk {
  ok: true;
  columns: string[];
  /** Already stringified and redacted — nothing raw reaches the client. */
  rows: string[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  /** Which labels were blanked, so the UI can say why. */
  redacted: string[];
}

export interface QueryFailed {
  ok: false;
  error: string;
  durationMs: number;
}

export type QueryOutcome = QueryOk | QueryFailed;

/**
 * Thrown from inside a cursor callback to abandon the rest of the result.
 *
 * Returning early only stops *collecting*: postgres-js keeps asking the server
 * for the next page, so `select * from a_big_table` would still stream the
 * whole table across the wire to be discarded. Throwing is what actually closes
 * the cursor, and it is caught immediately outside the transaction.
 */
class CursorStop extends Error {
  constructor() {
    super("cursor stopped at the row cap");
    this.name = "CursorStop";
  }
}

/** Raised before anything is sent to the database. */
const REJECTIONS = {
  empty: "Nothing to run.",
  multiple:
    "One statement at a time. Remove the extra semicolon and run them separately.",
} as const;

/**
 * Turns a Postgres error into something an operator can act on.
 *
 * The read-only rejection especially: the raw message is accurate but says
 * nothing about the checkbox that fixes it.
 */
export function explainError(message: string, allowWrites: boolean): string {
  if (/read-only transaction/i.test(message)) {
    return `${message} — tick “Allow writes” to run it.`;
  }
  if (/statement timeout/i.test(message)) {
    return `Cancelled after ${STATEMENT_TIMEOUT_MS / 1000}s. Narrow the query or add a LIMIT.`;
  }
  if (/permission denied/i.test(message)) {
    // The two causes are different problems with different fixes, and the
    // generic message sends you looking at the wrong one.
    return allowWrites
      ? `${message} — the console role's write grants are column-level and deliberately incomplete: \`user.role\` and the audit log are never writable, so admin is granted by \`pnpm admin:grant\` and nothing can erase its own trail. If no table is writable, the role was provisioned read-only; re-run \`pnpm console:role --apply --allow-writes\`.`
      : `${message} — the console role has column-level grants, so credential columns and \`select *\` on the tables holding them are refused. Name the columns you need.`;
  }
  if (allowWrites && /violates|constraint/i.test(message)) {
    return `${message} — the transaction was rolled back, nothing changed.`;
  }
  return message;
}

function labelsOf(rows: ConsoleRows, collected: Record<string, unknown>[]) {
  // postgres-js hangs `columns` off the row list. Falling back to the keys of
  // the first row keeps the grid honest when it is absent, and an empty result
  // legitimately has neither.
  const meta = rows.columns?.map((column) => column.name);
  return meta ?? (collected[0] ? Object.keys(collected[0]) : []);
}

/**
 * Runs one statement and returns a fully-rendered, fully-redacted grid.
 *
 * Read mode opens the transaction `read only`, which is what makes this safe to
 * expose at all. Write mode does not, and is expected to have been gated by an
 * explicit confirmation upstream.
 */
export async function runQuery(
  runner: ConsoleRunner,
  query: string,
  allowWrites = false,
): Promise<QueryOutcome> {
  const started = Date.now();
  const since = () => Date.now() - started;

  const trimmed = query.trim();
  if (trimmed === "")
    return { ok: false, error: REJECTIONS.empty, durationMs: 0 };
  if (hasMultipleStatements(trimmed))
    return { ok: false, error: REJECTIONS.multiple, durationMs: 0 };

  try {
    const collected: Record<string, unknown>[] = [];
    let labels: string[] = [];
    let truncated = false;

    await runner
      .begin(allowWrites ? "read write" : "read only", async (tx) => {
        // `SET LOCAL` so it expires with the transaction rather than leaking
        // onto the pooled connection and silently capping a later request.
        await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

        if (allowWrites || !isCursorable(trimmed)) {
          const rows = await tx.unsafe(trimmed);
          const all = Array.from(rows);
          truncated = all.length > MAX_ROWS;
          collected.push(...all.slice(0, MAX_ROWS));
          labels = labelsOf(rows, collected);
          return;
        }

        await tx.unsafe(trimmed).cursor(CURSOR_SIZE, async (rows) => {
          if (labels.length === 0) labels = labelsOf(rows, Array.from(rows));
          for (const row of rows) {
            if (collected.length >= MAX_ROWS) {
              truncated = true;
              throw new CursorStop();
            }
            collected.push(row);
          }
        });
      })
      .catch((error: unknown) => {
        // Only our own sentinel is swallowed. A real failure still has to
        // surface as a failure.
        if (!(error instanceof CursorStop)) throw error;
      });

    const redacted = labels.filter((label) => isSecretLabel(label));
    const secret = new Set(redacted);

    return {
      ok: true,
      columns: labels,
      rows: collected.map((row) =>
        labels.map((label) =>
          secret.has(label) ? REDACTED : renderValue(row[label]),
        ),
      ),
      rowCount: collected.length,
      truncated,
      durationMs: since(),
      redacted,
    };
  } catch (error) {
    return {
      ok: false,
      error: explainError(
        error instanceof Error ? error.message : String(error),
        allowWrites,
      ),
      durationMs: since(),
    };
  }
}

/**
 * A result value as a string.
 *
 * Everything is stringified server-side because the outcome crosses a Server
 * Action boundary: a `Buffer` or a pg range type is not serializable, and a
 * console that 500s on an unusual column type is a console people stop trusting.
 */
export function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
