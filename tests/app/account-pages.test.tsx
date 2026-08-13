// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The account screens. Every one of them is server-rendered with no client
 * JavaScript, so these render the route component directly and assert on the
 * markup a browser with a dead bundle would still get.
 */

const listUserAccounts = vi.fn();
const googleEnabledMock = vi.fn();
const requireUserMock = vi.fn();
const currentUserMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { listUserAccounts } }),
  googleEnabled: () => googleEnabledMock(),
  MIN_PASSWORD_LENGTH: 8,
  VERIFY_CALLBACK: "/verify-email",
}));
vi.mock("@/lib/account/session", () => ({
  requireUser: () => requireUserMock(),
  currentUser: () => currentUserMock(),
}));

const { default: AccountPage } = await import("@/app/(app)/account/page");
const { default: ForgotPasswordPage } = await import(
  "@/app/(app)/forgot-password/page"
);
const { default: ResetPasswordPage } = await import(
  "@/app/(app)/reset-password/page"
);
const { default: VerifyEmailPage } = await import(
  "@/app/(app)/verify-email/page"
);
const { default: AppLayout } = await import("@/app/(app)/layout");

const USER = {
  id: "u1",
  email: "learner@example.com",
  name: "Learner",
  emailVerified: true,
  handle: "learner",
  locale: "en",
  timezone: "Europe/Sofia",
  plan: "free",
  role: "user",
};

const search = <T,>(params: T) => Promise.resolve(params);
const credential = [{ providerId: "credential" }];

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(USER);
  currentUserMock.mockResolvedValue(USER);
  listUserAccounts.mockResolvedValue(credential);
  googleEnabledMock.mockReturnValue(false);
});

afterEach(cleanup);

describe("/account — profile", () => {
  it("is noindexed like the rest of the segment", async () => {
    const { metadata } = await import("@/app/(app)/account/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("shows the current details as the form's starting point", async () => {
    render(await AccountPage({ searchParams: search({}) }));

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Learner",
    );
    expect((screen.getByLabelText("Handle") as HTMLInputElement).value).toBe(
      "learner",
    );
    expect((screen.getByLabelText("Timezone") as HTMLInputElement).value).toBe(
      "Europe/Sofia",
    );
  });

  it("says the handle is public, because it is", async () => {
    // It appears in the Proof Page URL. Someone choosing one should know that
    // before they choose it, not after they publish.
    render(await AccountPage({ searchParams: search({}) }));
    expect(screen.getByText(/public/i)).toBeDefined();
  });

  it("copes with an account that has no handle yet", async () => {
    requireUserMock.mockResolvedValue({ ...USER, handle: null });
    render(await AccountPage({ searchParams: search({}) }));
    expect((screen.getByLabelText("Handle") as HTMLInputElement).value).toBe("");
  });

  it("offers the platform's timezones without any script", async () => {
    const { container } = render(await AccountPage({ searchParams: search({}) }));
    const options = container.querySelectorAll("#timezones option");
    expect(options.length).toBeGreaterThan(100);
  });

  it("reports the outcome of whatever was just submitted", async () => {
    render(await AccountPage({ searchParams: search({ ok: "Saved." }) }));
    expect(screen.getByText("Saved.")).toBeDefined();

    cleanup();
    render(
      await AccountPage({ searchParams: search({ error: "That handle is taken." }) }),
    );
    expect(screen.getByText("That handle is taken.")).toBeDefined();
  });
});

describe("/account — email", () => {
  it("shows a confirmed address as confirmed, with nothing to resend", async () => {
    render(await AccountPage({ searchParams: search({}) }));

    expect(screen.getByText("Confirmed")).toBeDefined();
    expect(screen.queryByText(/send the confirmation email again/i)).toBeNull();
  });

  it("says what an unconfirmed address actually costs", async () => {
    // Not "please verify your email" — the consequence, which is that a
    // forgotten password cannot be recovered.
    requireUserMock.mockResolvedValue({ ...USER, emailVerified: false });
    render(await AccountPage({ searchParams: search({}) }));

    expect(screen.getByText("Not confirmed")).toBeDefined();
    expect(screen.getByText(/cannot send you a password reset/i)).toBeDefined();
    expect(screen.getByText(/send the confirmation email again/i)).toBeDefined();
  });

  it("tells a verified account which inbox the approval goes to", async () => {
    // The old address approves the move — the property that stops a stolen
    // session relocating an account quietly.
    render(await AccountPage({ searchParams: search({}) }));
    expect(screen.getByText(/your current address to approve/i)).toBeDefined();
  });

  it("tells an unverified account the link goes to the new address", async () => {
    requireUserMock.mockResolvedValue({ ...USER, emailVerified: false });
    render(await AccountPage({ searchParams: search({}) }));
    expect(screen.getByText(/link to the new address/i)).toBeDefined();
  });
});

describe("/account — password", () => {
  it("asks for the current one when the account has a password", async () => {
    render(await AccountPage({ searchParams: search({}) }));

    expect(screen.getByLabelText("Current password")).toBeDefined();
    expect(screen.getByRole("button", { name: "Change password" })).toBeDefined();
  });

  it("offers to set a first one for an account that arrived via Google", async () => {
    listUserAccounts.mockResolvedValue([{ providerId: "google" }]);
    render(await AccountPage({ searchParams: search({}) }));

    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.getByRole("button", { name: "Set a password" })).toBeDefined();
  });
});

describe("/account — Google", () => {
  it("says nothing at all when Google is not configured", async () => {
    render(await AccountPage({ searchParams: search({}) }));
    expect(screen.queryByText("Google")).toBeNull();
  });

  it("offers to connect when it is configured but unlinked", async () => {
    googleEnabledMock.mockReturnValue(true);
    render(await AccountPage({ searchParams: search({}) }));

    expect(screen.getByText("Not connected")).toBeDefined();
    expect(screen.getByRole("button", { name: "Connect Google" })).toBeDefined();
  });

  it("offers to disconnect when it is linked and a password exists", async () => {
    googleEnabledMock.mockReturnValue(true);
    listUserAccounts.mockResolvedValue([
      { providerId: "credential" },
      { providerId: "google" },
    ]);
    render(await AccountPage({ searchParams: search({}) }));

    expect(screen.getByText("Connected")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Disconnect Google" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("refuses to disconnect the only way in, and says why", async () => {
    googleEnabledMock.mockReturnValue(true);
    listUserAccounts.mockResolvedValue([{ providerId: "google" }]);
    render(await AccountPage({ searchParams: search({}) }));

    expect(
      (screen.getByRole("button", { name: "Disconnect Google" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/set a password first/i)).toBeDefined();
  });
});

describe("/account — sessions", () => {
  it("offers the thing to do when a password may be compromised", async () => {
    render(await AccountPage({ searchParams: search({}) }));
    expect(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    ).toBeDefined();
  });
});

describe("the (app) header", () => {
  it("carries the sign-out that did not exist before", async () => {
    render(await AppLayout({ children: <p>child</p> }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
    expect(screen.getByText("Account")).toBeDefined();
  });

  it("signs out through a form, never a link", async () => {
    // A GET that ends a session is one prefetch away from ending it by
    // accident.
    const { container } = render(await AppLayout({ children: <p>child</p> }));
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button.closest("form")).not.toBeNull();
    expect(container.querySelector('a[href="/sign-out"]')).toBeNull();
  });

  it("nudges an unconfirmed address, once, with a way to fix it", async () => {
    currentUserMock.mockResolvedValue({ ...USER, emailVerified: false });
    render(await AppLayout({ children: <p>child</p> }));

    expect(screen.getByText(/isn.t confirmed yet/i)).toBeDefined();
    expect(screen.getByText("Confirm it")).toBeDefined();
  });

  it("stays quiet once the address is confirmed", async () => {
    render(await AppLayout({ children: <p>child</p> }));
    expect(screen.queryByText(/isn.t confirmed yet/i)).toBeNull();
  });
});

describe("/forgot-password", () => {
  it("asks for an address", async () => {
    render(await ForgotPasswordPage({ searchParams: search({}) }));
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByRole("button", { name: "Send the link" })).toBeDefined();
  });

  it("says the same thing whether or not the address has an account", async () => {
    // Confirming which addresses are registered would make this form a lookup
    // service for anyone who wanted one.
    render(await ForgotPasswordPage({ searchParams: search({ sent: "1" }) }));

    expect(screen.getByText(/if that address has an account/i)).toBeDefined();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("reports a malformed address without pretending to have searched", async () => {
    render(await ForgotPasswordPage({ searchParams: search({ error: "1" }) }));
    expect(screen.getByText(/doesn.t look like an email address/i)).toBeDefined();
  });
});

describe("/reset-password", () => {
  it("offers the form when the link carried a token", async () => {
    const { container } = render(
      await ResetPasswordPage({ searchParams: search({ token: "tok" }) }),
    );

    expect(screen.getByLabelText(/new password/i)).toBeDefined();
    expect(
      (container.querySelector('input[name="token"]') as HTMLInputElement).value,
    ).toBe("tok");
  });

  it("warns that every device is about to be signed out", async () => {
    render(await ResetPasswordPage({ searchParams: search({ token: "tok" }) }));
    expect(screen.getByText(/signs out every device/i)).toBeDefined();
  });

  it("offers a new link when there is no token to submit", async () => {
    render(await ResetPasswordPage({ searchParams: search({}) }));

    expect(screen.getByText(/didn.t work/i)).toBeDefined();
    expect(screen.getByText("Send a new link")).toBeDefined();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });

  it("turns Better Auth's bare code into a sentence", async () => {
    render(
      await ResetPasswordPage({ searchParams: search({ error: "TOKEN_EXPIRED" }) }),
    );
    expect(screen.getByText(/that link has expired/i)).toBeDefined();
  });

  it("passes our own sentence through untouched", async () => {
    render(
      await ResetPasswordPage({
        searchParams: search({ token: "tok", error: "Those two passwords don't match." }),
      }),
    );
    expect(screen.getByText("Those two passwords don't match.")).toBeDefined();
  });
});

describe("/verify-email", () => {
  it("treats an empty query as success, because that is what it is", async () => {
    render(await VerifyEmailPage({ searchParams: search({}) }));

    expect(screen.getByText("Confirmed")).toBeDefined();
    expect(screen.getByText(/learner@example.com is confirmed/i)).toBeDefined();
    expect(screen.getByText("Back to today")).toBeDefined();
  });

  it("still reads sensibly when the link opened in a signed-out browser", async () => {
    // The mail client picks the browser, and it is often not the one holding
    // the session.
    currentUserMock.mockResolvedValue(null);
    render(await VerifyEmailPage({ searchParams: search({}) }));

    expect(screen.getByText(/your address is confirmed/i)).toBeDefined();
    expect(screen.getByText("Sign in")).toBeDefined();
  });

  it("explains an expired link and where to get another", async () => {
    render(await VerifyEmailPage({ searchParams: search({ error: "TOKEN_EXPIRED" }) }));

    expect(screen.getByText(/that link has expired/i)).toBeDefined();
    expect(screen.getByText("Go to your account")).toBeDefined();
  });

  it("sends a signed-out reader to sign in rather than to an account they can't see", async () => {
    currentUserMock.mockResolvedValue(null);
    render(await VerifyEmailPage({ searchParams: search({ error: "INVALID_TOKEN" }) }));
    expect(screen.getByText("Sign in")).toBeDefined();
  });

  it("falls back for a code it has never heard of", async () => {
    render(await VerifyEmailPage({ searchParams: search({ error: "WAT" }) }));
    expect(screen.getByText(/couldn't confirm that address/i)).toBeDefined();
  });
});
