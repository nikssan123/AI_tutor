import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnv } from "@/lib/env";

/**
 * Applies pending migrations. Exported rather than executed at import time so
 * it is callable from tests with no side effects; the CLI entry point lives in
 * `scripts/db-migrate.ts`.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder = "./drizzle",
): Promise<void> {
  const client = postgres(connectionString, { max: 1 });
  try {
    // pgvector lives in the same Postgres (§18.1), so the extension has to
    // exist before any migration that references a vector column.
    await client`CREATE EXTENSION IF NOT EXISTS vector`;
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

export async function main(): Promise<string> {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local, then run `docker compose up -d`.",
    );
  }
  await runMigrations(connectionString);
  return "Migrations applied.";
}
