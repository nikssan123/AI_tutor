import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { user } from "@/db/schema";
import { ADMIN_ROLE, DEFAULT_ROLE } from "./guard";

/**
 * Granting and revoking the admin role.
 *
 * This is a CLI operation on purpose. There is no "promote user" button in the
 * console, because a self-service promotion path is exactly the thing an
 * attacker who lands one admin session goes looking for. Changing who is an
 * admin requires shell access to something holding `DATABASE_URL`.
 *
 * The logic lives here rather than in `scripts/` so it is covered by the test
 * suite; `scripts/admin-grant.ts` is a thin argv-and-exit-code wrapper.
 */

export class NoSuchUserError extends Error {
  constructor(email: string) {
    super(`No user with email "${email}". They must sign up first.`);
    this.name = "NoSuchUserError";
  }
}

export interface RoleChange {
  email: string;
  from: string;
  to: string;
  /** False when the account already held the target role. */
  changed: boolean;
}

async function setRole(
  db: Db,
  email: string,
  role: string,
): Promise<RoleChange> {
  const normalized = email.trim().toLowerCase();

  const [existing] = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.email, normalized))
    .limit(1);

  if (!existing) throw new NoSuchUserError(normalized);

  if (existing.role === role) {
    return { email: normalized, from: existing.role, to: role, changed: false };
  }

  await db
    .update(user)
    .set({ role, updatedAt: new Date() })
    .where(eq(user.id, existing.id));

  return { email: normalized, from: existing.role, to: role, changed: true };
}

export function grantAdmin(db: Db, email: string): Promise<RoleChange> {
  return setRole(db, email, ADMIN_ROLE);
}

export function revokeAdmin(db: Db, email: string): Promise<RoleChange> {
  return setRole(db, email, DEFAULT_ROLE);
}

export async function listAdmins(db: Db): Promise<string[]> {
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.role, ADMIN_ROLE))
    .orderBy(user.email);

  return rows.map((row) => row.email);
}
