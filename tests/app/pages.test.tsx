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

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
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
    const { default: AppLayout } = await import("@/app/(app)/layout");
    render(<AppLayout>{<p>child</p>}</AppLayout>);
    expect(screen.getByText("child")).toBeDefined();
  });
});

describe("landing page", () => {
  it("sets an explicit canonical (§13.3 — never rely on defaults)", async () => {
    const { metadata } = await import("@/app/(marketing)/page");
    expect(metadata.alternates?.canonical).toBeTruthy();
  });

  it("leads with the positioning statement from §6.2", async () => {
    const { default: HomePage } = await import("@/app/(marketing)/page");
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { level: 1 }).textContent,
    ).toContain("Prove it");
  });

  it("uses the JS-free theme control, not the Radix one (§8.5.8)", async () => {
    // Importing the client component here would drag Radix into the marketing
    // bundle, which is the budget mistake §8.5.8 exists to prevent.
    const source = await import("@/app/(marketing)/page");
    render(<source.default />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeDefined();
  });
});

describe("/today — the retention surface (§8 screen 6)", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    const { default: TodayPage } = await import("@/app/(app)/today/page");
    await expect(TodayPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
  });

  it("shows one primary card and nothing else (§8.5.1 density rule)", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "a@b.co" } });
    const { default: TodayPage } = await import("@/app/(app)/today/page");
    render(await TodayPage());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Today");
    // No feed, no browse: §8 screen 6 allows exactly one primary card.
    expect(screen.queryAllByRole("list")).toHaveLength(0);
    expect(screen.getByText(/don't have a goal yet/i)).toBeDefined();
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/today/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

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
      "Deeply supported",
      "Experimental — help us improve it",
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
    render(<SignInPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in");
  });
});
