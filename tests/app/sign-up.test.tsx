// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { APIError } from "better-auth/api";

/**
 * §8 screen 3 — creating an account, and confirming it with a code.
 *
 * Sign-up is its own screen with its own fields, so the sign-in form no longer
 * has to be two forms wearing one coat. Both this action and the code form are
 * plain POSTs: no client JavaScript is involved in either.
 */

const signUpEmail = vi.fn();
const verifyEmailOTP = vi.fn();
const sendVerificationOTP = vi.fn();
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
  getAuth: () => ({
    api: { signUpEmail, verifyEmailOTP, sendVerificationOTP },
  }),
  googleEnabled: () => googleEnabledMock(),
  MIN_PASSWORD_LENGTH: 8,
  OTP_LENGTH: 6,
  VERIFY_CALLBACK: "/verify-email",
}));
vi.mock("@/lib/account/session", () => ({
  requireUser: () => requireUserMock(),
  currentUser: () => currentUserMock(),
}));

const { signUpAction } = await import("@/app/(app)/sign-up/actions");
const { sendCodeAction, verifyCodeAction } = await import(
  "@/app/(app)/verify-email/actions"
);
const { default: SignUpPage } = await import("@/app/(app)/sign-up/page");
const { default: VerifyEmailPage } = await import(
  "@/app/(app)/verify-email/page"
);

const UNVERIFIED = {
  id: "u1",
  email: "learner@example.com",
  name: "learner@example.com",
  emailVerified: false,
  handle: null,
  locale: "en",
  timezone: "UTC",
  plan: "free",
  role: "user",
};

const search = <T,>(params: T) => Promise.resolve(params);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** The URL an action redirected to, with its query decoded. */
function landed(error: unknown) {
  const url = String((error as Error).message).replace("REDIRECT:", "");
  const [path, query] = url.split("?");
  const params = new URLSearchParams(query ?? "");
  return {
    path: path!,
    message: params.get("error") ?? undefined,
    email: params.get("email") ?? undefined,
    next: params.get("next") ?? undefined,
  };
}

/** What `/learn` sends someone here holding, once they take up the offer. */
const TOPIC = "/start?topic=basket%20weaving";

const good = {
  email: "New@Example.com",
  password: "correct-horse",
  confirmation: "correct-horse",
};

beforeEach(() => {
  vi.clearAllMocks();
  googleEnabledMock.mockReturnValue(false);
  requireUserMock.mockResolvedValue(UNVERIFIED);
  currentUserMock.mockResolvedValue(UNVERIFIED);
  signUpEmail.mockResolvedValue({ user: { id: "u1" } });
  verifyEmailOTP.mockResolvedValue({ status: true });
  sendVerificationOTP.mockResolvedValue({ success: true });
});

afterEach(cleanup);

describe("/sign-up", () => {
  it("is noindexed", async () => {
    const { metadata } = await import("@/app/(app)/sign-up/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("asks for the password twice", async () => {
    render(await SignUpPage({ searchParams: search({}) }));

    // The password label carries its own hint, so it reads as "Password At
    // least 8 characters" to a screen reader — hence the prefix match.
    expect(screen.getByLabelText(/^Password/)).toBeDefined();
    expect(screen.getByLabelText("Type it again")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create the account" })).toBeDefined();
  });

  it("says up front that a code is coming", async () => {
    render(await SignUpPage({ searchParams: search({}) }));
    expect(screen.getByText(/confirm your email with a code/i)).toBeDefined();
  });

  it("puts the typed address back after a failed submit", async () => {
    // Otherwise mistyping the second password empties the whole form, which
    // makes a two-password form worse than a one-password form.
    render(
      await SignUpPage({
        searchParams: search({ error: "Those two passwords don't match.", email: "a@b.co" }),
      }),
    );

    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("a@b.co");
    expect(screen.getByRole("alert").textContent).toBe(
      "Those two passwords don't match.",
    );
  });

  it("offers Google only when it is configured", async () => {
    render(await SignUpPage({ searchParams: search({}) }));
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();

    cleanup();
    googleEnabledMock.mockReturnValue(true);
    render(await SignUpPage({ searchParams: search({}) }));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDefined();
  });

  it("links back to sign-in for someone who already has an account", async () => {
    const { container } = render(await SignUpPage({ searchParams: search({}) }));
    expect(container.querySelector('a[href="/sign-in"]')).not.toBeNull();
  });

  it("hands the destination to the form, the Google button and the sign-in link", async () => {
    googleEnabledMock.mockReturnValue(true);
    const { container } = render(
      await SignUpPage({ searchParams: search({ next: TOPIC }) }),
    );

    // Both forms, because Google skips the code screen entirely and email
    // does not — the destination has to survive whichever they pick.
    const carried = [...container.querySelectorAll<HTMLInputElement>(
      'input[name="next"]',
    )];
    expect(carried).toHaveLength(2);
    for (const field of carried) expect(field.value).toBe(TOPIC);

    expect(
      container.querySelector('a[href^="/sign-in?next="]'),
    ).not.toBeNull();
  });

  it("refuses to render an off-site destination into its own form", async () => {
    const { container } = render(
      await SignUpPage({ searchParams: search({ next: "//evil.example" }) }),
    );
    expect(
      container.querySelector<HTMLInputElement>('input[name="next"]')!.value,
    ).toBe("/today");
  });
});

describe("signUpAction", () => {
  it("creates the account and goes straight to the code", async () => {
    await expect(signUpAction(form(good))).rejects.toThrow(
      "REDIRECT:/verify-email",
    );

    expect(signUpEmail).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: {
        // Lower-cased, so the address stored matches what a later sign-in types.
        email: "new@example.com",
        password: "correct-horse",
        name: "new@example.com",
        callbackURL: "/verify-email",
      },
    });
  });

  /*
   * A new account is the arrival that most needs the subject kept: someone who
   * already has a login was probably not sent here by the offer on /learn.
   * The chain is sign-up → confirm the address → back to the subject, and it
   * is only worth anything if every hop carries it.
   */
  it("carries the destination on to the confirmation screen", async () => {
    const error = await signUpAction(form({ ...good, next: TOPIC })).catch(
      (e) => e,
    );

    expect(landed(error).path).toBe("/verify-email");
    expect(landed(error).next).toBe(TOPIC);
  });

  it("keeps it across a rejected form, so a typo does not cost the subject", async () => {
    const error = await signUpAction(
      form({ ...good, confirmation: "correct-house", next: TOPIC }),
    ).catch((e) => e);

    expect(landed(error).path).toBe("/sign-up");
    expect(landed(error).next).toBe(TOPIC);
  });

  it("drops an off-site destination instead of passing it along", async () => {
    const error = await signUpAction(
      form({ ...good, next: "https://evil.example" }),
    ).catch((e) => e);

    expect(landed(error).path).toBe("/verify-email");
    expect(landed(error).next).toBeUndefined();
  });

  it("refuses two passwords that differ, before asking the server", async () => {
    const error = await signUpAction(
      form({ ...good, confirmation: "correct-house" }),
    ).catch((e) => e);

    expect(landed(error).path).toBe("/sign-up");
    expect(landed(error).message).toMatch(/don't match/i);
    expect(landed(error).email).toBe("new@example.com");
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("enforces the minimum length", async () => {
    const error = await signUpAction(
      form({ email: "a@b.co", password: "short", confirmation: "short" }),
    ).catch((e) => e);

    expect(landed(error).message).toMatch(/at least 8/);
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it.each([["not-an-email"], [""], ["a@b"]])(
    "refuses %s as an address",
    async (email) => {
      const error = await signUpAction(form({ ...good, email })).catch((e) => e);
      expect(landed(error).message).toMatch(/doesn't look like an email/i);
      expect(signUpEmail).not.toHaveBeenCalled();
    },
  );

  it("survives a POST with no fields at all", async () => {
    const error = await signUpAction(new FormData()).catch((e) => e);
    expect(landed(error).path).toBe("/sign-up");
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("reports an address that is already taken", async () => {
    signUpEmail.mockRejectedValue(
      new APIError("BAD_REQUEST", { code: "USER_ALREADY_EXISTS" }),
    );

    const error = await signUpAction(form(good)).catch((e) => e);
    expect(landed(error).message).toMatch(/already in use/i);
    expect(landed(error).email).toBe("new@example.com");
  });
});

describe("/verify-email — the code form", () => {
  it("asks for the code, naming the address it went to", async () => {
    render(await VerifyEmailPage({ searchParams: search({}) }));

    expect(screen.getByLabelText("Confirmation code")).toBeDefined();
    expect(screen.getByText(/learner@example.com/)).toBeDefined();
  });

  it("uses the input hints that let a phone fill it in", async () => {
    // autocomplete="one-time-code" is what turns this from typing six digits
    // into one tap; type="text" because a number input strips a leading zero,
    // and one code in ten starts with one.
    render(await VerifyEmailPage({ searchParams: search({}) }));
    const input = screen.getByLabelText("Confirmation code") as HTMLInputElement;

    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.type).toBe("text");
    expect(input.maxLength).toBe(6);
  });

  it("offers another code, and says a new one replaces the old", async () => {
    render(await VerifyEmailPage({ searchParams: search({}) }));
    expect(screen.getByRole("button", { name: "Send a new code" })).toBeDefined();
    expect(screen.getByText(/replaces the first/i)).toBeDefined();
  });

  it("confirms that a new code went out", async () => {
    render(await VerifyEmailPage({ searchParams: search({ sent: "1" }) }));
    expect(screen.getByText("New code sent.")).toBeDefined();
  });

  it("shows a bad code as a sentence, not as an error code", async () => {
    render(await VerifyEmailPage({ searchParams: search({ error: "INVALID_OTP" }) }));
    expect(screen.getByRole("alert").textContent).toMatch(/code isn't right/i);
  });

  it("lets someone leave without confirming", async () => {
    // Verification is not required to sign in, so a screen with no way out
    // would be lying about that.
    const { container } = render(await VerifyEmailPage({ searchParams: search({}) }));
    expect(container.querySelector('a[href="/today"]')).not.toBeNull();
  });

  it("sends them on to what they came for once the address is confirmed", async () => {
    // The end of the chain. "Back to today" here is where the subject someone
    // signed up to have built would finally have been dropped.
    currentUserMock.mockResolvedValue({ ...UNVERIFIED, emailVerified: true });
    const { container } = render(
      await VerifyEmailPage({ searchParams: search({ next: TOPIC }) }),
    );

    expect(container.querySelector(`a[href="${TOPIC}"]`)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Carry on" })).toBeDefined();
  });

  it("carries the destination on the code form and the resend", async () => {
    const { container } = render(
      await VerifyEmailPage({ searchParams: search({ next: TOPIC }) }),
    );
    const carried = [
      ...container.querySelectorAll<HTMLInputElement>('input[name="next"]'),
    ];
    expect(carried).toHaveLength(2);
    for (const field of carried) expect(field.value).toBe(TOPIC);
  });

  it("points a signed-out arrival at sign-in, destination intact", async () => {
    currentUserMock.mockResolvedValue(null);
    const { container } = render(
      await VerifyEmailPage({
        searchParams: search({ error: "INVALID_TOKEN", next: TOPIC }),
      }),
    );
    expect(container.querySelector('a[href^="/sign-in?next="]')).not.toBeNull();
  });

  it("switches to the confirmed state once the address is verified", async () => {
    currentUserMock.mockResolvedValue({ ...UNVERIFIED, emailVerified: true });
    render(await VerifyEmailPage({ searchParams: search({}) }));

    expect(screen.getByText("Confirmed")).toBeDefined();
    expect(screen.queryByLabelText("Confirmation code")).toBeNull();
  });

  it("handles a code that was already spent", async () => {
    render(await VerifyEmailPage({ searchParams: search({ confirmed: "1" }) }));
    expect(screen.getByText(/that code was used/i)).toBeDefined();
  });

  it("tells a signed-out reader with a dead link to sign in", async () => {
    currentUserMock.mockResolvedValue(null);
    render(await VerifyEmailPage({ searchParams: search({ error: "TOKEN_EXPIRED" }) }));

    expect(screen.getByText(/that link has expired/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
  });

  it("falls back for a link error it has never heard of", async () => {
    currentUserMock.mockResolvedValue(null);
    render(await VerifyEmailPage({ searchParams: search({ error: "WAT" }) }));
    expect(screen.getByText(/couldn't confirm that address/i)).toBeDefined();
  });

  it("treats a signed-out arrival with no error as the link having worked", async () => {
    currentUserMock.mockResolvedValue(null);
    render(await VerifyEmailPage({ searchParams: search({}) }));
    expect(screen.getByText(/your address is confirmed/i)).toBeDefined();
  });
});

describe("verifyCodeAction", () => {
  it("verifies against the signed-in address, never one from the form", async () => {
    // No email field means no way to aim a code at an address that is not the
    // one being confirmed.
    await expect(verifyCodeAction(form({ code: "123456" }))).rejects.toThrow(
      "REDIRECT:/verify-email?confirmed=1",
    );

    expect(verifyEmailOTP).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: { email: "learner@example.com", otp: "123456" },
    });
  });

  it("accepts a code pasted with spaces or hyphens", async () => {
    await verifyCodeAction(form({ code: " 123 456 " })).catch(() => {});
    expect(verifyEmailOTP).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: { email: "learner@example.com", otp: "123456" },
    });
  });

  it("checks the length before spending a round trip", async () => {
    const error = await verifyCodeAction(form({ code: "123" })).catch((e) => e);
    expect(landed(error).message).toMatch(/6 digits/);
    expect(verifyEmailOTP).not.toHaveBeenCalled();
  });

  it("survives a POST with no code", async () => {
    const error = await verifyCodeAction(new FormData()).catch((e) => e);
    expect(landed(error).message).toMatch(/6 digits/);
  });

  it.each([
    ["INVALID_OTP", /code isn't right/i],
    ["OTP_EXPIRED", /code has expired/i],
    ["TOO_MANY_ATTEMPTS", /too many tries/i],
  ])("turns %s into something a person can act on", async (code, expected) => {
    verifyEmailOTP.mockRejectedValue(new APIError("BAD_REQUEST", { code }));

    const error = await verifyCodeAction(form({ code: "123456" })).catch((e) => e);
    expect(landed(error).message).toMatch(expected);
  });

  it("requires a session", async () => {
    requireUserMock.mockRejectedValue(new Error("REDIRECT:/sign-in"));
    await expect(verifyCodeAction(form({ code: "123456" }))).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    expect(verifyEmailOTP).not.toHaveBeenCalled();
  });

  it("keeps the destination on the way out, and on a wrong code", async () => {
    const done = await verifyCodeAction(
      form({ code: "123456", next: TOPIC }),
    ).catch((e) => e);
    expect(landed(done).next).toBe(TOPIC);

    const wrong = await verifyCodeAction(
      form({ code: "123", next: TOPIC }),
    ).catch((e) => e);
    expect(landed(wrong).next).toBe(TOPIC);
  });
});

describe("sendCodeAction", () => {
  it("sends a fresh code for the signed-in address", async () => {
    await expect(sendCodeAction()).rejects.toThrow(
      "REDIRECT:/verify-email?sent=1",
    );

    expect(sendVerificationOTP).toHaveBeenCalledWith({
      headers: expect.anything(),
      body: { email: "learner@example.com", type: "email-verification" },
    });
  });

  it("reports a failure to send", async () => {
    sendVerificationOTP.mockRejectedValue(new Error("resend is down"));
    const error = await sendCodeAction().catch((e) => e);
    expect(landed(error).message).toMatch(/couldn't send a new code/i);
  });

  it("keeps the destination across asking for another code", async () => {
    // Waiting on a second code is the longest anyone sits on this screen, and
    // it is the hop most easily forgotten.
    const error = await sendCodeAction(form({ next: TOPIC })).catch((e) => e);
    expect(landed(error).path).toBe("/verify-email");
    expect(landed(error).next).toBe(TOPIC);
  });
});
