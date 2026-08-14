// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const requireAdminMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

// Stubbed; the guard itself is tested in tests/lib/admin-guard.test.ts. What
// this file pins is that the viewer calls it — it was reachable by anyone until
// the admin console landed.
vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: () => requireAdminMock(),
}));

const { default: PackPage, metadata } = await import(
  "@/app/admin/packs/[slug]/page"
);

beforeEach(() => {
  requireAdminMock.mockResolvedValue({
    userId: "u1",
    email: "admin@example.com",
    role: "admin",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("access", () => {
  it("is guarded", async () => {
    await PackPage({ params: Promise.resolve({ slug: "sql-data-analysis" }) });
    expect(requireAdminMock).toHaveBeenCalledTimes(1);
  });

  it("does not read the pack off disk when the guard rejects", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(
      PackPage({ params: Promise.resolve({ slug: "sql-data-analysis" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

/**
 * §24 E2's acceptance criterion: "/admin/packs renders the graph."
 *
 * The viewer's job is to make a reviewer's judgement possible, so these check
 * that both halves are present — the DAG *and* the validation report — rather
 * than merely that the page returns something.
 */
describe("/admin/packs/[slug]", () => {
  it("renders the real SQL pack's graph", async () => {
    const { container } = render(
      await PackPage({ params: Promise.resolve({ slug: "sql-data-analysis" }) }),
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "SQL & Data Analysis",
    );
    // One node per skill, one line per dependency.
    expect(container.querySelectorAll("rect")).toHaveLength(26);
    expect(container.querySelectorAll("line")).toHaveLength(42);
  });

  it("shows the pack's declared maturity and validation state", async () => {
    render(
      await PackPage({ params: Promise.resolve({ slug: "sql-data-analysis" }) }),
    );
    // The SQL pack is Curated and signed by a *model* review, so the operator
    // screen says what was actually done rather than borrowing the badge a
    // human sign-off earns. This assertion read "Written and checked by hand"
    // while that was untrue of the pack it was rendering.
    expect(screen.getByText("Checked against published curricula")).toBeDefined();
    expect(screen.getByText("Validation passing")).toBeDefined();
  });

  it("reports the statistics a reviewer needs", async () => {
    render(
      await PackPage({ params: Promise.resolve({ slug: "sql-data-analysis" }) }),
    );
    for (const label of [
      "Skills",
      "Dependencies",
      "Items",
      "Production / MCQ",
      "Rubrics",
      "Projects",
    ]) {
      expect(screen.getByText(label), label).toBeDefined();
    }
  });

  it("gives the graph an accessible label", async () => {
    render(
      await PackPage({ params: Promise.resolve({ slug: "sql-data-analysis" }) }),
    );
    expect(
      screen.getByRole("img", { name: /Skill graph for SQL & Data Analysis/ }),
    ).toBeDefined();
  });

  it("distinguishes hard from soft dependencies", async () => {
    const { container } = render(
      await PackPage({ params: Promise.resolve({ slug: "sql-data-analysis" }) }),
    );
    const lines = [...container.querySelectorAll("line")];
    expect(lines.some((l) => l.getAttribute("stroke-dasharray"))).toBe(true);
    expect(lines.some((l) => !l.getAttribute("stroke-dasharray"))).toBe(true);
  });

  it("404s for a pack that does not exist", async () => {
    await expect(
      PackPage({ params: Promise.resolve({ slug: "no-such-pack" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("is noindexed — it is an internal tool", async () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
