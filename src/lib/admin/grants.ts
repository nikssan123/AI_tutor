import { listTables, visibleColumns } from "./tables";

/**
 * The console role's privileges, generated from the schema.
 *
 * Generated rather than hand-written because a hand-written grant list is
 * wrong the day after the next migration, and the failure is silent in the
 * dangerous direction: a table added later would be readable in full,
 * credential columns and all, because nobody remembered to narrow it.
 *
 * The one non-obvious rule is that a table holding a credential gets a
 * **column-list** grant rather than a table grant with the column revoked.
 * Postgres accepts `REVOKE SELECT (token) ON session` after a table-wide
 * `GRANT SELECT ON session` — and then still lets the role read `token`,
 * because the table-level privilege is what is being checked. The revoke looks
 * like it worked and does nothing. Column-list grants are the form that holds.
 */

/** Columns the console role must never be able to write, by table. */
export const PROTECTED_UPDATE_COLUMNS: Readonly<
  Record<string, readonly string[]>
> = {
  // Keeps `pnpm admin:grant` the only way to become an admin. Without this a
  // write-mode console is a self-service promotion path, which is the exact
  // thing `src/lib/admin/grant.ts` refuses to build a button for.
  //
  // `plan` is here for the same reason one step down: a console that can set it
  // is a console that hands out paid plans, and the supported way to give
  // somebody a plan they did not buy is a `plan_grant` row with a reason on it.
  // It is also a derived cache of `subscription` (PLAN-MONETIZATION §4), so a
  // direct write desynchronises it from the row that owns it.
  user: ["role", "plan"],

  // The subscription is what Stripe says it is. Editing `status` here would
  // make the product disagree with the processor while the money kept flowing
  // the other way — and the webhook would overwrite the edit at the next
  // delivery anyway, so the only thing a hand-edit buys is confusion.
  subscription: ["status", "plan_id", "amount_cents", "currency"],
};

/**
 * Tables the console role may read but never modify, whatever the mode.
 *
 * The audit log is the obvious one and the important one. A write-mode console
 * that can `delete from admin_audit` is a console with no audit log — the
 * record of what someone did is only evidence if the person doing it cannot
 * reach it. Rows are written by the application's connection, which is a
 * different role entirely.
 */
export const APPEND_ONLY_TABLES: readonly string[] = ["admin_audit"];

/** Postgres identifier quoting — `user` is a reserved word and must be quoted. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** A single-quoted string literal, for the role password. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface GrantOptions {
  role: string;
  database: string;
  /** When false, the role gets SELECT only and write mode cannot function. */
  allowWrites?: boolean;
}

/**
 * Every statement needed to bring the console role to its intended privileges.
 *
 * Idempotent: it revokes first, so re-running after a migration converges
 * rather than accumulating.
 */
export function grantStatements(options: GrantOptions): string[] {
  const role = quoteIdentifier(options.role);
  const statements: string[] = [
    `revoke all on all tables in schema public from ${role};`,
    `revoke all on schema public from ${role};`,
    `grant connect on database ${quoteIdentifier(options.database)} to ${role};`,
    `grant usage on schema public to ${role};`,
  ];

  for (const info of listTables()) {
    const table = quoteIdentifier(info.name);
    const readable = visibleColumns(info);

    // A table with no secrets can take the plain table grant, which keeps
    // `select *` working — the form an operator reaches for first.
    statements.push(
      readable.length === info.columns.length
        ? `grant select on ${table} to ${role};`
        : `grant select (${readable.map((c) => quoteIdentifier(c.name)).join(", ")}) on ${table} to ${role};`,
    );

    if (!options.allowWrites || APPEND_ONLY_TABLES.includes(info.name)) continue;

    const protectedColumns = PROTECTED_UPDATE_COLUMNS[info.name] ?? [];
    const writable = info.columns.filter(
      (column) => !protectedColumns.includes(column.name),
    );

    statements.push(`grant insert, delete on ${table} to ${role};`);
    statements.push(
      protectedColumns.length === 0
        ? `grant update on ${table} to ${role};`
        : `grant update (${writable.map((c) => quoteIdentifier(c.name)).join(", ")}) on ${table} to ${role};`,
    );
  }

  return statements;
}

/**
 * The whole setup, as statements that can be executed one at a time.
 *
 * An array rather than a blob because the applier runs them individually, so a
 * failure names the grant that failed rather than the script. The `do` block is
 * one element despite spanning lines — splitting it on newlines would send
 * Postgres four syntax errors.
 *
 * Role creation is conditional so this converges rather than failing on a
 * database that already has the role. That is the common case: it must be
 * re-run after every migration that adds a table.
 */
export function consoleRoleStatements(
  options: GrantOptions & { password: string },
): string[] {
  const role = quoteIdentifier(options.role);

  return [
    [
      `do $$ begin`,
      `  if not exists (select 1 from pg_roles where rolname = ${quoteLiteral(options.role)}) then`,
      `    create role ${role} login password ${quoteLiteral(options.password)};`,
      `  else`,
      `    alter role ${role} login password ${quoteLiteral(options.password)};`,
      `  end if;`,
      `end $$;`,
    ].join("\n"),
    // Never a superuser: a superuser can read files off the host with
    // `pg_read_file()`, which a READ ONLY transaction does not prevent.
    `alter role ${role} nosuperuser nocreatedb nocreaterole noreplication nobypassrls;`,
    ...grantStatements(options),
  ];
}

/** The same thing as a pasteable script, for the print-only path. */
export function consoleRoleScript(
  options: GrantOptions & { password: string },
): string {
  return [
    `-- Generated by \`pnpm console:role\`. Re-run after any migration.`,
    `-- The SQL console reads through this role so that a compromised admin`,
    `-- session cannot read a credential or promote an account.`,
    ``,
    ...consoleRoleStatements(options),
  ].join("\n");
}
