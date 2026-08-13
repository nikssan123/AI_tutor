import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Data Access Layer Next's authentication guide asks for: one memoized
 * session check, called by every page and action, rather than a layout check
 * that cannot actually stop a route from rendering.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));

const { currentUser, requireUser, toAccountUser } = await import(
  "@/lib/account/session"
);

const SIGNED_IN = {
  user: {
    id: "u1",
    email: "learner@example.com",
    name: "Learner",
    emailVerified: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    handle: "learner",
    locale: "bg",
    timezone: "Europe/Sofia",
    plan: "pro",
    role: "admin",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toAccountUser", () => {
  it("copies across exactly the fields a screen is allowed to know", () => {
    expect(toAccountUser(SIGNED_IN.user)).toEqual({
      id: "u1",
      email: "learner@example.com",
      name: "Learner",
      emailVerified: true,
      handle: "learner",
      locale: "bg",
      timezone: "Europe/Sofia",
      plan: "pro",
      role: "admin",
    });
  });

  it("does not pass the session's user object through", () => {
    // A DTO, per the guide's "Using Data Transfer Objects": `session.user`
    // gains fields as plugins arrive, and handing it to a Client Component
    // serialises whatever it gains next into the page.
    const result = toAccountUser({
      ...SIGNED_IN.user,
      image: "https://x.test/a.png",
      stripeCustomerId: "cus_123",
    });

    expect(result).not.toHaveProperty("stripeCustomerId");
    expect(result).not.toHaveProperty("image");
  });

  it("falls back to the column defaults rather than to undefined", () => {
    // Better Auth types every optional additional field as possibly-undefined
    // while the columns are NOT NULL DEFAULT. A session with no timezone would
    // otherwise plan someone's day in the wrong one.
    const result = toAccountUser({
      id: "u2",
      email: "a@b.co",
      name: "A",
      emailVerified: false,
    } as unknown as typeof SIGNED_IN.user);

    expect(result).toMatchObject({
      handle: null,
      locale: "en",
      timezone: "UTC",
      plan: "free",
      role: "user",
    });
  });
});

describe("currentUser", () => {
  it("returns null when signed out, so chrome can render either way", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await currentUser()).toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns the account when signed in", async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    expect(await currentUser()).toMatchObject({ id: "u1" });
  });
});

describe("requireUser", () => {
  it("sends a signed-out visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("returns the account when signed in", async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    expect(await requireUser()).toMatchObject({
      id: "u1",
      email: "learner@example.com",
    });
  });
});
