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
/**
 * The stopped-build queue, empty by default.
 *
 * These cases are about the pack list, not the failure list, and both render
 * rows into the same page — so an unmocked one would put whatever the database
 * happens to hold into assertions about pack ordering.
 */
const stoppedMock = vi.fn(async () => [] as unknown[]);
const findBuildMock = vi.fn(async () => ({
  slug: "net-development",
  subject: ".NET development",
  requestedBy: "learner-1",
  status: "failed" as const,
  stage: null,
  detail: "7 items",
  startedAt: new Date(),
}));
const startBuildMock = vi.fn(async () => ({ kind: "started" as const }));
const giveUpMock = vi.fn(async () => true);
vi.mock("@/lib/packs/build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/build")>()),
  stoppedBuilds: () => stoppedMock(),
  findBuild: () => findBuildMock(),
  startBuild: (...a: unknown[]) => startBuildMock(...(a as [])),
  giveUpOnBuild: (...a: unknown[]) => giveUpMock(...(a as [])),
}));
const sendMock = vi.fn(async () => undefined);
vi.mock("@/lib/inngest/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inngest/client")>()),
  inngest: { send: (...a: unknown[]) => sendMock(...(a as [])) },
}));

vi.mock("@/lib/admin/guard", () => ({ requireAdmin: () => requireAdminMock() }));
vi.mock("@/lib/admin/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/generated")>()),
  generatedPacks: async () => queue,
  promotePack: (...a: unknown[]) => promoteMock(...(a as [])),
  discardPack: (...a: unknown[]) => discardMock(...(a as [])),
}));

const { default: PacksIndexPage } = await import("@/app/admin/packs/page");
const {
  discardPackAction,
  giveUpBuildAction,
  promotePackAction,
  retryBuildAction,
} = await import("@/app/admin/packs/actions");

const stopped = (over: Record<string, unknown> = {}) => ({
  slug: "net-development",
  subject: ".NET development",
  requestedBy: "learner-1",
  status: "failed" as const,
  stage: null,
  detail: "7 items; a diagnostic needs at least 24",
  startedAt: new Date("2026-08-15T14:19:00.000Z"),
  finishedAt: new Date("2026-08-15T14:42:00.000Z"),
  notifiedAt: new Date("2026-08-15T14:42:01.000Z"),
  stalled: false,
  ...over,
});

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
        build: { status: "failed", detail: null, dropped: null },
        promotable: false,
        blockers: ["it does not pass validation"],
      }),
    ];
    render(await PacksIndexPage());
    expect(screen.getByText("Build failed")).toBeDefined();
  });

  it("shows what a shipped pack lost on the way", async () => {
    /*
     * The question a reviewer asks first, and until now could not answer: a
     * pack with no reading list looked exactly like a subject nobody had
     * anything to recommend for. `dropped` is computed on every build and was
     * discarded whenever one succeeded.
     */
    queue = [
      entry({
        build: {
          status: "ready",
          detail: null,
          dropped: ['resource "A Guide" covers no skill this pack contains'],
        },
        promotable: true,
        blockers: [],
      }),
    ];
    render(await PacksIndexPage());
    expect(
      screen.getByText(/covers no skill this pack contains/),
    ).toBeDefined();
  });

  it("stays quiet about a build that dropped nothing", async () => {
    // An empty drop log is good news, and good news does not need a line of
    // its own on a screen whose job is to surface what needs attention.
    queue = [
      entry({
        build: { status: "ready", detail: null, dropped: [] },
        promotable: true,
        blockers: [],
      }),
    ];
    render(await PacksIndexPage());
    expect(screen.queryByText(/Dropped in assembly/)).toBeNull();
  });

  it("shows a failed build's reason next to the pack", async () => {
    queue = [
      entry({
        build: { status: "failed", detail: "7 items; needs at least 24", dropped: null },
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


describe("builds that stopped", () => {
  /**
   * The retry lives here and nowhere else.
   *
   * It used to be a button on the learner's wait screen, which asked somebody
   * with no way to tell a bad subject from a bad afternoon to spend four model
   * calls and about a pound on a guess — the catalogue's pound, on the free
   * tier. Whoever reads this page has the reason and the drop log.
   */
  it("lists a stopped build with its reason", async () => {
    stoppedMock.mockResolvedValue([stopped()]);
    render(await PacksIndexPage());

    expect(screen.getByText(".NET development")).toBeDefined();
    expect(
      screen.getByText("7 items; a diagnostic needs at least 24"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });

  it("distinguishes a stall from a failure, because the first move differs", async () => {
    // A failed run stopped and wrote down why. A stalled one stopped without
    // ever saying, so the first move is to find out where.
    stoppedMock.mockResolvedValue([
      stopped({ stalled: true, status: "building", stage: "writing", detail: null }),
    ]);
    render(await PacksIndexPage());

    expect(screen.getByText(/Stalled at writing/)).toBeDefined();
  });

  it("says where a stall happened even when it never started", async () => {
    // `stage` is null until the worker picks the row up, so a run that stalled
    // in the queue has no phase to name.
    stoppedMock.mockResolvedValue([
      stopped({ stalled: true, status: "building", stage: null, detail: null }),
    ]);
    render(await PacksIndexPage());

    expect(screen.getByText(/Stalled at the start/)).toBeDefined();
  });

  it("shows when nobody was told, which is a second failure", async () => {
    stoppedMock.mockResolvedValue([stopped({ notifiedAt: null })]);
    render(await PacksIndexPage());

    expect(screen.getByText("Team not told")).toBeDefined();
  });

  it("says so plainly when nothing has stopped", async () => {
    stoppedMock.mockResolvedValue([]);
    render(await PacksIndexPage());

    expect(screen.getByText(/Nothing has stopped/)).toBeDefined();
  });
});

describe("retryBuildAction", () => {
  const form = (slug: string) => {
    const data = new FormData();
    data.set("slug", slug);
    return data;
  };

  it("checks the admin role before anything else", async () => {
    // A server action is a public endpoint whatever page rendered the button.
    requireAdminMock.mockRejectedValueOnce(new Error("NOT_ADMIN"));
    await expect(retryBuildAction(form("net-development"))).rejects.toThrow(
      "NOT_ADMIN",
    );
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("re-claims the slug and dispatches the build", async () => {
    await retryBuildAction(form("net-development"));

    expect(startBuildMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slug: "net-development" }),
    );
    expect(sendMock).toHaveBeenCalledOnce();
    expect(revalidateMock).toHaveBeenCalledWith("/admin/packs");
  });

  it("keeps the build on the learner who asked, not the operator", async () => {
    /*
     * `requestedBy` decides whose ceiling the run is charged against and
     * whether the catalogue subsidises it, and both should answer for the
     * person who wanted the subject. It is also what `mayBuild` reads to let
     * that learner keep the subject as theirs.
     */
    await retryBuildAction(form("net-development"));

    expect(startBuildMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "learner-1" }),
    );
  });

  it("falls back to the operator when the learner is gone", async () => {
    // `requested_by` is nulled when an account is deleted; the subject still
    // needs building.
    findBuildMock.mockResolvedValueOnce({
      slug: "net-development",
      subject: ".NET development",
      requestedBy: null,
      status: "failed" as const,
      stage: null,
      detail: null,
      startedAt: new Date(),
    } as never);

    await retryBuildAction(form("net-development"));

    expect(startBuildMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "admin-1" }),
    );
  });

  it("does nothing for a slug with no build row", async () => {
    findBuildMock.mockResolvedValueOnce(undefined as never);
    await retryBuildAction(form("no-such-subject"));
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("ignores an empty slug rather than claiming one", async () => {
    await retryBuildAction(form("  "));
    expect(findBuildMock).not.toHaveBeenCalled();
  });

  it("ignores a form with no slug field at all", async () => {
    await retryBuildAction(new FormData());
    expect(findBuildMock).not.toHaveBeenCalled();
  });

  it("does not re-send when the slug is already building", async () => {
    // Two operators reading the same list must not start two runs of one
    // subject; `startBuild` is the lock and this respects its answer.
    startBuildMock.mockResolvedValueOnce({ kind: "already" } as never);
    await retryBuildAction(form("net-development"));
    expect(sendMock).not.toHaveBeenCalled();
  });
});


describe("giveUpBuildAction", () => {
  const form = (slug: string) => {
    const data = new FormData();
    data.set("slug", slug);
    return data;
  };

  it("checks the admin role first", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("NOT_ADMIN"));
    await expect(giveUpBuildAction(form("net-development"))).rejects.toThrow(
      "NOT_ADMIN",
    );
    expect(giveUpMock).not.toHaveBeenCalled();
  });

  it("removes the build, which is what frees the learner", async () => {
    /*
     * The lifetime quota counts build rows, so until the row goes a free
     * learner has no conversation (`mayUseIntake` reads the same count) and
     * nothing to spend their one custom subject on. Nothing else releases it —
     * `discardPack` looks the pack up in `generatedPacks`, and a build that
     * failed never created one.
     */
    await giveUpBuildAction(form("net-development"));

    expect(giveUpMock).toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/admin/packs");
  });

  it("ignores a form with no slug", async () => {
    await giveUpBuildAction(new FormData());
    expect(giveUpMock).not.toHaveBeenCalled();
  });

  it("is offered beside the retry, not instead of it", async () => {
    // Two different decisions: try this again, and we are not going to build
    // this. Only an operator is in a position to make the second.
    stoppedMock.mockResolvedValue([stopped()]);
    render(await PacksIndexPage());

    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Give up" })).toBeDefined();
  });
});
