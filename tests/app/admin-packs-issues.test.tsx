// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The viewer's second half: a reviewer needs to see what the validator said,
 * not just the graph. Pointed at the fixture packs, which carry deliberate
 * warnings, so the issue rows actually render.
 */
vi.mock("@/lib/packs/loader", async () => {
  const actual = await vi.importActual<typeof import("@/lib/packs/loader")>(
    "@/lib/packs/loader",
  );
  return { ...actual, PACKS_DIR: "tests/fixtures/packs" };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: PackPage } = await import("@/app/admin/packs/[slug]/page");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/admin/packs/[slug] — validation reporting", () => {
  it("lists each issue with its check name and severity", async () => {
    render(
      await PackPage({ params: Promise.resolve({ slug: "valid-minimal" }) }),
    );

    expect(screen.getByText("item_minimum")).toBeDefined();
    expect(screen.getByText("warning")).toBeDefined();
    expect(
      screen.getByText(/adaptive diagnostic needs at least 20/),
    ).toBeDefined();
  });

  it("still reports the pack as passing when only warnings are present", async () => {
    // Warnings inform; only blocking issues fail a pack (§7.1 — a Standard pack
    // legitimately ships with gaps).
    render(
      await PackPage({ params: Promise.resolve({ slug: "valid-minimal" }) }),
    );
    expect(screen.getByText("Validation passing")).toBeDefined();
  });

  it("marks a blocking issue as blocking, and the pack as failing", async () => {
    render(await PackPage({ params: Promise.resolve({ slug: "cyclic" }) }));

    expect(screen.getByText("Validation failing")).toBeDefined();
    expect(screen.getByText("dag_acyclic")).toBeDefined();
    expect(screen.getByText("blocking")).toBeDefined();
    expect(screen.getByText(/alpha -> beta -> alpha/)).toBeDefined();
  });

  it("truncates a long skill name rather than overflowing the node", async () => {
    const { container } = render(
      await PackPage({ params: Promise.resolve({ slug: "valid-minimal" }) }),
    );
    for (const text of container.querySelectorAll("text")) {
      expect(text.textContent!.length).toBeLessThanOrEqual(22);
    }
  });
});
