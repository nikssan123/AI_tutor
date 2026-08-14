import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/r/{code}`.
 *
 * A route handler rather than a page, deliberately — §22.2 is explicit that
 * auto-published per-user pages are the scaled-content-abuse shape, so the code
 * is spent here and the visitor lands on the ordinary home page.
 *
 * The behaviour worth asserting is what happens to somebody who mistyped: they
 * meet the product, not an error, and simply arrive unattributed.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const referrerMock = vi.fn();
const setMock = vi.fn();
const captureMock = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setMock, get: () => undefined }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/referral/store", () => ({
  referrerFor: (...a: unknown[]) => referrerMock(...(a as [])),
}));
vi.mock("@/lib/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability")>()),
  capture: (...a: unknown[]) => captureMock(...(a as [])),
}));

const { GET } = await import("@/app/(marketing)/r/[code]/route");

const request = new Request("https://meritkeep.com/r/abcd2345");
const call = (code: string) =>
  GET(request, { params: Promise.resolve({ code }) });

beforeEach(() => {
  vi.clearAllMocks();
  referrerMock.mockResolvedValue({
    userId: "u1",
    name: "Ana",
    email: "ana@example.com",
  });
});

describe("GET /r/[code]", () => {
  it("remembers the invitation and sends the visitor to the home page", async () => {
    await expect(call("abcd2345")).rejects.toThrow("REDIRECT:/?invited=1");

    expect(setMock).toHaveBeenCalledWith(
      "mk_ref",
      "abcd2345",
      expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
    );
    expect(captureMock).toHaveBeenCalledWith("referral_visit", {
      code: "abcd2345",
    });
  });

  it("accepts a code pasted with its path", async () => {
    await expect(call("/r/abcd2345")).rejects.toThrow("REDIRECT:/?invited=1");
    expect(setMock.mock.calls[0]![1]).toBe("abcd2345");
  });

  it("accepts a code shouted in upper case", async () => {
    await expect(call("ABCD2345")).rejects.toThrow("REDIRECT:/?invited=1");
    expect(setMock.mock.calls[0]![1]).toBe("abcd2345");
  });

  it("sends a mistyped code home rather than to a 404", async () => {
    // Somebody who typed a code off a photograph and got one character wrong
    // should meet the product, not an error page.
    await expect(call("not-a-code")).rejects.toThrow("REDIRECT:/");
    expect(setMock).not.toHaveBeenCalled();
    expect(referrerMock).not.toHaveBeenCalled();
  });

  it("sends a well-formed code nobody owns home too", async () => {
    referrerMock.mockResolvedValue(undefined);
    await expect(call("zzzzzzzz")).rejects.toThrow("REDIRECT:/");
    expect(setMock).not.toHaveBeenCalled();
  });
});
