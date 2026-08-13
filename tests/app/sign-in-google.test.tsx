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

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { signInSocial } }),
  googleEnabled: () => googleEnabledMock(),
}));

const { signInWithGoogleAction } = await import("@/app/(app)/sign-in/actions");
const { default: SignInPage } = await import("@/app/(app)/sign-in/page");

beforeEach(() => {
  vi.clearAllMocks();
  googleEnabledMock.mockReturnValue(true);
  signInSocial.mockResolvedValue({ url: "https://accounts.google.test/o" });
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
});
