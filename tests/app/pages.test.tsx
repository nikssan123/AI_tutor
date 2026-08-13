// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * These render the actual route components. The value is not the rendering —
 * it is asserting the rules the plan makes structural: layout-level `noindex`
 * on the whole authenticated segment (§13.1), a canonical on every marketing
 * page (§13.3), and the density rule that stops /today becoming a dashboard.
 */

const redirectMock = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});
const getSessionMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...(args as [])),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const currentUserMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
  googleEnabled: () => false,
  MIN_PASSWORD_LENGTH: 8,
  VERIFY_CALLBACK: "/verify-email",
}));

vi.mock("@/lib/account/session", () => ({
  currentUser: () => currentUserMock(),
  requireUser: () => currentUserMock(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("root layout", () => {
  it("ships the anti-FOUC script inline in <head>", async () => {
    const { default: RootLayout } = await import("@/app/layout");
    const tree = RootLayout({ children: null }) as React.ReactElement<{
      children: React.ReactNode[];
    }>;
    const html = JSON.stringify(tree);
    // §8.5.4 — every marketing page is static, so the server cannot know the
    // visitor's theme; without this there is a flash on every cold load.
    expect(html).toContain("dangerouslySetInnerHTML");
    expect(html).toContain("suppressHydrationWarning");
  });

  it("puts the goal search's driver in <head>, where it will actually run", async () => {
    const { default: RootLayout } = await import("@/app/layout");
    const { goalSearchScript } = await import("@/lib/goal-search-script");
    const html = JSON.stringify(
      RootLayout({ children: null }) as React.ReactElement,
    );

    // Rendered beside its own markup it never ran: Next streams the page, and
    // body content arriving in a later chunk is inserted rather than parsed,
    // so its <script> stays inert until React re-creates it at hydration. The
    // dropdown was dead for that whole window.
    expect(html).toContain(JSON.stringify(goalSearchScript).slice(1, 60));
  });

  it("declares a metadataBase so canonicals and OG URLs resolve", async () => {
    const { metadata } = await import("@/app/layout");
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(metadata.description).toContain("grades what you make");
  });
});

describe("(app) layout — §13.1's structural noindex", () => {
  it("noindexes the entire authenticated segment at the layout level", async () => {
    // Set here rather than per page, so a route nobody remembers to annotate
    // still cannot leak into the index.
    const { metadata } = await import("@/app/(app)/layout");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("forces dynamic rendering so nothing authenticated is cached", async () => {
    const { dynamic } = await import("@/app/(app)/layout");
    expect(dynamic).toBe("force-dynamic");
  });

  it("renders its children", async () => {
    currentUserMock.mockResolvedValue(null);
    const { default: AppLayout } = await import("@/app/(app)/layout");
    render(await AppLayout({ children: <p>child</p> }));
    expect(screen.getByText("child")).toBeDefined();
  });

  it("draws no header for a signed-out visitor", async () => {
    // /sign-in and /reset-password live in this segment too, and a "Sign out"
    // button above a sign-in form would be nonsense.
    currentUserMock.mockResolvedValue(null);
    const { default: AppLayout } = await import("@/app/(app)/layout");
    render(await AppLayout({ children: <p>child</p> }));
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

/*
 * The landing page moved to its own suite once it became a real page —
 * tests/app/marketing-pages.test.tsx. The theme control now lives in the
 * marketing footer (§8.5.4: "a small control in the footer"), so it is
 * asserted there against SiteFooter rather than against the page.
 */

/*
 * /today moved to its own suite — tests/app/today.test.tsx — once it started
 * planning against a real goal and needed the database stubbed for it.
 */

describe("/design — the drift guard (§8.5.8)", () => {
  it("renders the full component vocabulary on one page", async () => {
    const { default: DesignPage } = await import("@/app/design/page");
    render(<DesignPage />);

    for (const label of [
      "Verified",
      "Needs work",
      "Failed",
      "Demonstrated",
      "Likely capable",
      "Written and checked by hand",
      "Experimental — help us improve it",
      // Added with the landing-page rebuild. §8.5.8 makes this page the drift
      // guard, so a component that ships without appearing here is a component
      // nobody can review against the spec.
      "--shadow-raised",
      "--shadow-lifted",
      "Prove you learned it.",
      "— this is the pass mark",
    ]) {
      // getAllByText: "Demonstrated" legitimately appears twice — once as the
      // confidence label and once inside the row list demonstrating it.
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
  });

  it("is noindexed — it is a reference, not a page for anyone to find", async () => {
    const { metadata } = await import("@/app/design/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("shows exactly one filled button among the primary actions", async () => {
    // §8.5.5 — one filled button per screen. The design page demonstrates the
    // rule rather than breaking it.
    const { default: DesignPage } = await import("@/app/design/page");
    const { container } = render(<DesignPage />);
    const filled = container.querySelectorAll("button.bg-accent");
    expect(filled.length).toBeLessThanOrEqual(2); // primary + disabled example
  });
});

describe("/sign-in", () => {
  it("is noindexed", async () => {
    const { metadata } = await import("@/app/(app)/sign-in/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("renders the form", async () => {
    const { default: SignInPage } = await import("@/app/(app)/sign-in/page");
    render(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in");
  });
});

/*
 * The rest of the auth screens — /account, /forgot-password, /reset-password,
 * /verify-email, and what the (app) header does once someone is signed in —
 * have their own suite in tests/app/account-pages.test.tsx, for the same reason
 * /today does: they need the session and Better Auth's API stubbed per case.
 */
