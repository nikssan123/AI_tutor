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

/**
 * The stopped-build queue, empty by default.
 *
 * These cases are about the pack list, not the failure list, and both render
 * rows into the same page — so an unmocked one would put whatever the database
 * happens to hold into assertions about pack ordering.
 */
const stoppedMock = vi.fn(async () => [] as unknown[]);
vi.mock("@/lib/packs/build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/build")>()),
  stoppedBuilds: () => stoppedMock(),
}));

/**
 * The review queue, empty by default — the same reasoning as the list above,
 * applied to the third list on this page rather than only the second.
 *
 * It was the one that stayed live against the database, which held nothing to
 * find until the day a generated pack actually shipped. Then `net-c` landed and
 * four ordering assertions started counting a row nobody had asked for,
 * including a duplicate React key. A page that renders three lists needs all
 * three controlled before it can be asked a question about one of them.
 */
const generatedMock = vi.fn(async () => [] as unknown[]);
vi.mock("@/lib/admin/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/generated")>()),
  generatedPacks: () => generatedMock(),
}));

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

  // The count and the verdict are two facts on the header's rule rather than
  // one run-on sentence, so they are asserted apart. The verdict is a `Status`
  // — §8.5.5's dot plus a word — which is why it reads as a label rather than
  // as a clause.
  it("counts how many are failing", async () => {
    loadAllPacksMock.mockReturnValue([passing(), failing()]);
    render(await PacksIndexPage());
    expect(screen.getByText(/2 packs on disk/)).toBeDefined();
    expect(screen.getByText(/1 failing validation/)).toBeDefined();
    expect(screen.queryByText(/All passing/)).toBeNull();
  });

  it("says so plainly when everything passes", async () => {
    loadAllPacksMock.mockReturnValue([passing(), passing()]);
    render(await PacksIndexPage());
    expect(screen.getByText(/2 packs on disk/)).toBeDefined();
    expect(screen.getByText(/All passing/)).toBeDefined();
    expect(screen.queryByText(/failing validation/)).toBeNull();
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
