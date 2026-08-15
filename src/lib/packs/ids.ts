import { createHash } from "node:crypto";

/**
 * Deterministic UUIDs derived from a pack's own slugs.
 *
 * Seeding has to be idempotent (§24 E2), and the pack files reference each other
 * by slug while the database keys on UUID. Deriving the UUID from the slug means
 * re-seeding updates rows in place instead of creating duplicates, and it means
 * a skill's id is stable across environments — so a fixture, a local database
 * and production all agree on what `sql-data-analysis/join-grain` is.
 *
 * This is RFC 4122 §4.3 name-based UUID construction with SHA-1, i.e. version 5,
 * under a fixed namespace for this product.
 */

/** Fixed namespace for MeritKeep pack entities. Never change this value. */
const NAMESPACE = "9f2a1c84-3b7e-5d16-8a4f-6c0e2b9d7a35";

function namespaceBytes(): Buffer {
  return Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
}

/** RFC 4122 version 5 (SHA-1, name-based). */
export function deterministicUuid(name: string): string {
  const hash = createHash("sha1")
    .update(namespaceBytes())
    .update(Buffer.from(name, "utf8"))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  // Version 5.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // RFC 4122 variant.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export const packId = (packSlug: string): string =>
  deterministicUuid(`pack:${packSlug}`);

export const skillId = (packSlug: string, slug: string): string =>
  deterministicUuid(`skill:${packSlug}/${slug}`);

export const itemId = (packSlug: string, slug: string): string =>
  deterministicUuid(`item:${packSlug}/${slug}`);

export const rubricId = (packSlug: string, slug: string): string =>
  deterministicUuid(`rubric:${packSlug}/${slug}`);

export const projectId = (packSlug: string, slug: string): string =>
  deterministicUuid(`project:${packSlug}/${slug}`);

export const resourceId = (packSlug: string, slug: string): string =>
  deterministicUuid(`resource:${packSlug}/${slug}`);
