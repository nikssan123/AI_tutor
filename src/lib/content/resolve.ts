import type { Db } from "@/db";
import { findPack } from "@/lib/content";
import { packFromDb } from "@/lib/packs/read";
import type { DomainPack } from "@/lib/packs/types";

/**
 * A pack by slug, for the signed-in app.
 *
 * §13.1's "one app, two rendering worlds" applied to packs. The marketing
 * surface keeps `findPack` — synchronous, disk-backed, statically rendered, and
 * therefore deterministic and diffable, which is what §15 requires of anything
 * indexable. The signed-in app uses this instead, because a learner's goal can
 * point at a Generated pack that exists only in the database (§7.1).
 *
 * Disk wins on a slug collision, deliberately: a Curated pack is hand-authored
 * and human-reviewed, and if one ever shares a slug with a generated pack the
 * reviewed one is the one to serve. It also means promoting a generated pack to
 * Curated is done by committing the YAML, with no delete step to forget.
 *
 * Not cached. `allPacks()` caches disk packs for the process because they cannot
 * change at runtime; a generated pack can — it is written by a background job
 * and may be regenerated or promoted — so caching here would serve a stale skill
 * graph to the planner with no way to invalidate it.
 */
export async function resolvePack(
  db: Db,
  slug: string,
): Promise<DomainPack | undefined> {
  return findPack(slug) ?? (await packFromDb(db, slug));
}
