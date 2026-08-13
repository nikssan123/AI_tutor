import { createClient, resolveConnectionString } from "../src/db";
import { grantAdmin, listAdmins, revokeAdmin } from "../src/lib/admin/grant";
import { loadEnv } from "../src/lib/env";

loadEnv();

const USAGE = `Usage:
  pnpm admin:grant <email>     grant the admin role
  pnpm admin:grant --revoke <email>
  pnpm admin:grant --list`;

async function main() {
  const args = process.argv.slice(2);
  const revoking = args[0] === "--revoke";
  const listing = args[0] === "--list";
  const email = revoking ? args[1] : args[0];

  if (!listing && !email) {
    console.error(USAGE);
    process.exit(1);
  }

  const { db, close } = createClient(resolveConnectionString(), 1);
  try {
    if (listing) {
      const admins = await listAdmins(db);
      console.log(admins.length ? admins.join("\n") : "No admins.");
      return;
    }

    const change = revoking
      ? await revokeAdmin(db, email!)
      : await grantAdmin(db, email!);

    console.log(
      change.changed
        ? `✓ ${change.email}: ${change.from} → ${change.to}`
        : `· ${change.email} is already ${change.to}; nothing to do.`,
    );
  } finally {
    // Without this the process hangs with its work already committed, which
    // reads as a deadlock and is anything but.
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
