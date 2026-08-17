// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The banner, and the decision behind it.
 *
 * The tests worth having are the ones that pin the promises this feature makes
 * out loud: that nothing is asked for where nothing would be set, that the two
 * answers are offered with equal weight, and that PostHog is handed the answer
 * rather than deciding for itself. Each of those is a sentence on `/privacy`
 * that would otherwise be a sentence nobody was checking.
 */

const consentValue = vi.fn<() => string | undefined>(() => undefined);
const currentUserMock = vi.fn<() => Promise<{ id: string } | null>>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "mk_consent" && consentValue() !== undefined
        ? { value: consentValue() }
        : undefined,
  }),
}));

vi.mock("@/lib/account/session", () => ({
  currentUser: () => currentUserMock(),
}));

vi.mock("@/lib/consent/actions", () => ({
  setConsentAction: vi.fn(),
}));

const { Analytics, ConsentChoices, analyticsContext, readConsent } =
  await import("@/components/analytics");

/** The banner and the loader together, as a layout renders them. */
async function renderAnalytics() {
  return render(<Analytics context={await analyticsContext()} />);
}

beforeEach(() => {
  consentValue.mockReset();
  consentValue.mockReturnValue(undefined);
  currentUserMock.mockReset();
  currentUserMock.mockResolvedValue(null);
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
  process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://ph.test";
});

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
});

describe("readConsent", () => {
  it("reads the answer, and reports an unanswered question as unanswered", async () => {
    expect(await readConsent()).toBeUndefined();
    consentValue.mockReturnValue("granted");
    expect(await readConsent()).toBe("granted");
    consentValue.mockReturnValue("nonsense");
    expect(await readConsent()).toBeUndefined();
  });
});

describe("the banner", () => {
  it("asks once, and not again after either answer", async () => {
    await renderAnalytics();
    expect(screen.getByRole("region", { name: "Cookies" })).toBeDefined();

    for (const answer of ["granted", "denied"]) {
      cleanup();
      consentValue.mockReturnValue(answer);
      await renderAnalytics();
      expect(
        screen.queryByRole("region", { name: "Cookies" }),
        `${answer} still asks`,
      ).toBeNull();
    }
  });

  /**
   * Nobody should be asked to permit a cookie that will not be set. With no key
   * configured — every deploy until a PostHog project exists — there is nothing
   * to consent to, so there is no question.
   */
  it("does not appear where there is nothing to consent to", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { container } = await renderAnalytics();
    expect(container.innerHTML).toBe("");
  });

  /**
   * A prompt whose "yes" is a filled button and whose "no" is a grey link has
   * answered itself. Both are the same `social` variant, so neither carries the
   * accent fill — which is also §8.5.5's rule about one primary per screen.
   */
  it("offers both answers with the same weight", async () => {
    await renderAnalytics();
    const allow = screen.getByRole("button", { name: "Allow" });
    const refuse = screen.getByRole("button", { name: "No thanks" });
    expect(allow.className).toBe(refuse.className);
    expect(allow.getAttribute("value")).toBe("granted");
    expect(refuse.getAttribute("value")).toBe("denied");
  });

  /** §8.5.8 — these pages ship no framework JS, so both buttons must be a POST. */
  it("works without JavaScript", async () => {
    const { container } = await renderAnalytics();
    expect(container.querySelector("form")).not.toBeNull();
    for (const button of container.querySelectorAll("button")) {
      expect(button.getAttribute("type")).toBe("submit");
      expect(button.getAttribute("name")).toBe("consent");
    }
  });

  /** §13.3 budgets CLS at 0.05; a bar that pushes the fold down spends all of it. */
  it("does not reflow the page it lands on", async () => {
    await renderAnalytics();
    expect(
      screen.getByRole("region", { name: "Cookies" }).className,
    ).toContain("fixed");
  });

  it("links the page that explains it", async () => {
    await renderAnalytics();
    expect(
      screen.getByRole("link", { name: "The detail" }).getAttribute("href"),
    ).toBe("/privacy");
  });

  it("names the replay rather than burying it", async () => {
    await renderAnalytics();
    // The most invasive thing being asked for is the thing most easily left to
    // a privacy page nobody opens.
    const banner = screen.getByRole("region", { name: "Cookies" });
    expect(banner.textContent).toContain("replay");
    expect(banner.textContent).toContain("Nothing you type is recorded");
  });
});

describe("the choices, wherever they are shown", () => {
  it("marks which answer is the current one", () => {
    render(<ConsentChoices current="denied" />);
    expect(
      screen.getByRole("button", { name: "No thanks" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Allow" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("marks neither when nothing has been decided", () => {
    render(<ConsentChoices />);
    for (const name of ["Allow", "No thanks"]) {
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-pressed"),
      ).toBe("false");
    }
  });
});

describe("the context a layout reads", () => {
  /**
   * With no key, nothing else is even read — no cookie, no session. The banner
   * and the bundle both hang off this one fact.
   */
  it("reads nothing at all when no key is configured", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    expect(await analyticsContext()).toEqual({
      key: undefined,
      consent: undefined,
      userId: undefined,
    });
    expect(consentValue).not.toHaveBeenCalled();
    expect(currentUserMock).not.toHaveBeenCalled();
  });

  it("carries the answer and the learner it belongs to", async () => {
    consentValue.mockReturnValue("granted");
    currentUserMock.mockResolvedValue({ id: "u1" });
    expect(await analyticsContext()).toEqual({
      key: "phc_test",
      consent: "granted",
      userId: "u1",
    });
  });

  /** Consent first, identity after — we do not look you up to not-measure you. */
  it("does not look the learner up for a visitor who has not agreed", async () => {
    consentValue.mockReturnValue("denied");
    const context = await analyticsContext();
    expect(currentUserMock).not.toHaveBeenCalled();
    expect(context.userId).toBeUndefined();
  });

  it("carries no learner for a consenting visitor who is signed out", async () => {
    consentValue.mockReturnValue("granted");
    expect((await analyticsContext()).userId).toBeUndefined();
  });
});

describe("loading PostHog", () => {
  it("renders nothing at all when no key is configured", () => {
    const { container } = render(
      <Analytics
        context={{ key: undefined, consent: "granted", userId: "u1" }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  /**
   * The client component decides nothing for itself: it is told the answer.
   * One place decides whether analytics runs, and it is the server.
   */
  it("hands the client the answer rather than letting it read the cookie", async () => {
    consentValue.mockReturnValue("granted");
    currentUserMock.mockResolvedValue({ id: "u1" });

    const tree = Analytics({
      context: await analyticsContext(),
    }) as React.ReactElement<{ children: React.ReactElement[] }>;
    const [client] = tree.props.children as [
      React.ReactElement<{
        consent: string | undefined;
        apiKey: string;
        apiHost: string;
        userId: string | undefined;
      }>,
    ];

    expect(client.props).toMatchObject({
      consent: "granted",
      apiKey: "phc_test",
      apiHost: "https://ph.test",
      userId: "u1",
    });
  });
});
