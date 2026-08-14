import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { session, user } from "@/db/schema";
import { ADMIN_ROLE } from "./guard";
import { recordAudit } from "./audit";

/**
 * The quick actions on a `user` row.
 *
 * Three things are true of every function here and none of them are optional:
 *
 * - It is a **typed** operation, not generated SQL. The row is addressed by id,
 *   the change is a literal from a closed set, and nothing the operator typed
 *   is ever interpolated. The SQL console is where free-form goes; this is not
 *   a second one wearing buttons.
 * - The audit row is written **inside the same transaction** as the change, so
 *   there is no state in which the account was deleted and the log does not say
 *   who did it.
 * - Refusals are audited too, as `denied`.
 *
 * What is deliberately missing: changing `role`. Promotion stays in
 * `pnpm admin:grant`, behind shell access, for the reason
 * `src/lib/admin/grant.ts` gives — a self-service promotion path is the first
 * thing an attacker who lands one admin session goes looking for. The console
 * role's grants enforce it at the database too (see `grants.ts`), so this is
 * not merely a missing button.
 */

export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export interface Actor {
  userId: string;
  email: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

interface TargetUser {
  id: string;
  email: string;
  role: string;
  plan: string;
}

async function findUser(db: Db, userId: string): Promise<TargetUser | undefined> {
  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row;
}

/** Records the refusal, then reports it. Every early return goes through here. */
async function deny(
  db: Db,
  actor: Actor,
  action: string,
  target: string | null,
  message: string,
): Promise<ActionResult> {
  await recordAudit(db, {
    actorId: actor.userId,
    actorEmail: actor.email,
    action,
    target,
    outcome: "denied",
    error: message,
  });
  return { ok: false, message };
}

export async function setUserPlan(
  db: Db,
  actor: Actor,
  userId: string,
  plan: string,
): Promise<ActionResult> {
  const action = "user.plan";

  if (!isPlan(plan)) {
    return deny(db, actor, action, userId, `“${plan}” is not a plan.`);
  }

  const target = await findUser(db, userId);
  if (!target) {
    return deny(db, actor, action, userId, "No such account.");
  }

  if (target.plan === plan) {
    return { ok: true, message: `${target.email} is already on ${plan}.` };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ plan, updatedAt: new Date() })
      .where(eq(user.id, target.id));

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action,
      target: target.email,
      detail: { from: target.plan, to: plan },
      outcome: "ok",
      rowCount: 1,
    });
  });

  // Stripe is not touched. Someone reading this later will want to know that
  // the billing side still has to be reconciled by hand.
  return {
    ok: true,
    message: `${target.email}: ${target.plan} → ${plan}. Stripe is unchanged.`,
  };
}

/**
 * Signs an account out everywhere.
 *
 * The recovery move when a session is believed stolen, and the reason the guard
 * re-reads the role from the database on every request rather than trusting the
 * cookie: both together mean access can actually be taken away.
 */
export async function revokeUserSessions(
  db: Db,
  actor: Actor,
  userId: string,
): Promise<ActionResult> {
  const action = "user.sessions";

  const target = await findUser(db, userId);
  if (!target) {
    return deny(db, actor, action, userId, "No such account.");
  }

  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(session)
      .where(eq(session.userId, target.id))
      .returning({ id: session.id });

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action,
      target: target.email,
      outcome: "ok",
      rowCount: rows.length,
    });

    return rows.length;
  });

  const plural = removed === 1 ? "session" : "sessions";
  return {
    ok: true,
    message: `Signed ${target.email} out of ${removed} ${plural}.`,
  };
}

/**
 * Deletes an account and everything that cascades from it.
 *
 * Three refusals, in the order they are checked:
 *
 * - **Not yourself.** An operator who deletes their own account mid-session is
 *   an outage, and there is no undo.
 * - **Not an admin.** Deleting the last admin locks everyone out of `/admin`
 *   permanently. Revoking with `pnpm admin:grant --revoke` first is one command
 *   and makes the intent explicit.
 * - **The typed email must match.** The id comes from a button the operator may
 *   have clicked on the wrong row; the email is something they had to read off
 *   the screen and reproduce.
 */
export async function deleteUserAccount(
  db: Db,
  actor: Actor,
  userId: string,
  confirmEmail: string,
): Promise<ActionResult> {
  const action = "user.delete";

  if (userId === actor.userId) {
    return deny(
      db,
      actor,
      action,
      actor.email,
      "You cannot delete your own account from here.",
    );
  }

  const target = await findUser(db, userId);
  if (!target) {
    return deny(db, actor, action, userId, "No such account.");
  }

  if (target.role === ADMIN_ROLE) {
    return deny(
      db,
      actor,
      action,
      target.email,
      `${target.email} is an admin. Revoke it first with \`pnpm admin:grant --revoke ${target.email}\`.`,
    );
  }

  if (confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
    return deny(
      db,
      actor,
      action,
      target.email,
      "The email you typed does not match this account. Nothing was deleted.",
    );
  }

  await db.transaction(async (tx) => {
    // The audit row is written first so that `actorId`'s own foreign key is
    // never the thing that fails after the account is already gone.
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      action,
      target: target.email,
      detail: { id: target.id, email: target.email, plan: target.plan },
      outcome: "ok",
      rowCount: 1,
    });

    await tx.delete(user).where(eq(user.id, target.id));
  });

  return {
    ok: true,
    message: `Deleted ${target.email} and everything belonging to them.`,
  };
}
