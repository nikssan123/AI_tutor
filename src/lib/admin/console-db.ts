import postgres from "postgres";
import type { EnvLike } from "@/lib/env-types";
import { resolveConnectionString } from "@/db";
import type { ConsoleRunner } from "./sql";

/**
 * Which connection the SQL console runs on.
 *
 * Preferably not the application's. `DATABASE_URL` in this deployment is a
 * superuser, and a superuser inside a `READ ONLY` transaction can still call
 * `pg_read_file()` — reading is not a write, so the transaction has no opinion
 * about it. A console on that connection is a file-read primitive on the
 * database host wearing a grid.
 *
 * So `CONSOLE_DATABASE_URL` points at a role with no superuser bit and
 * column-level grants (see `pnpm console:role`). When it is absent the console
 * still works on the application connection — a laptop with one database URL is
 * the normal case — but `leastPrivilege` comes back false and the page says so
 * in a banner rather than pretending.
 */

export interface ConsoleConnection {
  runner: ConsoleRunner;
  /** False when falling back to the application's own (superuser) connection. */
  leastPrivilege: boolean;
  /** What the operator must type to unlock write mode. */
  database: string;
}

export function resolveConsoleUrl(env: EnvLike = process.env): {
  url: string;
  leastPrivilege: boolean;
} {
  const dedicated = env.CONSOLE_DATABASE_URL;
  if (dedicated) return { url: dedicated, leastPrivilege: true };
  return { url: resolveConnectionString(env), leastPrivilege: false };
}

/**
 * The database's own name, pulled off the connection string.
 *
 * Write mode asks the operator to type it. A checkbox alone is one slip of a
 * finger; a name you have to read and reproduce is a sentence you have to mean.
 * It is also the thing that differs between staging and production, which is
 * the mistake actually worth catching.
 */
export function databaseName(url: string): string {
  try {
    const name = new URL(url).pathname.replace(/^\//, "");
    return name === "" ? "database" : decodeURIComponent(name);
  } catch {
    // A connection string this module cannot parse is not worth failing the
    // page over; the confirmation just falls back to a generic word.
    return "database";
  }
}

let cached: ConsoleConnection | undefined;

/**
 * A tiny dedicated pool, built on first use.
 *
 * Two connections: the console is one operator running one statement, and it
 * must not be able to starve the request traffic sharing the database. Separate
 * from the application pool for the same reason — a console query that hangs
 * until the statement timeout consumes a console connection, not a page's.
 */
export function getConsoleConnection(
  env: EnvLike = process.env,
): ConsoleConnection {
  if (!cached) {
    const { url, leastPrivilege } = resolveConsoleUrl(env);
    cached = {
      runner: postgres(url, { max: 2, prepare: false }) as ConsoleRunner,
      leastPrivilege,
      database: databaseName(url),
    };
  }
  return cached;
}

/** Test seam: drops the cached pool so a later call rebuilds it. */
export function resetConsoleConnection(): void {
  cached = undefined;
}
