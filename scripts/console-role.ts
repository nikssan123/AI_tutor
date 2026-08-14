import { randomBytes } from "node:crypto";
import { createClient, resolveConnectionString } from "../src/db";
import {
  consoleRoleScript,
  consoleRoleStatements,
} from "../src/lib/admin/grants";
import { databaseName } from "../src/lib/admin/console-db";
import { loadEnv } from "../src/lib/env";

loadEnv();

const USAGE = `Usage:
  pnpm console:role                 print the SQL, change nothing
  pnpm console:role --apply         create/refresh the role and print the URL
  pnpm console:role --allow-writes  include the grants write mode needs
  pnpm console:role --password <p>  use this password instead of a random one

Creates the least-privilege Postgres role the SQL console reads through.
Re-run it after any migration that adds a table: new tables are not readable
until they are granted, and a new table holding a credential must never be.`;

const ROLE = "online_uni_console";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }

  const apply = args.includes("--apply");
  const allowWrites = args.includes("--allow-writes");

  const flag = args.indexOf("--password");
  const password =
    flag === -1 ? randomBytes(24).toString("base64url") : args[flag + 1];

  if (!password) {
    console.error(USAGE);
    process.exit(1);
  }

  const url = resolveConnectionString();
  const database = databaseName(url);
  const options = { role: ROLE, database, password, allowWrites };

  if (!apply) {
    console.log(consoleRoleScript(options));
    console.log(
      `\n-- Nothing was changed. Re-run with --apply to execute this.`,
    );
    return;
  }

  const statements = consoleRoleStatements(options);
  const { db, close } = createClient(url, 1);
  try {
    // One at a time rather than as one blob, so a failure names the grant that
    // failed instead of the whole script.
    for (const statement of statements) {
      await db.execute(statement as never);
    }

    const target = new URL(url);
    target.username = ROLE;
    target.password = password;

    console.log(
      `✓ ${ROLE}: ${statements.length} statements applied${allowWrites ? " (writes enabled)" : ""}`,
    );
    console.log(`\nAdd this to .env.local:\n`);
    console.log(`CONSOLE_DATABASE_URL=${target.toString()}`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
