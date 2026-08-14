// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The admin shell and the pack index.
 *
 * The single most important assertion in this file is the negative one: the
 * layout must *not* be the authorization boundary. Next's own guidance is that
 * a layout "does not control whether the rest of the route renders" — so a
 * guard there would look like security while the page below it still ran and
 * still shipped its data in the RSC payload.
 */

const requireAdminMock = vi.fn();

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: () => requireAdminMock(),
}));

const { default: AdminLayout, metadata: layoutMetadata, dynamic } =
  await import("@/app/admin/layout");
const { default: PacksIndexPage, metadata: packsMetadata } = await import(
  "@/app/admin/packs/page"
);

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    userId: "u1",
    email: "admin@example.com",
    role: "admin",
  });
});

afterEach(cleanup);

describe("the admin layout", () => {
  it("noindexes the whole segment structurally", () => {
    // Set once here rather than per page, so a new admin route cannot leak into
    // the index by being forgotten.
    expect(layoutMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("is never statically cached", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("does not call the guard — a layout is not an authorization boundary", () => {
    render(AdminLayout({ children: <p>child</p> }));
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("renders its children and the section nav", () => {
    render(AdminLayout({ children: <p>child</p> }));
    expect(screen.getByText("child")).toBeDefined();

    for (const label of ["Console", "Packs", "Data", "SQL", "Audit"]) {
      expect(screen.getByText(label), label).toBeDefined();
    }
  });
});

describe("/admin/packs", () => {
  it("is guarded", async () => {
    render(await PacksIndexPage());
    expect(requireAdminMock).toHaveBeenCalledTimes(1);
  });

  it("does not render when the guard rejects", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(PacksIndexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is noindexed in its own right as well as by the layout", () => {
    expect(packsMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("lists the real packs on disk with their validation state", async () => {
    render(await PacksIndexPage());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Packs");
    expect(screen.getByText("SQL & Data Analysis")).toBeDefined();
    // §24 E2's acceptance criterion names /admin/packs; the index is what
    // answers "which pack needs attention", which the per-pack viewer cannot.
    expect(screen.getAllByText(/Passing|Failing/).length).toBeGreaterThan(0);
  });

  it("links each row into the per-pack viewer", async () => {
    const { container } = render(await PacksIndexPage());
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/admin/packs/sql-data-analysis");
  });

  it("summarises how many packs there are and whether any fail", async () => {
    render(await PacksIndexPage());
    expect(screen.getByText(/pack(s)? on disk/)).toBeDefined();
  });
});
