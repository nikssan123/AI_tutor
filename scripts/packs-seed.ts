import { createClient, resolveConnectionString } from "../src/db";
import { loadAllPacks } from "../src/lib/packs/loader";
import { seedPacks } from "../src/lib/packs/seed";
import { loadEnv } from "../src/lib/env";

loadEnv();

const root = process.argv[2] ?? "packs";

async function main() {
  const packs = loadAllPacks(root);
  if (packs.length === 0) {
    console.error(`No packs found under "${root}".`);
    process.exit(1);
  }

  const { db, close } = createClient(resolveConnectionString(), 1);
  try {
    for (const result of await seedPacks(db, packs)) {
      console.log(
        `✓ seeded ${result.packSlug}: ${result.skills} skills · ` +
          `${result.dependencies} deps · ${result.items} items · ` +
          `${result.rubrics} rubrics · ${result.projects} projects`,
      );
    }
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
