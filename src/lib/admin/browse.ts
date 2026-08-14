import { asc, count, desc, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  listTables,
  REDACTED,
  visibleColumns,
  type ColumnInfo,
  type TableInfo,
} from "./tables";

/**
 * Reading rows out of an arbitrary table, safely.
 *
 * "Safely" is doing specific work here. Nothing in this module ever puts a
 * caller-supplied string into SQL. The table arrives as a `TableInfo` the route
 * already resolved against the catalogue, the sort column is looked up in that
 * table's own column list and used as a Drizzle column object, and the page
 * numbers are clamped integers. The query builder does the quoting.
 */

export const PAGE_SIZE = 50;

/** Long text is truncated for the grid; the row detail view shows all of it. */
export const CELL_LIMIT = 120;

export interface TableCount {
  name: string;
  rows: number;
}

/**
 * Row counts for every table, in one round trip.
 *
 * Forty-one `select count(*)` queries is forty-one round trips for a page that
 * is mostly navigation. The names interpolated here come from the catalogue,
 * never from a request, and go through `sql.identifier` so `user` is quoted
 * rather than parsed as the reserved word.
 */
export async function tableCounts(db: Db): Promise<TableCount[]> {
  const tables = listTables();

  const parts = tables.map(
    (info) =>
      sql`select ${info.name}::text as t, count(*)::int as n from ${sql.identifier(info.name)}`,
  );

  const rows = (await db.execute(sql.join(parts, sql` union all `))) as Array<{
    t: string;
    n: number;
  }>;

  const byName = new Map(rows.map((row) => [row.t, Number(row.n)]));
  // `!` rather than `?? 0`: the union's arms were built from this same list, so
  // every name is present by construction. A fallback here would be a branch no
  // test could reach, which the coverage rule treats as a defect rather than
  // caution.
  return tables.map((info) => ({
    name: info.name,
    rows: byName.get(info.name)!,
  }));
}

/** All strings: these arrive straight from `searchParams` and are validated here. */
export interface BrowseOptions {
  page?: string;
  sort?: string;
  direction?: string;
}

export interface BrowseResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pages: number;
  sort: string;
  direction: "asc" | "desc";
}

/**
 * The column a table sorts by when nobody said.
 *
 * Newest-first on `created_at` is what an operator actually wants — the row
 * they are looking for is nearly always one that just appeared. Falling back to
 * the primary key keeps pagination stable on tables without a timestamp; a
 * query with no `ORDER BY` may return the same row on two different pages.
 */
export function defaultSort(info: TableInfo): {
  sort: string;
  direction: "asc" | "desc";
} {
  const visible = visibleColumns(info);
  const created = visible.find((column) => column.name === "created_at");
  if (created) return { sort: created.name, direction: "desc" };

  const primary = visible.find((column) => column.primary);
  // `visible[0]!` is safe: a table with no columns cannot be declared.
  return { sort: (primary ?? visible[0]!).name, direction: "asc" };
}

/** Clamps a page-number string to a whole number of pages, 1-based. */
export function clampPage(raw: string | undefined, pages: number): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, Math.max(pages, 1));
}

export async function browseTable(
  db: Db,
  info: TableInfo,
  options: BrowseOptions = {},
): Promise<BrowseResult> {
  const columns = visibleColumns(info);
  const fallback = defaultSort(info);

  // An unknown sort column is ignored rather than rejected. The name is in a
  // URL people edit and share, and a 500 on a stale link is worse than a
  // sensible default. Crucially it is a *lookup*, so an injected string simply
  // fails to match and falls through to the default.
  const requested = columns.find((column) => column.name === options.sort);
  const sortColumn =
    requested ?? columns.find((column) => column.name === fallback.sort)!;

  // An explicit direction always wins. Without one, a column the operator
  // picked sorts highest-first (they clicked it to find the top of something),
  // while the untouched default keeps the direction that suits it.
  const direction: "asc" | "desc" =
    options.direction === "asc" || options.direction === "desc"
      ? options.direction
      : requested
        ? "desc"
        : fallback.direction;

  const [totals] = await db.select({ n: count() }).from(info.table);
  const total = Number(totals!.n);
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const page = clampPage(options.page, pages);

  const projection = Object.fromEntries(
    columns.map((column) => [column.name, column.column]),
  );

  const rows = (await db
    .select(projection)
    .from(info.table)
    .orderBy(
      direction === "asc" ? asc(sortColumn.column) : desc(sortColumn.column),
    )
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)) as Record<string, unknown>[];

  return {
    columns,
    rows,
    total,
    page,
    pages,
    sort: sortColumn.name,
    direction,
  };
}

/**
 * A database value as one line of a grid.
 *
 * Dates go to an ISO second — the console is UTC everywhere and a locale-shaped
 * date in an operator tool is a bug waiting to be misread. `null` is rendered
 * as the word rather than an empty cell, because "no value" and "empty string"
 * are different answers to most questions an operator is asking.
 */
export function formatCell(value: unknown, limit = CELL_LIMIT): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").slice(0, 19);
  }

  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);

  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Blanks a cell the caller has already decided is a credential. */
export function redactCell(secret: boolean, value: unknown): string {
  return secret ? REDACTED : formatCell(value);
}
