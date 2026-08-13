// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DomainPack } from "@/lib/packs/types";

/**
 * The pack index's own logic, driven through a controlled `loadAllPacks`.
 *
 * The fixture directory cannot be pointed at wholesale — `thin-rubric` throws
 * on load by design — so the packs are handed in one list at a time. That also
 * makes the ordering assertion exact rather than dependent on whatever happens
 * to be on disk.
 */

const loadAllPacksMock = vi.fn();

vi.mock("@/lib/packs/loader", async () => {
  const actual = await vi.importActual<typeof import("@/lib/packs/loader")>(
    "@/lib/packs/loader",
  );
  return { ...actual, loadAllPacks: () => loadAllPacksMock() };
});

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: async () => ({
    userId: "u1",
    email: "admin@example.com",
    role: "admin",
  }),
}));

const { loadPack } = await vi.importActual<typeof import("@/lib/packs/loader")>(
  "@/lib/packs/loader",
);
const { default: PacksIndexPage } = await import("@/app/admin/packs/page");

/** Passes validation. */
const passing = (): DomainPack => loadPack("tests/fixtures/packs/valid-minimal");
/** Fails validation — a genuine cycle in the skill graph. */
const failing = (): DomainPack => loadPack("tests/fixtures/packs/cyclic");

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("/admin/packs — the index's own logic", () => {
  it("sorts failing packs above passing ones", async () => {
    // The point of the index. A list where the broken row is eleventh is a list
    // nobody reads, so validation state orders it, not the name.
    loadAllPacksMock.mockReturnValue([passing(), failing()]);
    const { container } = render(await PacksIndexPage());

    const statuses = [...container.querySelectorAll("li")].map((li) =>
      li.textContent?.includes("Failing") ? "Failing" : "Passing",
    );
    expect(statuses).toEqual(["Failing", "Passing"]);
  });

  it("sorts failing above passing whichever order they arrive in", async () => {
    // Same assertion, opposite input order, so the comparator is exercised in
    // both directions rather than only the one the disk happens to produce.
    loadAllPacksMock.mockReturnValue([failing(), passing(), failing()]);
    const { container } = render(await PacksIndexPage());

    const statuses = [...container.querySelectorAll("li")].map((li) =>
      li.textContent?.includes("Failing") ? "Failing" : "Passing",
    );
    expect(statuses).toEqual(["Failing", "Failing", "Passing"]);
  });

  it("keeps the order stable when every pack agrees, falling back to name", async () => {
    const a = { ...passing(), slug: "b-pack", name: "Beta" };
    const b = { ...passing(), slug: "a-pack", name: "Alpha" };
    loadAllPacksMock.mockReturnValue([a, b]);
    render(await PacksIndexPage());

    const names = screen.getAllByRole("link").map((el) => el.textContent);
    expect(names).toEqual(["Alpha", "Beta"]);
  });

  it("counts how many are failing", async () => {
    loadAllPacksMock.mockReturnValue([passing(), failing()]);
    render(await PacksIndexPage());
    expect(screen.getByText(/2 packs on disk · 1 failing validation/)).toBeDefined();
  });

  it("says so plainly when everything passes", async () => {
    loadAllPacksMock.mockReturnValue([passing(), passing()]);
    render(await PacksIndexPage());
    expect(screen.getByText(/2 packs on disk · all passing/)).toBeDefined();
  });

  it("uses the singular for a single pack", async () => {
    loadAllPacksMock.mockReturnValue([passing()]);
    render(await PacksIndexPage());
    expect(screen.getByText(/1 pack on disk/)).toBeDefined();
    expect(screen.queryByText(/1 packs on disk/)).toBeNull();
  });

  it("shows an empty state rather than a bare heading when there are none", async () => {
    loadAllPacksMock.mockReturnValue([]);
    render(await PacksIndexPage());
    expect(screen.getByText("No packs found on disk.")).toBeDefined();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
