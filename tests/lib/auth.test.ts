import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authBaseUrl,
  createAuth,
  getAuth,
  googleEnabled,
  OTP_ATTEMPTS,
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  RESET_TTL_SECONDS,
  resetAuth,
  sendSignUpCode,
  VERIFICATION_TTL_SECONDS,
} from "@/lib/auth";
import { MemoryTransport, setTransport } from "@/lib/email";
import { dark, light } from "@/lib/theme";

/**
 * Thin-adapter tests. They cannot prove Better Auth works — that is the
 * library's job — but they do pin the things that are *our* decisions and would
 * be silent if wrong: which extra columns the session carries, which of the
 * email flows are armed, what each of them actually puts in someone's inbox,
 * and that importing this module never opens a database connection.
 */

const ORIGINAL = process.env.DATABASE_URL;
const transport = new MemoryTransport();

/** A stand-in for the `User` Better Auth hands the send callbacks. */
const user = {
  id: "u1",
  email: "learner@example.com",
  name: "Learner",
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Parameters<
  NonNullable<
    NonNullable<ReturnType<typeof createAuth>["options"]["emailAndPassword"]>["sendResetPassword"]
  >
>[0]["user"];

beforeEach(() => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:1/none";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-value-at-least-32-chars-long";
  transport.clear();
  setTransport(transport);
  resetAuth();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL;
  setTransport(undefined);
  resetAuth();
  vi.restoreAllMocks();
});

describe("createAuth", () => {
  it("builds an instance with the handler the route needs", () => {
    const auth = createAuth();
    expect(typeof auth.handler).toBe("function");
    expect(auth.api).toBeDefined();
  });

  it("enables email and password sign-in", () => {
    expect(createAuth().options.emailAndPassword?.enabled).toBe(true);
  });

  it("sends verification without standing in the way of the first session", () => {
    // §8 is "show value first": the screen after signup is the plan, and an
    // inbox round-trip in the middle of that is where people leave. So mail
    // goes out, and nothing blocks on it.
    expect(
      createAuth().options.emailAndPassword?.requireEmailVerification,
    ).toBe(false);
  });

  it("confirms sign-up with a code, and does not also send a link", () => {
    // The OTP plugin's own post-sign-up hook sends the code. Leaving
    // `sendOnSignUp` true as well would send two emails for one address.
    const options = createAuth().options;
    expect(options.emailVerification?.sendOnSignUp).toBe(false);

    const otp = options.plugins?.find((plugin) => plugin.id === "email-otp");
    expect(otp).toBeDefined();
  });

  it("signs the learner in on the device where they clicked the link", () => {
    expect(createAuth().options.emailVerification?.autoSignInAfterVerification).toBe(
      true,
    );
  });

  it("gives a reset link one hour and a verification link a day", () => {
    // A reset link *is* the account while it is valid, and it sits in a mailbox
    // someone else may later read.
    const options = createAuth().options;
    expect(options.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(
      RESET_TTL_SECONDS,
    );
    expect(options.emailVerification?.expiresIn).toBe(VERIFICATION_TTL_SECONDS);
    expect(RESET_TTL_SECONDS).toBeLessThan(VERIFICATION_TTL_SECONDS);
  });

  it("ends every other session when a password is reset", () => {
    // Better Auth defaults this off, which leaves the thief signed in on their
    // own machine while the owner congratulates themselves on a new password.
    expect(
      createAuth().options.emailAndPassword?.revokeSessionsOnPasswordReset,
    ).toBe(true);
  });

  it("carries the §15 User columns as additional fields", () => {
    const fields = createAuth().options.user?.additionalFields ?? {};
    expect(Object.keys(fields).sort()).toEqual([
      "handle",
      "locale",
      "plan",
      "role",
      "stripeCustomerId",
      "theme",
      "timezone",
    ]);
  });

  it("defaults locale, timezone, theme and plan rather than leaving them null", () => {
    const fields = createAuth().options.user?.additionalFields ?? {};
    expect(fields.locale?.defaultValue).toBe("en");
    expect(fields.timezone?.defaultValue).toBe("UTC");
    expect(fields.theme?.defaultValue).toBe("system");
    expect(fields.plan?.defaultValue).toBe("free");
  });

  it("does not let a sign-up payload set the theme", () => {
    // Same reason `role` and `plan` are closed: the column is read by the email
    // renderer, which has a palette for exactly three values. `input: false`
    // keeps a request body from putting a fourth in it.
    const fields = createAuth().options.user?.additionalFields ?? {};
    expect(fields.theme?.input).toBe(false);
  });

  it("refuses client input on the fields that grant access or cost money", () => {
    // Without `input: false`, sign-up with {"role":"admin"} promotes the caller.
    const fields = createAuth().options.user?.additionalFields ?? {};
    expect(fields.role?.input).toBe(false);
    expect(fields.plan?.input).toBe(false);
    expect(fields.stripeCustomerId?.input).toBe(false);
    // handle declares no `input`, so it stays writable by its owner.
    expect("input" in (fields.handle ?? {})).toBe(false);
  });

  it("sets a 30-day session with daily refresh", () => {
    const session = createAuth().options.session;
    expect(session?.expiresIn).toBe(60 * 60 * 24 * 30);
    expect(session?.updateAge).toBe(60 * 60 * 24);
  });

  it("gives the sign-up code six digits, ten minutes and three tries", () => {
    // Ten minutes rather than Better Auth's five: the person is switching to
    // another device to read it. Three tries because a six-digit code has a
    // million values and unlimited guesses turn that into a walkable number.
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_TTL_SECONDS).toBe(600);
    expect(OTP_ATTEMPTS).toBe(3);
  });

  it("keeps nextCookies last so server actions can set the session cookie", () => {
    // Sign-out and every form on /account run as Server Actions; without this
    // plugin `auth.api.*` cannot touch cookies and sign-out silently no-ops.
    const plugins = createAuth().options.plugins ?? [];
    expect(plugins.at(-1)?.id).toBe("next-cookies");
  });
});

describe("account linking", () => {
  it("trusts Google's verified address, but not an unverified local one", () => {
    // Without requireLocalEmailVerified, anyone can register victim@gmail.com
    // with a password, never verify it, and wait for the real owner to sign in
    // with Google — at which point the accounts link and the attacker's
    // password still works.
    const linking = createAuth().options.account?.accountLinking;
    expect(linking?.enabled).toBe(true);
    expect(linking?.trustedProviders).toEqual(["google"]);
    expect(linking?.requireLocalEmailVerified).toBe(true);
  });
});

describe("google", () => {
  it("is off until both halves of the credential are present", () => {
    expect(googleEnabled({})).toBe(false);
    expect(googleEnabled({ GOOGLE_CLIENT_ID: "id" })).toBe(false);
    expect(googleEnabled({ GOOGLE_CLIENT_SECRET: "secret" })).toBe(false);
    expect(
      googleEnabled({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).toBe(true);
  });

  it("registers no provider at all when unconfigured", () => {
    // A provider with a blank client id fails at Google's redirect with an
    // opaque error page — worse than a sign-in screen that doesn't offer it.
    expect(createAuth({}).options.socialProviders).toEqual({});
  });

  it("registers Google with the account picker when configured", () => {
    const providers = createAuth({
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    }).options.socialProviders;

    expect(providers?.google?.clientId).toBe("id");
    expect(providers?.google?.clientSecret).toBe("secret");
    // Someone who picked the wrong Google account has no way back if Google
    // silently reuses its own session.
    expect(providers?.google?.prompt).toBe("select_account");
  });
});

describe("authBaseUrl", () => {
  it("prefers BETTER_AUTH_URL, without a trailing slash", () => {
    expect(authBaseUrl({ BETTER_AUTH_URL: "https://auth.test/" })).toBe(
      "https://auth.test",
    );
  });

  it("falls through to the canonical site origin", () => {
    // These strings end up in emails that cannot be edited after sending, so
    // there is exactly one place the origin comes from.
    expect(authBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://online.uni" })).toBe(
      "https://online.uni",
    );
    expect(authBaseUrl({})).toBe("http://localhost:3000");
  });

  it("is what the instance builds its links against", () => {
    expect(createAuth({ BETTER_AUTH_URL: "https://auth.test" }).options.baseURL).toBe(
      "https://auth.test",
    );
  });
});

describe("what actually lands in the inbox", () => {
  const options = () => createAuth().options;

  it("sends the reset link to the address that asked for it", async () => {
    await options().emailAndPassword!.sendResetPassword!({
      user,
      url: "https://x.test/reset?token=t",
      token: "t",
    });

    const [sent] = transport.sent;
    expect(sent?.to).toBe("learner@example.com");
    expect(sent?.subject).toMatch(/reset your password/i);
    expect(sent?.text).toContain("https://x.test/reset?token=t");
    expect(sent?.text).toContain("1 hour");
  });

  it("sends the verification link with the day-long expiry it was given", async () => {
    await options().emailVerification!.sendVerificationEmail!({
      user,
      url: "https://x.test/verify?token=t",
      token: "t",
    });

    const [sent] = transport.sent;
    expect(sent?.subject).toMatch(/confirm your email/i);
    expect(sent?.text).toContain("24 hours");
  });

  it("sends the sign-up code with no link in it", async () => {
    await sendSignUpCode({ email: "learner@example.com", otp: "123456" });

    const [sent] = transport.sent;
    expect(sent?.to).toBe("learner@example.com");
    expect(sent?.text).toContain("123456");
    // The code never leaves the flow the person is already in, and a mail with
    // no URL cannot be re-pointed somewhere else and still look like ours.
    expect(sent?.text).not.toMatch(/https?:\/\//);
  });

  it("mails the change-email approval to the old address, naming the new one", async () => {
    // The address being left behind is the one that gets to approve the move.
    // That is what stops a stolen session relocating the account quietly.
    await options().user!.changeEmail!.sendChangeEmailConfirmation!({
      user,
      newEmail: "new@example.com",
      url: "https://x.test/verify?token=t",
      token: "t",
    });

    const [sent] = transport.sent;
    expect(sent?.to).toBe("learner@example.com");
    expect(sent?.text).toContain("new@example.com");
  });

  it("paints the mail in the theme on the account, not the requester's", async () => {
    // A reset can be asked for from a machine the account holder is not
    // sitting at, so the browser making the request is the last thing that
    // should pick the palette. It comes off the row instead.
    // Cast because Better Auth's callback type does not declare the
    // `additionalFields` columns, even though they are on the object at
    // runtime. That gap is the whole reason `themeOf` reads defensively.
    await options().emailAndPassword!.sendResetPassword!({
      user: { ...user, theme: "dark" } as unknown as typeof user,
      url: "https://x.test/reset?token=t",
      token: "t",
    });

    expect(transport.sent[0]?.html).toContain(`background:${dark.ground}`);
  });

  it("leaves an untouched account on System, which the client resolves", async () => {
    await options().emailVerification!.sendVerificationEmail!({
      user,
      url: "https://x.test/verify?token=t",
      token: "t",
    });

    const html = transport.sent[0]?.html ?? "";
    expect(html).toContain("@media (prefers-color-scheme:dark)");
    expect(html).toContain(`background:${light.ground}`);
  });

  it("does not fail the auth flow when the mail cannot be sent", async () => {
    // A sign-up that 500s because the mail provider is down leaves someone with
    // no account and no explanation.
    vi.spyOn(console, "error").mockImplementation(() => {});
    setTransport({
      name: "broken",
      send: () => Promise.reject(new Error("down")),
    });

    await expect(
      options().emailVerification!.sendVerificationEmail!({
        user,
        url: "https://x.test/v",
        token: "t",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("changing an email address", () => {
  it("is enabled", () => {
    expect(createAuth().options.user?.changeEmail?.enabled).toBe(true);
  });
});

describe("getAuth", () => {
  it("caches the instance", () => {
    expect(getAuth()).toBe(getAuth());
  });

  it("rebuilds after a reset", () => {
    const first = getAuth();
    resetAuth();
    expect(getAuth()).not.toBe(first);
  });
});

describe("the referral attribution hook (§9.1)", () => {
  it("runs after a user is created, on every sign-up route", () => {
    // Not in the sign-up action: that handles email sign-up only, so a Google
    // sign-in would never pass through it and every social referral would be
    // lost silently. One hook catches both.
    const after = createAuth().options.databaseHooks?.user?.create?.after;
    expect(after).toBeTypeOf("function");
  });

  it("delegates to `attributeSignup` and never rejects", async () => {
    // The body lives in `@/lib/referral/signup` so it can be tested without
    // standing up an auth instance; what is asserted here is the wiring, and
    // that a hook failure cannot fail a sign-up.
    const after = createAuth().options.databaseHooks!.user!.create!.after!;

    await expect(
      after({
        id: "auth-hook-user",
        email: "nobody@auth-hook.local",
      } as never),
    ).resolves.toBeUndefined();
  });
});
