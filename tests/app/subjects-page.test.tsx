// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { allTopics } from "@/lib/content";
import { cookieName, encode } from "@/lib/check/session";

/**
 * The catalogue — the door in for someone who has just signed up and has no
 * course.
 *
 * There was exactly one door before this: `/start`, a six-turn conversation.
 * That is the right door for someone who knows what they want, and a commitment
 * interview for someone looking around. What matters here is that the page is
 * honest about what it is offering — §7.1's maturity badge on every subject,
 * and §7.1's third tier said out loud rather than left as an absence.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const coursesForMock = vi.fn();
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/goals/courses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals/courses")>()),
  coursesFor: (...args: unknown[]) => coursesForMock(...(args as [])),
}));

const { default: SubjectsPage } = await import("@/app/(app)/subjects/page");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const topics = allTopics();

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  coursesForMock.mockResolvedValue([]);
});

afterEach(cleanup);

/**
 * Above the catalogue, deliberately. Starting a fourth course while three sit
 * paused is the outcome a catalogue quietly encourages, and this is the screen
 * best placed to interrupt it.
 */
describe("courses already put aside", () => {
  it("offers them before the catalogue", async () => {
    coursesForMock.mockResolvedValue([
      {
        goalId: "g-old",
        name: "Photography",
        taxonomyParent: "creative",
        status: "paused",
      },
    ]);
    render(await SubjectsPage());

    expect(screen.getByText("Courses you put aside")).toBeDefined();
    expect(screen.getByRole("button", { name: "Pick it up" })).toBeDefined();
  });

  it("draws no band for a learner who has none", async () => {
    render(await SubjectsPage());
    expect(screen.queryByText("Courses you put aside")).toBeNull();
  });
});

describe("who can see it", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(SubjectsPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/subjects/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("what it lists", () => {
  it("shows every subject, not a curated sample of them", async () => {
    render(await SubjectsPage());

    for (const topic of topics) {
      expect(screen.getByRole("link", { name: topic.name })).toBeDefined();
    }
  });

  /**
   * §7.1 — "depth is declared, not faked". A catalogue is the one screen where
   * the badge does real work: it is where someone chooses, and the choice is
   * partly between a subject a person wrote and one a machine did.
   */
  it("declares how every subject was built", async () => {
    render(await SubjectsPage());

    const rows = screen.getAllByRole("listitem");
    for (const row of rows) {
      const badge = within(row).queryByText(
        /Written and checked by hand|Covers the subject well|help us improve it|check comes with you/,
      );
      expect(badge).not.toBeNull();
    }
  });

  it("offers both doors on every subject: check it, or start it", async () => {
    render(await SubjectsPage());

    expect(screen.getAllByRole("link", { name: "Take the check" }).length).toBe(
      topics.length,
    );
    expect(
      screen.getByRole("link", { name: topics[0]!.name }).getAttribute("href"),
    ).toBe(`/start?topic=${encodeURIComponent(topics[0]!.name)}`);
  });

  /**
   * `/start` opens the conversation with whatever text it is handed, so the
   * link carries the subject's name. Handing it a slug would have the analyzer
   * reading "sql-data-analysis" as though a person had typed it.
   */
  it("hands /start a subject a person would have typed, not a slug", async () => {
    render(await SubjectsPage());

    for (const topic of topics) {
      const href = screen
        .getByRole("link", { name: topic.name })
        .getAttribute("href");
      expect(href).not.toContain(topic.slug);
    }
  });

  /** §7.1's third tier: the list is not the limit, and saying so is the point. */
  it("says the catalogue is not the limit", async () => {
    render(await SubjectsPage());

    expect(screen.getByText(/build the subject/i)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Tell us what you want" }).getAttribute("href"),
    ).toBe("/start");
  });

  /** §4.2 law 1, on the screen where someone is deciding what a check is for. */
  it("refuses to let a check pass for proof", async () => {
    render(await SubjectsPage());
    expect(screen.getByText(/cannot prove you can do the work/i)).toBeDefined();
  });
});

describe("a check taken before signing up", () => {
  it("promises to carry it into the course", async () => {
    jar.set(
      cookieName(topics[0]!.slug),
      encode({ s: 1, a: [{ i: "item-1", c: 1 }] }),
    );
    render(await SubjectsPage());

    expect(screen.getByText("Your check comes with you")).toBeDefined();
    // And it offers to redo it rather than to take it for the first time.
    expect(screen.getByRole("link", { name: "Check again" })).toBeDefined();
  });

  it("promises nothing for a subject they have not checked", async () => {
    render(await SubjectsPage());
    expect(screen.queryByText("Your check comes with you")).toBeNull();
  });
});
