import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";

/**
 * The Server Actions behind `/account`, `/forgot-password` and
 * `/reset-password`.
 *
 * Better Auth's own endpoints are stubbed: what they do is the library's
 * business, and what matters here is the decisions that are ours — which body
 * we send, which message a person is left with, and the two places where
 * getting it wrong is a security bug rather than a papercut (the reset form
 * must not reveal who has an account; a Google hand-off must not be swallowed
 * by our own error handling).
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

const api = {
  signOut: vi.fn(),
  revokeSessions: vi.fn(),
  updateUser: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  setPassword: vi.fn(),
  sendVerificationOTP: vi.fn(),
  linkSocialAccount: vi.fn(),
  unlinkAccount: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
};

const requireUserMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api }),
  MIN_PASSWORD_LENGTH: 8,
  VERIFY_CALLBACK: "/verify-email",
}));
vi.mock("@/lib/account/session", () => ({
  requireUser: () => requireUserMock(),
}));

const actions = await import("@/app/(app)/account/actions");
const { requestResetAction } = await import(
  "@/app/(app)/forgot-password/actions"
);
const { resetPasswordAction } = await import(
  "@/app/(app)/reset-password/actions"
);

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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** The URL an action redirected to, with its message decoded. */
function landed(error: unknown): { path: string; ok?: string; message?: string } {
  const url = String((error as Error).message).replace("REDIRECT:", "");
  const [path, query] = url.split("?");
  const params = new URLSearchParams(query ?? "");
  return {
    path: path!,
    ok: params.get("ok") ?? undefined,
    message: params.get("error") ?? params.get("ok") ?? undefined,
  };
}

const profile = {
  name: "Nikolay",
  handle: "nikolay",
  locale: "en",
  timezone: "Europe/Sofia",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(USER);
  for (const fn of Object.values(api)) fn.mockResolvedValue({ status: true });
  api.linkSocialAccount.mockResolvedValue({ url: "https://accounts.google.test/o" });
});

describe("signOutAction", () => {
  it("ends the session and goes home, not to the sign-in form", async () => {
    // Someone who just signed out has said they are done; landing them on a
    // login form reads as a failed sign-out.
    await expect(actions.signOutAction()).rejects.toThrow("REDIRECT:/");
    expect(api.signOut).toHaveBeenCalledOnce();
  });
});

describe("signOutEverywhereAction", () => {
  it("revokes every session, then clears this browser's cookie", async () => {
    await expect(actions.signOutEverywhereAction()).rejects.toThrow("REDIRECT:/");

    expect(api.revokeSessions).toHaveBeenCalledOnce();
    expect(api.signOut).toHaveBeenCalledOnce();
    // Order matters: sign-out first would leave no session to revoke the rest.
    expect(api.revokeSessions.mock.invocationCallOrder[0]!).toBeLessThan(
      api.signOut.mock.invocationCallOrder[0]!,
    );
  });
});

describe("updateProfileAction", () => {
  it("saves a valid profile", async () => {
    await expect(actions.updateProfileAction(form(profile))).rejects.toThrow(
      "REDIRECT:/account?ok=Saved.",
    );
    expect(api.updateUser).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: profile,
    });
  });

  it("refuses before calling the API when the form is wrong", async () => {
    const error = await actions
      .updateProfileAction(form({ ...profile, timezone: "Mars/Olympus" }))
      .catch((e) => e);

    expect(landed(error).message).toMatch(/timezone/i);
    expect(api.updateUser).not.toHaveBeenCalled();
  });

  it("says a handle is taken rather than showing a Postgres error", async () => {
    api.updateUser.mockRejectedValue({ code: "23505" });

    const error = await actions.updateProfileAction(form(profile)).catch((e) => e);
    expect(landed(error).message).toMatch(/handle is taken/i);
  });

  it("requires a session", async () => {
    // Next's guidance: treat a Server Action like a public endpoint.
    requireUserMock.mockRejectedValue(new Error("REDIRECT:/sign-in"));
    await expect(actions.updateProfileAction(form(profile))).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    expect(api.updateUser).not.toHaveBeenCalled();
  });
});

describe("changeEmailAction", () => {
  it("asks the old address to approve, when there is one to ask", async () => {
    const error = await actions
      .changeEmailAction(form({ newEmail: "New@Example.com" }))
      .catch((e) => e);

    expect(api.changeEmail).toHaveBeenCalledWith({
      headers: expect.anything(),
      // Lower-cased before it is sent, so the address that lands in the
      // database matches the one a later sign-in types.
      body: { newEmail: "new@example.com", callbackURL: "/verify-email" },
    });
    expect(landed(error).ok).toContain("learner@example.com");
    expect(landed(error).ok).toMatch(/your current address/i);
  });

  it("points an unverified account at the new address instead", async () => {
    requireUserMock.mockResolvedValue({ ...USER, emailVerified: false });

    const error = await actions
      .changeEmailAction(form({ newEmail: "new@example.com" }))
      .catch((e) => e);

    expect(landed(error).ok).toContain("new@example.com");
  });

  it.each([["not-an-email"], [""], ["a@b"]])(
    "rejects %s without asking the server",
    async (newEmail) => {
      const error = await actions.changeEmailAction(form({ newEmail })).catch((e) => e);
      expect(landed(error).message).toMatch(/doesn't look like an email/i);
      expect(api.changeEmail).not.toHaveBeenCalled();
    },
  );

  it("survives a POST that carries no field at all", async () => {
    // Server Actions are public endpoints: nothing guarantees the body came
    // from our form.
    const error = await actions.changeEmailAction(new FormData()).catch((e) => e);
    expect(landed(error).message).toMatch(/doesn't look like an email/i);
  });

  it("says so when the address is the one already in use", async () => {
    const error = await actions
      .changeEmailAction(form({ newEmail: "LEARNER@example.com" }))
      .catch((e) => e);

    expect(landed(error).message).toMatch(/already your address/i);
    expect(api.changeEmail).not.toHaveBeenCalled();
  });

  it("translates a failure from the server", async () => {
    api.changeEmail.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "USER_ALREADY_EXISTS" }),
    );

    const error = await actions
      .changeEmailAction(form({ newEmail: "taken@example.com" }))
      .catch((e) => e);

    expect(landed(error).message).toMatch(/already in use/i);
  });
});

describe("changePasswordAction", () => {
  it("changes it and revokes every other session", async () => {
    const error = await actions
      .changePasswordAction(
        form({ currentPassword: "old-password", newPassword: "new-password" }),
      )
      .catch((e) => e);

    expect(api.changePassword).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: {
        currentPassword: "old-password",
        newPassword: "new-password",
        // Changing a password is a reaction to suspecting someone has it.
        revokeOtherSessions: true,
      },
    });
    expect(landed(error).ok).toMatch(/every other device/i);
  });

  it("checks the length before spending a round trip on it", async () => {
    const error = await actions
      .changePasswordAction(form({ currentPassword: "x", newPassword: "short" }))
      .catch((e) => e);

    expect(landed(error).message).toMatch(/at least 8/);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("survives a POST with no fields", async () => {
    const error = await actions.changePasswordAction(new FormData()).catch((e) => e);
    expect(landed(error).message).toMatch(/at least 8/);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("says plainly that the current password was wrong", async () => {
    api.changePassword.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }),
    );

    const error = await actions
      .changePasswordAction(
        form({ currentPassword: "wrong", newPassword: "new-password" }),
      )
      .catch((e) => e);

    expect(landed(error).message).toMatch(/current password isn't right/i);
  });
});

describe("setPasswordAction", () => {
  it("gives a Google-only account a password", async () => {
    // `setPassword` is a serverOnly endpoint — unreachable over HTTP, which is
    // why this page uses Server Actions rather than the client SDK.
    const error = await actions
      .setPasswordAction(form({ newPassword: "new-password" }))
      .catch((e) => e);

    expect(api.setPassword).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: { newPassword: "new-password" },
    });
    expect(landed(error).ok).toMatch(/password set/i);
  });

  it("enforces the same minimum length", async () => {
    const error = await actions
      .setPasswordAction(form({ newPassword: "short" }))
      .catch((e) => e);

    expect(landed(error).message).toMatch(/at least 8/);
    expect(api.setPassword).not.toHaveBeenCalled();
  });

  it("survives a POST with no fields", async () => {
    const error = await actions.setPasswordAction(new FormData()).catch((e) => e);
    expect(landed(error).message).toMatch(/at least 8/);
    expect(api.setPassword).not.toHaveBeenCalled();
  });

  it("reports a refusal from the server", async () => {
    api.setPassword.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "PASSWORD_ALREADY_SET" }),
    );

    const error = await actions
      .setPasswordAction(form({ newPassword: "new-password" }))
      .catch((e) => e);

    expect(landed(error).message).toMatch(/already has a password/i);
  });
});

describe("resendVerificationAction", () => {
  it("sends a code and lands on the screen that takes it", async () => {
    // Not back on /account with a green line — someone who asked for a code
    // should arrive where they can type it.
    requireUserMock.mockResolvedValue({ ...USER, emailVerified: false });

    await expect(actions.resendVerificationAction()).rejects.toThrow(
      "REDIRECT:/verify-email?sent=1",
    );
    expect(api.sendVerificationOTP).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: { email: "learner@example.com", type: "email-verification" },
    });
  });

  it("declines to send one to an address already confirmed", async () => {
    const error = await actions.resendVerificationAction().catch((e) => e);
    expect(landed(error).message).toMatch(/already confirmed/i);
    expect(api.sendVerificationOTP).not.toHaveBeenCalled();
  });

  it("reports a send failure", async () => {
    requireUserMock.mockResolvedValue({ ...USER, emailVerified: false });
    api.sendVerificationOTP.mockRejectedValue(new Error("smtp"));

    const error = await actions.resendVerificationAction().catch((e) => e);
    expect(landed(error).message).toMatch(/couldn't send/i);
  });
});

describe("linkGoogleAction", () => {
  it("hands the browser to Google", async () => {
    await expect(actions.linkGoogleAction()).rejects.toThrow(
      "REDIRECT:https://accounts.google.test/o",
    );
    expect(api.linkSocialAccount).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: { provider: "google", callbackURL: "/account" },
    });
  });

  it("does not mistake its own redirect for a failure", async () => {
    // `redirect` works by throwing. Calling it inside the try would turn every
    // successful hand-off into "we couldn't reach Google".
    const error = await actions.linkGoogleAction().catch((e) => e);
    expect(landed(error).path).toBe("https://accounts.google.test/o");
  });

  it("reports a real failure", async () => {
    api.linkSocialAccount.mockRejectedValue(new Error("network"));
    const error = await actions.linkGoogleAction().catch((e) => e);
    expect(landed(error).message).toMatch(/couldn't reach google/i);
  });
});

describe("unlinkGoogleAction", () => {
  it("disconnects the provider", async () => {
    const error = await actions.unlinkGoogleAction().catch((e) => e);

    expect(api.unlinkAccount).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: { providerId: "google" },
    });
    expect(landed(error).ok).toMatch(/disconnected/i);
  });

  it("explains a stale session rather than repeating 'not fresh'", async () => {
    api.unlinkAccount.mockRejectedValue(
      new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH" }),
    );

    const error = await actions.unlinkGoogleAction().catch((e) => e);
    expect(landed(error).message).toMatch(/sign out and back in/i);
  });

  it("explains why the last account cannot be unlinked", async () => {
    api.unlinkAccount.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "FAILED_TO_UNLINK_LAST_ACCOUNT" }),
    );

    const error = await actions.unlinkGoogleAction().catch((e) => e);
    expect(landed(error).message).toMatch(/set a password first/i);
  });
});

describe("requestResetAction", () => {
  it("asks for the reset and points the link at our own page", async () => {
    await expect(
      requestResetAction(form({ email: "Learner@Example.com" })),
    ).rejects.toThrow("REDIRECT:/forgot-password?sent=1");

    expect(api.requestPasswordReset).toHaveBeenCalledWith({
      body: { email: "learner@example.com", redirectTo: "/reset-password" },
    });
  });

  it("answers identically for an address with no account", async () => {
    // The whole point: anything else turns this form into a lookup service for
    // who is registered here.
    const known = await requestResetAction(form({ email: "a@b.co" })).catch((e) => e);

    api.requestPasswordReset.mockRejectedValue(new Error("no such user"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unknown = await requestResetAction(form({ email: "c@d.co" })).catch((e) => e);

    expect(String(unknown.message)).toBe(String(known.message));
  });

  it("logs a provider failure instead of showing it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    api.requestPasswordReset.mockRejectedValue(new Error("resend is down"));

    await expect(requestResetAction(form({ email: "a@b.co" }))).rejects.toThrow(
      "REDIRECT:/forgot-password?sent=1",
    );
    expect(logged).toHaveBeenCalledOnce();
  });

  it("rejects a malformed address, which leaks nothing", async () => {
    await expect(requestResetAction(form({ email: "nope" }))).rejects.toThrow(
      "REDIRECT:/forgot-password?error=1",
    );
    await expect(requestResetAction(new FormData())).rejects.toThrow(
      "REDIRECT:/forgot-password?error=1",
    );
    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe("resetPasswordAction", () => {
  const good = {
    token: "tok",
    newPassword: "new-password",
    confirmation: "new-password",
  };

  it("sets the password and sends them back to sign in", async () => {
    // Every session was just revoked, so there is nothing to sign in *with*
    // until they use the new password — which is the proof it took.
    await expect(resetPasswordAction(form(good))).rejects.toThrow(
      "REDIRECT:/sign-in?reset=1",
    );
    expect(api.resetPassword).toHaveBeenCalledWith({
      body: { newPassword: "new-password", token: "tok" },
    });
  });

  it("keeps the token in the URL when the two passwords differ", async () => {
    // Otherwise a typo costs them the link and they need a second email.
    const error = await resetPasswordAction(
      form({ ...good, confirmation: "different-password" }),
    ).catch((e) => e);

    expect(landed(error).path).toBe("/reset-password");
    expect(String(error.message)).toContain("token=tok");
    expect(landed(error).message).toMatch(/don't match/i);
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it("checks the length first", async () => {
    const error = await resetPasswordAction(
      form({ token: "tok", newPassword: "short", confirmation: "short" }),
    ).catch((e) => e);

    expect(landed(error).message).toMatch(/at least 8/);
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it("sends someone with no token back to ask for a new link", async () => {
    await expect(
      resetPasswordAction(form({ newPassword: "new-password" })),
    ).rejects.toThrow("REDIRECT:/forgot-password?error=1");
    await expect(resetPasswordAction(new FormData())).rejects.toThrow(
      "REDIRECT:/forgot-password?error=1",
    );
  });

  it("survives a token with no password behind it", async () => {
    const error = await resetPasswordAction(form({ token: "tok" })).catch((e) => e);
    expect(landed(error).message).toMatch(/at least 8/);
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it("translates an expired token", async () => {
    api.resetPassword.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "TOKEN_EXPIRED" }),
    );

    const error = await resetPasswordAction(form(good)).catch((e) => e);
    expect(landed(error).message).toMatch(/expired/i);
  });
});
