import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { desc, eq, inArray, like } from "drizzle-orm";
import { createClient } from "@/db";
import { adminAudit, session, user } from "@/db/schema";
import { AUDIT_PAGE_SIZE, listAudit, recordAudit } from "@/lib/admin/audit";
import {
  deleteUserAccount,
  isPlan,
  PLANS,
  revokeUserSessions,
  setUserPlan,
} from "@/lib/admin/users";

/**
 * The quick actions, and the log that makes them accountable.
 *
 * Run against the real Postgres because the properties under test are database
 * properties: that a delete actually cascades, that the audit row and the change
 * share a transaction, and that a refusal leaves the row exactly as it was.
 */

describe("isPlan", () => {
  it.each(PLANS)("accepts %s", (plan) => {
    expect(isPlan(plan)).toBe(true);
  });

  it.each(["enterprise", "FREE", "", "free "])("rejects %o", (plan) => {
    expect(isPlan(plan)).toBe(false);
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  const ADMIN = { userId: "users-test-admin", email: "admin@users-test.local" };
  const TARGET = "users-test-target";
  const OTHER_ADMIN = "users-test-other-admin";
  const IDS = [ADMIN.userId, TARGET, OTHER_ADMIN];

  /** Audit rows outlive the accounts they name, so they are cleared by email. */
  async function reset() {
    await db.delete(adminAudit).where(like(adminAudit.actorEmail, "%@users-test.local"));
    await db.delete(user).where(inArray(user.id, IDS));
  }

  beforeEach(async () => {
    await reset();
    await db.insert(user).values([
      {
        id: ADMIN.userId,
        name: "Admin",
        email: ADMIN.email,
        role: "admin",
        plan: "pro",
      },
      {
        id: TARGET,
        name: "Target",
        email: "target@users-test.local",
        plan: "free",
      },
      {
        id: OTHER_ADMIN,
        name: "Other",
        email: "other@users-test.local",
        role: "admin",
        plan: "free",
      },
    ]);
    await db.insert(session).values([
      {
        id: "users-test-s1",
        token: "t1",
        userId: TARGET,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
      {
        id: "users-test-s2",
        token: "t2",
        userId: TARGET,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    ]);
  });

  const auditRows = () =>
    db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.actorEmail, ADMIN.email))
      .orderBy(desc(adminAudit.createdAt));

  const planOf = async (id: string) => {
    const [row] = await db
      .select({ plan: user.plan })
      .from(user)
      .where(eq(user.id, id));
    return row?.plan;
  };

  describe("setUserPlan", () => {
    it("changes the plan and logs it", async () => {
      const result = await setUserPlan(db, ADMIN, TARGET, "pro");

      expect(result.ok).toBe(true);
      expect(await planOf(TARGET)).toBe("pro");

      const [entry] = await auditRows();
      expect(entry).toMatchObject({
        action: "user.plan",
        target: "target@users-test.local",
        outcome: "ok",
        detail: { from: "free", to: "pro" },
      });
    });

    it("says Stripe is untouched, because it is", async () => {
      const result = await setUserPlan(db, ADMIN, TARGET, "pro");
      expect(result.message).toMatch(/Stripe is unchanged/);
    });

    it("is a no-op when the plan already matches", async () => {
      const result = await setUserPlan(db, ADMIN, TARGET, "free");

      expect(result.ok).toBe(true);
      expect(await auditRows()).toHaveLength(0);
    });

    it("refuses a plan that does not exist, and logs the refusal", async () => {
      const result = await setUserPlan(db, ADMIN, TARGET, "enterprise");

      expect(result.ok).toBe(false);
      expect(await planOf(TARGET)).toBe("free");

      const [entry] = await auditRows();
      expect(entry).toMatchObject({ outcome: "denied", action: "user.plan" });
    });

    it("refuses an unknown account", async () => {
      const result = await setUserPlan(db, ADMIN, "nobody", "pro");

      expect(result).toMatchObject({ ok: false, message: "No such account." });
      expect((await auditRows())[0]).toMatchObject({ outcome: "denied" });
    });
  });

  describe("revokeUserSessions", () => {
    it("deletes every session and reports how many", async () => {
      const result = await revokeUserSessions(db, ADMIN, TARGET);

      expect(result).toMatchObject({ ok: true });
      expect(result.message).toMatch(/2 sessions/);

      const left = await db
        .select()
        .from(session)
        .where(eq(session.userId, TARGET));
      expect(left).toHaveLength(0);
    });

    it("logs the count", async () => {
      await revokeUserSessions(db, ADMIN, TARGET);

      expect((await auditRows())[0]).toMatchObject({
        action: "user.sessions",
        outcome: "ok",
        rowCount: 2,
      });
    });

    it("says session, singular, when there is one", async () => {
      await db.delete(session).where(eq(session.id, "users-test-s2"));
      const result = await revokeUserSessions(db, ADMIN, TARGET);

      expect(result.message).toMatch(/1 session\./);
    });

    it("is harmless on an account with none", async () => {
      const result = await revokeUserSessions(db, ADMIN, OTHER_ADMIN);
      expect(result).toMatchObject({ ok: true });
      expect(result.message).toMatch(/0 sessions/);
    });

    it("refuses an unknown account", async () => {
      const result = await revokeUserSessions(db, ADMIN, "nobody");
      expect(result.ok).toBe(false);
    });
  });

  describe("deleteUserAccount", () => {
    it("deletes the account and everything cascading from it", async () => {
      const result = await deleteUserAccount(
        db,
        ADMIN,
        TARGET,
        "target@users-test.local",
      );

      expect(result.ok).toBe(true);
      expect(await planOf(TARGET)).toBeUndefined();

      const orphans = await db
        .select()
        .from(session)
        .where(eq(session.userId, TARGET));
      expect(orphans).toHaveLength(0);
    });

    it("keeps the audit row after its subject is gone", async () => {
      await deleteUserAccount(db, ADMIN, TARGET, "target@users-test.local");

      const [entry] = await auditRows();
      expect(entry).toMatchObject({
        action: "user.delete",
        target: "target@users-test.local",
        outcome: "ok",
      });
    });

    it("accepts a differently-cased or padded email", async () => {
      const result = await deleteUserAccount(
        db,
        ADMIN,
        TARGET,
        "  TARGET@Users-Test.local  ",
      );
      expect(result.ok).toBe(true);
    });

    it("refuses when the typed email does not match", async () => {
      // The id came from whichever row's button was clicked. This is the
      // mistake the confirmation exists to catch.
      const result = await deleteUserAccount(db, ADMIN, TARGET, "wrong@x.local");

      expect(result.ok).toBe(false);
      expect(await planOf(TARGET)).toBe("free");
      expect((await auditRows())[0]).toMatchObject({ outcome: "denied" });
    });

    it("refuses to delete the operator's own account", async () => {
      const result = await deleteUserAccount(db, ADMIN, ADMIN.userId, ADMIN.email);

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/your own account/);
      expect(await planOf(ADMIN.userId)).toBe("pro");
    });

    it("refuses to delete another admin, and names the way to do it", async () => {
      // Deleting the last admin locks everyone out of /admin permanently.
      const result = await deleteUserAccount(
        db,
        ADMIN,
        OTHER_ADMIN,
        "other@users-test.local",
      );

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/admin:grant --revoke/);
      expect(await planOf(OTHER_ADMIN)).toBe("free");
    });

    it("refuses an unknown account", async () => {
      const result = await deleteUserAccount(db, ADMIN, "nobody", "x@y.local");
      expect(result.ok).toBe(false);
    });

    it("checks self before existence", async () => {
      // An operator whose own row is somehow missing still must not be told
      // to try again with a different email.
      const result = await deleteUserAccount(
        db,
        { userId: "ghost", email: "ghost@users-test.local" },
        "ghost",
        "ghost@users-test.local",
      );
      expect(result.message).toMatch(/your own account/);
    });
  });

  describe("the audit log", () => {
    it("records an attempt with every field it was given", async () => {
      await recordAudit(db, {
        actorId: ADMIN.userId,
        actorEmail: ADMIN.email,
        action: "sql.read",
        target: null,
        detail: { query: "select 1" },
        outcome: "ok",
        durationMs: 12,
        rowCount: 1,
      });

      const [entry] = await auditRows();
      expect(entry).toMatchObject({
        action: "sql.read",
        outcome: "ok",
        durationMs: 12,
        rowCount: 1,
        detail: { query: "select 1" },
        error: null,
      });
    });

    it("defaults the optional fields to null rather than omitting them", async () => {
      await recordAudit(db, {
        actorId: ADMIN.userId,
        actorEmail: ADMIN.email,
        action: "sql.read",
        outcome: "error",
      });

      expect((await auditRows())[0]).toMatchObject({
        target: null,
        detail: null,
        error: null,
        durationMs: null,
        rowCount: null,
      });
    });

    it("survives the deletion of the account that wrote it, intact", async () => {
      await recordAudit(db, {
        actorId: TARGET,
        actorEmail: "target@users-test.local",
        action: "sql.read",
        outcome: "ok",
      });
      await db.delete(user).where(eq(user.id, TARGET));

      const [entry] = await db
        .select()
        .from(adminAudit)
        .where(eq(adminAudit.actorEmail, "target@users-test.local"));

      // Both columns survive. With a foreign key this row would have had its
      // actor erased by a `set null` — an audit trail the subject can edit by
      // leaving.
      expect(entry).toMatchObject({
        actorId: TARGET,
        actorEmail: "target@users-test.local",
      });
    });

    it("can log an act by an account that no longer exists", async () => {
      // The row that says "this account was deleted" must be writable after
      // the account is gone. A foreign key made this insert fail outright.
      await db.delete(user).where(eq(user.id, TARGET));

      await expect(
        recordAudit(db, {
          actorId: TARGET,
          actorEmail: "target@users-test.local",
          action: "user.delete",
          outcome: "ok",
        }),
      ).resolves.toBeUndefined();
    });

    it("lists newest first", async () => {
      await setUserPlan(db, ADMIN, TARGET, "pro");
      await revokeUserSessions(db, ADMIN, TARGET);

      const entries = await listAudit(db);
      const mine = entries.filter((row) => row.actorEmail === ADMIN.email);

      expect(mine[0]?.action).toBe("user.sessions");
      expect(entries.length).toBeLessThanOrEqual(AUDIT_PAGE_SIZE);
    });

    it("honours a smaller limit", async () => {
      await setUserPlan(db, ADMIN, TARGET, "pro");
      expect(await listAudit(db, 1)).toHaveLength(1);
    });
  });
});
