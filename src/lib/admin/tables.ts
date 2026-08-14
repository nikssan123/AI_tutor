import { is } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * The catalogue the data browser and the SQL console are built on.
 *
 * Tables come from the Drizzle schema rather than from `information_schema`,
 * which is the whole security posture in one decision: the browser can only
 * ever reach a table this application declared. A new table in the database —
 * an extension's bookkeeping, a half-finished migration, something an attacker
 * created — is invisible here because it is not in this module's input.
 *
 * That also means every identifier the browser interpolates into SQL comes from
 * a Drizzle column object, never from the URL. The `[table]` route segment is
 * matched against this catalogue and then thrown away; what reaches the query
 * builder is the object we looked up.
 */

/** What a redacted value renders as, everywhere. */
export const REDACTED = "••••••••";

/**
 * Columns that must never reach a screen, keyed by physical table name.
 *
 * These are not "sensitive" in the privacy sense — they are *live credentials*.
 * A `session.token` copied off an admin screen is a working login for that
 * account; `verification.value` is an unspent password-reset code; the
 * `account` columns are a password hash and third-party OAuth tokens. Printing
 * any of them turns "read the admin console" into "become any user".
 *
 * Redaction here is the second line, not the first. `pnpm console:role`
 * generates column-level `GRANT`s that leave these out entirely, so the console
 * role is refused by Postgres before this list is ever consulted. The list
 * still matters because it also covers the browser, and because the console
 * falls back to the application's own connection when no role is configured.
 */
export const SECRET_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  session: ["token"],
  account: ["password", "access_token", "refresh_token", "id_token"],
  verification: ["value"],
};

/**
 * The same idea applied to a result set whose provenance is unknown.
 *
 * An arbitrary query has no table to look up — `select token from session s`
 * and `select t from (select token as t from session) x` are the same leak
 * wearing different names. So console output is redacted on the column *label*,
 * matched loosely, and anything that reads like a credential is blanked.
 *
 * This is deliberately over-eager: a column innocently called `token_count`
 * gets redacted too. Losing a number to caution is cheaper than printing a
 * session token, and the operator can always alias around it.
 */
export const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /password/i,
  /token/i,
  /secret/i,
  /\bhash\b/i,
  /api[_-]?key/i,
];

/**
 * Every name declared secret anywhere, as an exact-match set.
 *
 * Derived rather than written out, which closes a gap the patterns alone left:
 * `verification.value` is an unspent password-reset code, and no honest
 * pattern catches a column called `value` — `/value/` would blank half the
 * schema. Deriving means the console redacts exactly the names the browser
 * already withholds, and a credential column added later is covered by both
 * the moment it is declared once.
 */
const SECRET_LABELS: ReadonlySet<string> = new Set(
  Object.values(SECRET_COLUMNS).flat(),
);

export function isSecretColumn(table: string, column: string): boolean {
  return (SECRET_COLUMNS[table] ?? []).includes(column);
}

/** Whether a result-set column label looks like a credential. */
export function isSecretLabel(label: string): boolean {
  return (
    SECRET_LABELS.has(label.toLowerCase()) ||
    SECRET_NAME_PATTERNS.some((pattern) => pattern.test(label))
  );
}

export interface ColumnInfo {
  /** The physical column name, as Postgres knows it. */
  name: string;
  sqlType: string;
  notNull: boolean;
  primary: boolean;
  secret: boolean;
  /** The Drizzle column, for building queries against it. */
  column: PgColumn;
}

export interface TableInfo {
  /** The physical table name — also the `[table]` route segment. */
  name: string;
  table: PgTable;
  columns: ColumnInfo[];
  /** Empty for the rare table without one; the browser then cannot sort stably. */
  primaryKey: string[];
}

let catalogue: TableInfo[] | undefined;

/**
 * Every table in the schema, alphabetically.
 *
 * Built once. `getTableConfig` walks a table's symbols on each call, and this
 * runs on every render of every browser page.
 */
export function listTables(): TableInfo[] {
  // Widened to `unknown` first: the schema's exports are each a distinct
  // literal table type, so a predicate narrowing to the general `PgTable` is
  // not assignable to that union without going through `unknown`.
  catalogue ??= Object.values(schema as Record<string, unknown>)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return {
        name: config.name,
        table,
        columns: config.columns.map((column) => ({
          name: column.name,
          sqlType: column.getSQLType(),
          notNull: column.notNull,
          primary: column.primary,
          secret: isSecretColumn(config.name, column.name),
          column,
        })),
        primaryKey: config.columns
          .filter((column) => column.primary)
          .map((column) => column.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return catalogue;
}

/** Test seam: drops the memoized catalogue. */
export function resetTables(): void {
  catalogue = undefined;
}

/**
 * Resolves a route segment to a table, or nothing.
 *
 * The caller is expected to `notFound()` on nothing rather than report "no such
 * table", so a probe cannot use this to map the schema.
 */
export function findTable(name: string): TableInfo | undefined {
  return listTables().find((info) => info.name === name);
}

/** The columns a browser is allowed to select — everything but the credentials. */
export function visibleColumns(info: TableInfo): ColumnInfo[] {
  return info.columns.filter((column) => !column.secret);
}
