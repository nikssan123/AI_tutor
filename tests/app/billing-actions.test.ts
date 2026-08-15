import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The billing and checkout actions.
 *
 * A Server Action is a public POST endpoint however the button that calls it
 * looked, so the refusals matter more than the happy paths: a cancellation with
 * no reason, a checkout for a plan nobody sells, a portal for an account that
 * has never paid.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const requireUserMock = vi.fn();
const subscriptionMock = vi.fn();
const surveyMock = vi.fn(async (..._args: unknown[]) => undefined);
const checkoutMock = vi.fn(
  async (..._args: unknown[]) => ({ id: "cs_1", url: null as string | null }),
);
const portalMock = vi.fn(async (..._args: unknown[]) => ({
  url: "https://portal.test/x",
}));
const stripePostMock = vi.fn(async (..._args: unknown[]) => ({}));
const usedTrialMock = vi.fn(async (..._args: unknown[]) => false);
const captureMock = vi.fn();
const cookieStore = { value: undefined as string | undefined };

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "mk_currency" && cookieStore.value
        ? { name, value: cookieStore.value }
        : undefined,
    set: () => undefined,
  }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/lib/account/session", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/lib/billing/store", () => ({
  latestSubscription: (...a: unknown[]) => subscriptionMock(...(a as [])),
  recordCancellationSurvey: (...a: unknown[]) => surveyMock(...(a as [])),
  hasUsedTrial: (...a: unknown[]) => usedTrialMock(...(a as [])),
}));
vi.mock("@/lib/billing/stripe/checkout", () => ({
  createCheckoutSession: (...a: unknown[]) => checkoutMock(...(a as [])),
  createPortalSession: (...a: unknown[]) => portalMock(...(a as [])),
}));
vi.mock("@/lib/billing/stripe/client", () => ({
  getStripe: () => ({ post: stripePostMock }),
}));
vi.mock("@/lib/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability")>()),
  capture: (...a: unknown[]) => captureMock(...(a as [])),
}));

const { startCheckoutAction, setCurrencyAction } = await import(
  "@/app/(marketing)/pricing/actions"
);
const {
  cancelSubscriptionAction,
  openPortalAction,
  resumeSubscriptionAction,
} = await import("@/app/(app)/account/billing/actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const SUBSCRIPTION = {
  id: "sub-row",
  stripeSubscriptionId: "sub_1",
  stripeCustomerId: "cus_1",
  planId: "pro",
  currency: "eur",
};

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.value = undefined;
  getSessionMock.mockResolvedValue({
    user: { id: "u1", email: "a@b.test", locale: "en" },
  });
  requireUserMock.mockResolvedValue({ id: "u1", plan: "pro" });
  subscriptionMock.mockResolvedValue(SUBSCRIPTION);
  usedTrialMock.mockResolvedValue(false);
  checkoutMock.mockResolvedValue({ id: "cs_1", url: "https://pay.test/x" });
});

describe("setCurrencyAction", () => {
  it("returns to pricing after a valid choice", async () => {
    await expect(setCurrencyAction(form({ currency: "eur" }))).rejects.toThrow(
      "REDIRECT:/pricing",
    );
  });

  it("ignores a currency we do not sell in", async () => {
    await expect(setCurrencyAction(form({ currency: "gbp" }))).rejects.toThrow(
      "REDIRECT:/pricing",
    );
  });

  it("comes back to the view the reader was looking at", async () => {
    // Currency is a cookie and the billing interval is in the URL, so a bare
    // `/pricing` answered "I want euros" by also undoing "I want to see the
    // year". Both the accepted and the refused path have to carry it.
    await expect(
      setCurrencyAction(form({ currency: "eur", interval: "year" })),
    ).rejects.toThrow("REDIRECT:/pricing?interval=year");

    await expect(
      setCurrencyAction(form({ currency: "gbp", interval: "year" })),
    ).rejects.toThrow("REDIRECT:/pricing?interval=year");
  });

  it("ignores an interval it does not recognise", async () => {
    await expect(
      setCurrencyAction(form({ currency: "eur", interval: "decade" })),
    ).rejects.toThrow("REDIRECT:/pricing");
  });

  it("ignores a form with no currency field at all", async () => {
    // `formData.get` returns null, not "", when the field is absent.
    await expect(setCurrencyAction(form({}))).rejects.toThrow(
      "REDIRECT:/pricing",
    );
  });
});

describe("startCheckoutAction", () => {
  it("sends a signed-in learner to Stripe", async () => {
    await expect(
      startCheckoutAction(form({ plan: "pro", interval: "month" })),
    ).rejects.toThrow("REDIRECT:https://pay.test/x");

    expect(checkoutMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      planId: "pro",
      interval: "month",
      customerId: "cus_1",
    });
  });

  it("carries the chosen plan through sign-up", async () => {
    // Otherwise somebody who clicked "Try Pro" lands on /today having
    // forgotten why they came.
    getSessionMock.mockResolvedValue(null);
    await expect(
      startCheckoutAction(form({ plan: "trial" })),
    ).rejects.toThrow("REDIRECT:/sign-up?next=%2Fpricing%3Fplan%3Dtrial");
  });

  it("defaults to monthly when the form did not say", async () => {
    await expect(startCheckoutAction(form({ plan: "pro" }))).rejects.toThrow(
      /REDIRECT:https/,
    );
    expect(checkoutMock.mock.calls[0]![1]).toMatchObject({ interval: "month" });
  });

  it("refuses a form with no plan field at all", async () => {
    await expect(startCheckoutAction(form({}))).rejects.toThrow(
      "REDIRECT:/pricing",
    );
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("buys a year when asked for one", async () => {
    await expect(
      startCheckoutAction(form({ plan: "pro", interval: "year" })),
    ).rejects.toThrow(/REDIRECT:https/);
    expect(checkoutMock.mock.calls[0]![1]).toMatchObject({ interval: "year" });
  });

  it("refuses a second trial on the same account", async () => {
    // A €3 trial that can be retaken is not a trial, it is a price: cancel on
    // day 3, subscribe again, and hold Pro indefinitely at €3 per four days.
    usedTrialMock.mockResolvedValue(true);

    await expect(startCheckoutAction(form({ plan: "trial" }))).rejects.toThrow(
      "REDIRECT:/pricing?error=trial-used",
    );
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("still sells Pro to somebody who has had the trial", async () => {
    usedTrialMock.mockResolvedValue(true);
    await expect(startCheckoutAction(form({ plan: "pro" }))).rejects.toThrow(
      /REDIRECT:https/,
    );
  });

  it("refuses a plan nobody sells", async () => {
    await expect(startCheckoutAction(form({ plan: "free" }))).rejects.toThrow(
      "REDIRECT:/pricing",
    );
    await expect(
      startCheckoutAction(form({ plan: "enterprise" })),
    ).rejects.toThrow("REDIRECT:/pricing");
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("follows the currency cookie", async () => {
    cookieStore.value = "eur";
    await expect(startCheckoutAction(form({ plan: "pro" }))).rejects.toThrow(
      /REDIRECT:https/,
    );
    expect(checkoutMock.mock.calls[0]![1]).toMatchObject({ currency: "eur" });
  });

  it("treats anything but 'year' as monthly", async () => {
    await expect(
      startCheckoutAction(form({ plan: "pro", interval: "fortnight" })),
    ).rejects.toThrow(/REDIRECT:https/);
    expect(checkoutMock.mock.calls[0]![1]).toMatchObject({ interval: "month" });
  });

  it("starts a fresh customer when there is no subscription yet", async () => {
    subscriptionMock.mockResolvedValue(undefined);
    await expect(startCheckoutAction(form({ plan: "pro" }))).rejects.toThrow(
      /REDIRECT:https/,
    );
    expect(checkoutMock.mock.calls[0]![1]).toMatchObject({
      customerId: null,
      email: "a@b.test",
    });
  });

  it("records the intent before leaving the site", async () => {
    await expect(startCheckoutAction(form({ plan: "pro" }))).rejects.toThrow(
      /REDIRECT:https/,
    );
    expect(captureMock).toHaveBeenCalledWith("checkout_started", {
      plan: "pro",
      interval: "month",
      currency: "usd",
    });
  });

  it("says so rather than redirecting nowhere when Stripe hosts no session", async () => {
    checkoutMock.mockResolvedValue({ id: "cs_1", url: null });
    await expect(startCheckoutAction(form({ plan: "pro" }))).rejects.toThrow(
      "REDIRECT:/pricing?error=checkout",
    );
  });
});

describe("cancelSubscriptionAction", () => {
  it("cancels at the end of the period, never immediately", async () => {
    await expect(
      cancelSubscriptionAction(form({ reason: "too_expensive" })),
    ).rejects.toThrow(/REDIRECT:\/account\/billing\?ok=/);

    expect(stripePostMock).toHaveBeenCalledWith(
      "/subscriptions/sub_1",
      { cancel_at_period_end: true },
      "cancel:sub_1",
    );
  });

  it("refuses without a reason", async () => {
    // §25.1 puts "mandatory" in bold, and this is the only structured churn
    // signal the product will ever get.
    await expect(cancelSubscriptionAction(form({}))).rejects.toThrow(
      /REDIRECT:\/account\/billing\?error=/,
    );
    expect(stripePostMock).not.toHaveBeenCalled();
    expect(surveyMock).not.toHaveBeenCalled();
  });

  it("refuses a reason that is not on the list", async () => {
    await expect(
      cancelSubscriptionAction(form({ reason: "bored" })),
    ).rejects.toThrow(/error=/);
    expect(surveyMock).not.toHaveBeenCalled();
  });

  it("keeps the comment when there is one, and null when there is not", async () => {
    await expect(
      cancelSubscriptionAction(
        form({ reason: "ai_quality", comment: "  the marking felt harsh  " }),
      ),
    ).rejects.toThrow(/ok=/);
    expect(surveyMock.mock.calls[0]![1]).toMatchObject({
      reason: "ai_quality",
      comment: "the marking felt harsh",
    });

    vi.clearAllMocks();
    subscriptionMock.mockResolvedValue(SUBSCRIPTION);
    await expect(
      cancelSubscriptionAction(form({ reason: "other", comment: "   " })),
    ).rejects.toThrow(/ok=/);
    expect(surveyMock.mock.calls[0]![1]).toMatchObject({ comment: null });
  });

  it("has nothing to cancel without a subscription", async () => {
    subscriptionMock.mockResolvedValue(undefined);
    await expect(
      cancelSubscriptionAction(form({ reason: "other" })),
    ).rejects.toThrow(/error=/);
  });
});

describe("resumeSubscriptionAction", () => {
  it("undoes a cancellation that has not taken effect", async () => {
    await expect(resumeSubscriptionAction()).rejects.toThrow(/ok=/);
    expect(stripePostMock).toHaveBeenCalledWith(
      "/subscriptions/sub_1",
      { cancel_at_period_end: false },
      "resume:sub_1",
    );
    expect(captureMock).toHaveBeenCalledWith("subscription_reactivated", {
      plan: "pro",
    });
  });

  it("has nothing to resume without a subscription", async () => {
    subscriptionMock.mockResolvedValue(undefined);
    await expect(resumeSubscriptionAction()).rejects.toThrow(/error=/);
  });
});

describe("openPortalAction", () => {
  it("hands off to Stripe", async () => {
    await expect(openPortalAction()).rejects.toThrow(
      "REDIRECT:https://portal.test/x",
    );
    expect(portalMock.mock.calls[0]![1]).toBe("cus_1");
  });

  it("has nothing to manage without a subscription", async () => {
    subscriptionMock.mockResolvedValue(undefined);
    await expect(openPortalAction()).rejects.toThrow(/error=/);
  });
});
