import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The authorization boundary for `/admin`.
 *
 * These are the tests that matter most in this change: every one of them
 * describes a way in, and a regression in any of them is a breach rather than a
 * bug. They are written against the guard directly rather than through a page,
 * because the guard is what every page depends on.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const getSessionMock = vi.fn();
const limitMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", async () => {
  const actual = await vi.importActual<typeof import("@/db")>("@/db");
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({ where: () => ({ limit: limitMock }) }),
      }),
    }),
  };
});

// `requireAdmin` is wrapped in React's `cache`, which memoizes per render pass.
// Outside one, each call re-runs — which is what lets these tests vary the
// session without fighting a cached result.
const { requireAdmin, isAdminRole, ADMIN_ROLE, DEFAULT_ROLE } = await import(
  "@/lib/admin/guard"
);

const SIGNED_IN = { user: { id: "u1", email: "admin@example.com" } };

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  limitMock.mockResolvedValue([{ role: ADMIN_ROLE, email: "admin@example.com" }]);
});

afterEach(() => vi.restoreAllMocks());

describe("isAdminRole", () => {
  it("accepts exactly one value", () => {
    expect(isAdminRole(ADMIN_ROLE)).toBe(true);
  });

  it.each([
    [DEFAULT_ROLE],
    ["Admin"],
    ["administrator"],
    ["admin "],
    [""],
    [null],
    [undefined],
  ])("rejects %o", (role) => {
    // No trimming, no case-folding, no prefix matching. A role check that is
    // clever about what it accepts is a role check with a bypass in it.
    expect(isAdminRole(role)).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("returns the identity for an admin", async () => {
    await expect(requireAdmin()).resolves.toEqual({
      userId: "u1",
      email: "admin@example.com",
      role: ADMIN_ROLE,
    });
  });

  it("sends an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/sign-in");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("404s a signed-in non-admin rather than 403ing them", async () => {
    // A 403 confirms the route exists and that the account merely lacks the
    // role. That is a free hint, so the route denies its own existence.
    limitMock.mockResolvedValue([{ role: DEFAULT_ROLE, email: "u@example.com" }]);
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("404s a live session whose account has been deleted", async () => {
    // The cookie outlived the row. Without the `!row` branch this would throw
    // a TypeError, and an error page is not an authorization decision.
    limitMock.mockResolvedValue([]);
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("reads the role from the database, not from the session object", async () => {
    // The session is a snapshot. If the guard trusted `session.user.role`, a
    // revoked admin would keep access until their cookie expired — and would
    // keep it indefinitely if `session.cookieCache` were ever enabled.
    getSessionMock.mockResolvedValue({
      user: { id: "u1", email: "admin@example.com", role: ADMIN_ROLE },
    });
    limitMock.mockResolvedValue([{ role: DEFAULT_ROLE, email: "u@example.com" }]);

    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("trusts the database over a forged role claim in the session", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "u1", email: "attacker@example.com", role: "admin" },
    });
    limitMock.mockResolvedValue([
      { role: "user", email: "attacker@example.com" },
    ]);

    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("returns the email from the row rather than from the session", async () => {
    limitMock.mockResolvedValue([
      { role: ADMIN_ROLE, email: "canonical@example.com" },
    ]);
    getSessionMock.mockResolvedValue({
      user: { id: "u1", email: "stale@example.com" },
    });

    await expect(requireAdmin()).resolves.toMatchObject({
      email: "canonical@example.com",
    });
  });
});
