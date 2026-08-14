import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `attributeSignup` — the Better Auth `user.create.after` hook.
 *
 * The reason it is a function rather than an inline callback is that this file
 * exists: a hook buried in a config object cannot be called without standing up
 * the whole auth instance.
 *
 * The two properties worth guarding are that it **never throws** — a referral
 * that cannot be recorded is a missed reward, a hook that throws is a failed
 * signup — and that it runs on the Google path as well as the email one, which
 * is why it lives here rather than in the sign-up action.
 */

const attributeMock = vi.fn(async (..._args: unknown[]) => ({
  status: "recorded" as const,
}));
const deleteMock = vi.fn();
const cookieStore = { value: undefined as string | undefined };
const headerStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "mk_ref" && cookieStore.value
        ? { name, value: cookieStore.value }
        : undefined,
    delete: deleteMock,
  }),
  headers: async () => ({ get: (name: string) => headerStore.get(name) ?? null }),
}));
vi.mock("@/db", () => ({ getDb: () => ({ marker: "db" }) }));
vi.mock("@/lib/referral/store", () => ({
  attribute: (...a: unknown[]) => attributeMock(...(a as [])),
}));

const { attributeSignup, DEV_PEPPER } = await import("@/lib/referral/signup");

const CREATED = { id: "u1", email: "bo@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.value = "abcd2345";
  headerStore.clear();
});

describe("attributeSignup", () => {
  it("records the referral carried in the cookie", async () => {
    headerStore.set("user-agent", "Mozilla/5.0");
    headerStore.set("x-forwarded-for", "203.0.113.9");

    await attributeSignup(CREATED, { REFERRAL_PEPPER: "prod-pepper" });

    expect(attributeMock).toHaveBeenCalledOnce();
    expect(attributeMock.mock.calls[0]![1]).toMatchObject({
      code: "abcd2345",
      referee: { userId: "u1", email: "bo@example.com" },
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0",
      pepper: "prod-pepper",
    });
  });

  it("spends the cookie, so a second account is not attributed too", async () => {
    await attributeSignup(CREATED, {});
    expect(deleteMock).toHaveBeenCalledWith("mk_ref");
  });

  it("does nothing at all without a cookie", async () => {
    // The overwhelmingly common case: an organic signup.
    cookieStore.value = undefined;
    await attributeSignup(CREATED, {});

    expect(attributeMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("takes only the client from a proxy chain", async () => {
    // The rest of `x-forwarded-for` is proxies that added themselves; only the
    // first entry says anything about the person.
    headerStore.set("x-forwarded-for", " 203.0.113.9 , 10.0.0.1, 10.0.0.2");
    await attributeSignup(CREATED, {});

    expect(attributeMock.mock.calls[0]![1]).toMatchObject({
      ip: "203.0.113.9",
    });
  });

  it("copes with no forwarding header and no user agent", async () => {
    await attributeSignup(CREATED, {});
    expect(attributeMock.mock.calls[0]![1]).toMatchObject({
      ip: null,
      userAgent: null,
    });
  });

  it("falls back to the development pepper when none is configured", async () => {
    await attributeSignup(CREATED, {});
    expect(attributeMock.mock.calls[0]![1]).toMatchObject({
      pepper: DEV_PEPPER,
    });
  });

  it("swallows a failure rather than failing the signup", async () => {
    // The whole reason for the try. A missed reward is recoverable; an account
    // that could not be created is not.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    attributeMock.mockRejectedValueOnce(new Error("database went away"));

    await expect(attributeSignup(CREATED, {})).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reads the environment when none was passed", async () => {
    await expect(attributeSignup(CREATED)).resolves.toBeUndefined();
    expect(attributeMock).toHaveBeenCalledOnce();
  });
});
