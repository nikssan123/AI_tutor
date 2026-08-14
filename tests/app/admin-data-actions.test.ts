import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `user` table's quick actions, as endpoints.
 *
 * The behaviour of each operation is tested against a real database in
 * tests/lib/admin-users.test.ts. What these assert is the endpoint contract:
 * that the caller is re-established, that the operator's own identity comes
 * from the guard rather than from the form, and that the outcome comes back as
 * a redirect so the whole surface works without JavaScript.
 */

const requireAdminMock = vi.fn();
const setUserPlanMock = vi.fn();
const revokeUserSessionsMock = vi.fn();
const deleteUserAccountMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const revalidatePathMock = vi.fn();
const appDb = { marker: "db" };

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: () => requireAdminMock(),
}));
vi.mock("@/db", () => ({ getDb: () => appDb }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));
vi.mock("@/lib/admin/users", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin/users")>(
      "@/lib/admin/users",
    );
  return {
    ...actual,
    setUserPlan: (...args: unknown[]) => setUserPlanMock(...args),
    revokeUserSessions: (...args: unknown[]) => revokeUserSessionsMock(...args),
    deleteUserAccount: (...args: unknown[]) => deleteUserAccountMock(...args),
  };
});

const { setPlanAction, revokeSessionsAction, deleteUserAction } = await import(
  "@/app/admin/data/actions"
);

const ADMIN = { userId: "u0", email: "admin@example.com", role: "admin" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** Every action ends in a redirect, which throws. */
async function run(
  action: (data: FormData) => Promise<void>,
  data: FormData,
): Promise<string> {
  try {
    await action(data);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the action to redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN);
  setUserPlanMock.mockResolvedValue({ ok: true, message: "moved to pro" });
  revokeUserSessionsMock.mockResolvedValue({ ok: true, message: "signed out" });
  deleteUserAccountMock.mockResolvedValue({ ok: true, message: "deleted" });
});

describe.each([
  ["setPlanAction", () => setPlanAction, () => setUserPlanMock],
  ["revokeSessionsAction", () => revokeSessionsAction, () => revokeUserSessionsMock],
  ["deleteUserAction", () => deleteUserAction, () => deleteUserAccountMock],
])("%s", (_name, action, operation) => {
  it("establishes the caller before touching anything", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(action()(form({ userId: "u1" }))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(operation()).not.toHaveBeenCalled();
  });

  it("takes the operator's identity from the guard, never from the form", async () => {
    // A forged `actorEmail` in the POST body would put someone else's name on
    // the audit row.
    await run(
      action(),
      form({ userId: "u1", actorEmail: "victim@example.com", confirmEmail: "x" }),
    );

    expect(operation()).toHaveBeenCalledWith(
      appDb,
      { userId: "u0", email: "admin@example.com" },
      ...operation().mock.calls[0]!.slice(2),
    );
  });

  it("revalidates before redirecting, so the page shows the change", async () => {
    await run(action(), form({ userId: "u1", confirmEmail: "x" }));

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/data/user");
    expect(redirectMock).toHaveBeenCalled();
  });

  it("carries the result back in the URL rather than losing it", async () => {
    const thrown = await run(action(), form({ userId: "u1", confirmEmail: "x" }));

    expect(thrown).toMatch(/^REDIRECT:\/admin\/data\/user\?/);
    expect(thrown).toContain("ok=1");
  });

  it("marks a refusal as such", async () => {
    operation().mockResolvedValue({ ok: false, message: "no" });

    const thrown = await run(action(), form({ userId: "u1", confirmEmail: "x" }));
    expect(thrown).toContain("ok=0");
  });

  it("encodes a message that would otherwise break the URL", async () => {
    operation().mockResolvedValue({
      ok: true,
      message: "a & b = c? yes",
    });

    const thrown = await run(action(), form({ userId: "u1", confirmEmail: "x" }));
    expect(thrown).toContain("notice=a+%26+b+%3D+c%3F+yes");
  });

  it("treats a missing field as empty rather than crashing", async () => {
    await run(action(), form({}));
    expect(operation()).toHaveBeenCalled();
  });
});

describe("setPlanAction", () => {
  it("passes the requested plan through for validation downstream", async () => {
    await run(setPlanAction, form({ userId: "u1", plan: "pro" }));

    expect(setUserPlanMock).toHaveBeenCalledWith(
      appDb,
      { userId: "u0", email: "admin@example.com" },
      "u1",
      "pro",
    );
  });
});

describe("revokeSessionsAction", () => {
  it("names only the account", async () => {
    await run(revokeSessionsAction, form({ userId: "u1" }));

    expect(revokeUserSessionsMock).toHaveBeenCalledWith(
      appDb,
      expect.anything(),
      "u1",
    );
  });
});

describe("deleteUserAction", () => {
  it("forwards the typed confirmation for checking", async () => {
    await run(
      deleteUserAction,
      form({ userId: "u1", confirmEmail: "a@example.com" }),
    );

    expect(deleteUserAccountMock).toHaveBeenCalledWith(
      appDb,
      expect.anything(),
      "u1",
      "a@example.com",
    );
  });
});
