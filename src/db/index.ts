import type { EnvLike } from "@/lib/env-types";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };

/**
 * §18.1 — Drizzle over Prisma for smaller cold starts; postgres-js is
 * serverless-friendly. Neon is a DATABASE_URL swap, nothing more.
 *
 * Returns the client alongside the Drizzle handle so short-lived processes
 * (seed scripts, tests) can close it. A CLI that forgets to call `close` hangs
 * forever with its work already committed, which looks exactly like a deadlock.
 */
export function createClient(connectionString: string, max = 5) {
  const client = postgres(connectionString, { max, prepare: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export function createDb(connectionString: string, max = 5) {
  return createClient(connectionString, max).db;
}

export type Db = ReturnType<typeof createDb>;

let cached: Db | undefined;

export function resolveConnectionString(env: EnvLike = process.env): string {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local, then run `docker compose up -d`.",
    );
  }
  return connectionString;
}

/**
 * Serverless Postgres charges for idle connections, so dev stays small and
 * production gets enough headroom for the Inngest workers plus request traffic.
 */
export function poolSize(env: EnvLike = process.env): number {
  return env.NODE_ENV === "production" ? 10 : 5;
}

/**
 * Lazily initialised so importing this module never opens a connection — which
 * is what lets the schema be imported by tests and by drizzle-kit without a
 * live database. Long-lived (the Next.js server owns it), so there is
 * deliberately no `close` here.
 */
export function getDb(): Db {
  cached ??= createDb(resolveConnectionString(), poolSize());
  return cached;
}

/** Test seam: drops the cached singleton so a later getDb() rebuilds it. */
export function resetDb(): void {
  cached = undefined;
}
