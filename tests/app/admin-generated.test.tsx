// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GeneratedPackSummary } from "@/lib/admin/generated";

/**
 * The review queue as a reviewer sees it, and the two decisions behind it.
 *
 * The queue is the only surface where anyone ever sees a Generated pack — it
 * has no diff to review — so what it shows and what it refuses to offer are
 * both load-bearing.
 */

const requireAdminMock = vi.fn(async () => ({
  userId: "admin-1",
  email: "nixon@example.com",
  role: "admin",
}));
const promoteMock = vi.fn(async () => ({ kind: "promoted" as const }));
const discardMock = vi.fn(async () => true);
const revalidateMock = vi.fn();

let queue: GeneratedPackSummary[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidateMock(p) }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/admin/guard", () => ({ requireAdmin: () => requireAdminMock() }));
vi.mock("@/lib/admin/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/generated")>()),
  generatedPacks: async () => queue,
  promotePack: (...a: unknown[]) => promoteMock(...(a as [])),
  discardPack: (...a: unknown[]) => discardMock(...(a as [])),
}));

const { default: PacksIndexPage } = await import("@/app/admin/packs/page");
const { discardPackAction, promotePackAction } = await import(
  "@/app/admin/packs/actions"
);

const entry = (over: Partial<GeneratedPackSummary> = {}): GeneratedPackSummary =>
  ({
    pack: {
      slug: "rust-programming",
      name: "Rust Programming",
      maturity: "generated",
      evalTier: 2,
    },
    report: { passed: true, stats: { skills: 14, items: 54 } },
    learners: 7,
    build: undefined,
    promotable: true,
    blockers: [],
    ...over,
  }) as GeneratedPackSummary;

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  queue = [];
});

afterEach(cleanup);

describe("the review queue on /admin/packs", () => {
  it("says so when nothing has been built yet", async () => {
    render(await PacksIndexPage());
    expect(screen.getByText(/Nothing has been generated yet/)).toBeDefined();
  });

  it("lists a generated pack with what a reviewer needs to judge it", async () => {
    queue = [entry()];
    render(await PacksIndexPage());

    expect(screen.getByText("Rust Programming")).toBeDefined();
    expect(screen.getByText(/14 skills · 54 items/)).toBeDefined();
    expect(screen.getByText(/7 learners/)).toBeDefined();
  });

  it("offers Promote only once §7.1's conditions are met", async () => {
    queue = [entry()];
    render(await PacksIndexPage());
    expect(screen.getByRole("button", { name: "Promote" })).toBeDefined();
  });

  it("says why a pack cannot be promoted rather than showing a dead button", async () => {
    queue = [
      entry({
        promotable: false,
        blockers: ["2 of 5 learners — not enough use to judge it yet"],
        learners: 2,
      }),
    ];
    render(await PacksIndexPage());

    expect(screen.queryByRole("button", { name: "Promote" })).toBeNull();
    expect(screen.getByText(/not enough use to judge it yet/)).toBeDefined();
  });

  it("counts one learner in the singular", async () => {
    queue = [entry({ learners: 1 })];
    render(await PacksIndexPage());
    expect(screen.getByText(/1 learner$/)).toBeDefined();
  });

  it("falls back to a plain label when a failure carried no detail", async () => {
    queue = [
      entry({
        build: { status: "failed", detail: null },
        promotable: false,
        blockers: ["it does not pass validation"],
      }),
    ];
    render(await PacksIndexPage());
    expect(screen.getByText("Build failed")).toBeDefined();
  });

  it("shows a failed build's reason next to the pack", async () => {
    queue = [
      entry({
        build: { status: "failed", detail: "7 items; needs at least 24" },
        promotable: false,
        blockers: ["it does not pass validation"],
      }),
    ];
    render(await PacksIndexPage());
    expect(screen.getByText("7 items; needs at least 24")).toBeDefined();
  });

  it("offers Discard only while nobody is using it", async () => {
    queue = [entry({ learners: 0, promotable: false, blockers: ["none yet"] })];
    render(await PacksIndexPage());
    expect(screen.getByRole("button", { name: "Discard" })).toBeDefined();

    cleanup();
    queue = [entry({ learners: 3 })];
    render(await PacksIndexPage());
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });
});

describe("the reviewer's two decisions", () => {
  it("records the reviewer's own name on a promotion", async () => {
    // §7.1's `reviewedBy` is a claim about which person read it.
    await promotePackAction(form({ slug: "rust-programming" }));
    expect(promoteMock).toHaveBeenCalledWith(
      {},
      "rust-programming",
      "nixon@example.com",
    );
    expect(revalidateMock).toHaveBeenCalledWith("/admin/packs");
  });

  it("discards a pack and refreshes the queue", async () => {
    await discardPackAction(form({ slug: "rust-programming" }));
    expect(discardMock).toHaveBeenCalledWith({}, "rust-programming");
    expect(revalidateMock).toHaveBeenCalledWith("/admin/packs");
  });

  it("checks the caller is an admin on both, not just on the page", async () => {
    /*
     * A server action is a public endpoint whatever the page around it looked
     * like — a non-admin who knows the action exists must not be able to
     * promote a pack by posting to it.
     */
    await promotePackAction(form({ slug: "x" }));
    await discardPackAction(form({ slug: "x" }));
    expect(requireAdminMock).toHaveBeenCalledTimes(2);
  });

  it("treats a form with no slug as no slug", async () => {
    await promotePackAction(new FormData());
    expect(promoteMock).toHaveBeenCalledWith({}, "", "nixon@example.com");
  });

  it("treats a discard form with no slug as no slug", async () => {
    await discardPackAction(new FormData());
    expect(discardMock).toHaveBeenCalledWith({}, "");
  });
});
