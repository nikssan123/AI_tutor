// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * Google sign-in, which is a Server Action rather than a call from the client
 * form. That is the whole point of the arrangement: the button works on a page
 * whose JavaScript never loaded, which is exactly the page someone is on when
 * they most need another way in.
 */

const signInSocial = vi.fn();
const googleEnabledMock = vi.fn();
const getSession = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({
  // The session module is deliberately left real here, so these render the
  // page through the same guard production does rather than around it.
  getAuth: () => ({ api: { signInSocial, getSession } }),
  googleEnabled: () => googleEnabledMock(),
}));

const { signInWithGoogleAction } = await import("@/app/(app)/sign-in/actions");
const { default: SignInPage } = await import("@/app/(app)/sign-in/page");

beforeEach(() => {
  vi.clearAllMocks();
  googleEnabledMock.mockReturnValue(true);
  signInSocial.mockResolvedValue({ url: "https://accounts.google.test/o" });
  getSession.mockResolvedValue(null);
});

afterEach(cleanup);

describe("signInWithGoogleAction", () => {
  it("sends the browser to Google, landing back on /today", async () => {
    await expect(signInWithGoogleAction()).rejects.toThrow(
      "REDIRECT:https://accounts.google.test/o",
    );
    expect(signInSocial).toHaveBeenCalledWith({
      body: { provider: "google", callbackURL: "/today" },
    });
  });

  it("lands back where the visitor was headed, not on /today", async () => {
    const body = new FormData();
    body.set("next", "/start?topic=basket weaving");

    await expect(signInWithGoogleAction(body)).rejects.toThrow("REDIRECT:");
    expect(signInSocial).toHaveBeenCalledWith({
      body: {
        provider: "google",
        callbackURL: "/start?topic=basket weaving",
      },
    });
  });

  it("will not hand Google an off-site callback", async () => {
    // The body is whatever was posted, not whatever the page rendered — so
    // this is checked here as well as on the way in.
    const body = new FormData();
    body.set("next", "https://evil.example");

    await expect(signInWithGoogleAction(body)).rejects.toThrow("REDIRECT:");
    expect(signInSocial).toHaveBeenCalledWith({
      body: { provider: "google", callbackURL: "/today" },
    });
  });

  it("fails visibly if the provider returns no URL to go to", async () => {
    // Typed optional because a provider can be configured to return an id
    // token instead; Google's redirect flow always has one, and there is
    // nothing sensible to do without it.
    signInSocial.mockResolvedValue({ url: undefined });
    await expect(signInWithGoogleAction()).rejects.toThrow(
      "REDIRECT:/sign-in?error=google",
    );
  });
});

describe("/sign-in", () => {
  it("offers Google when it is configured", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeDefined();
  });

  it("offers nothing when it is not", async () => {
    googleEnabledMock.mockReturnValue(false);
    render(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  });

  it("always offers the way out of a forgotten password", async () => {
    const { container } = render(
      await SignInPage({ searchParams: Promise.resolve({}) }),
    );
    expect(container.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it("confirms a completed reset on the screen that follows it", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ reset: "1" }) }));
    expect(screen.getByText(/password changed/i)).toBeDefined();
  });

  it("says so when Google didn't complete", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ error: "google" }) }));
    expect(screen.getByText(/didn.t work with google/i)).toBeDefined();
  });

  it("hands the destination to the Google form as a posted field", async () => {
    // Google's callback is fixed before the round trip, so it cannot be read
    // back off a URL that no longer exists by the time we return.
    const { container } = render(
      await SignInPage({
        searchParams: Promise.resolve({ next: "/start?topic=rust" }),
      }),
    );
    expect(
      container.querySelector<HTMLInputElement>('input[name="next"]')!.value,
    ).toBe("/start?topic=rust");
  });

  it("sanitises the destination once, before anything renders it", async () => {
    const { container } = render(
      await SignInPage({
        searchParams: Promise.resolve({ next: "https://evil.example" }),
      }),
    );
    expect(
      container.querySelector<HTMLInputElement>('input[name="next"]')!.value,
    ).toBe("/today");
  });

  it("never shows the form to someone who is already signed in", async () => {
    // The marketing header is static, so it offers "Sign in" to signed-in
    // learners too. Following it should put them in the app, not in front of
    // a form asking them to do again what they have already done.
    getSession.mockResolvedValue({ user: { id: "u1", email: "a@b.co" } });

    await expect(
      SignInPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/today");
  });

  it("takes them where they were headed, not just to /today", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", email: "a@b.co" } });

    await expect(
      SignInPage({
        searchParams: Promise.resolve({ next: "/start?topic=rust" }),
      }),
    ).rejects.toThrow("REDIRECT:/start?topic=rust");
  });
});
