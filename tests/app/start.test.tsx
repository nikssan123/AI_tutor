// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { encode } from "@/lib/check/session";
import { findPack } from "@/lib/content";
import { toDiagnostic } from "@/lib/check/session";
import { gradingModeFor } from "@/lib/engine/diagnostic";

/**
 * §8 screen 3 — goal creation, and §24 E11's promise that a check taken before
 * signing up is not thrown away.
 */

const jar = new Map<string, string>();
const cookiesMock = {
  get: (name: string) =>
    jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
};

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const createGoalMock = vi.fn(async () => "goal-1");

vi.mock("next/headers", () => ({
  cookies: async () => cookiesMock,
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/goals/store", () => ({
  createGoal: (...args: unknown[]) => createGoalMock(...(args as [])),
}));

const { default: StartPage } = await import("@/app/(app)/start/page");
const { createGoalAction } = await import("@/app/(app)/start/actions");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const search = (params: { error?: string } = {}) => Promise.resolve(params);

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
};

const valid = {
  topic: "photography",
  outcomeType: "career",
  statedLevel: "beginner",
  weeklyHours: "4",
};

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
});

afterEach(cleanup);

describe("the screen", () => {
  it("sends an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(StartPage({ searchParams: search() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("offers every subject in the catalogue", async () => {
    render(await StartPage({ searchParams: search() }));
    // Derived from the packs rather than counted, so a fourth pack does not
    // break the suite (§7.3 — adding a domain is a data change).
    const { allTopics } = await import("@/lib/content");
    for (const topic of allTopics()) {
      expect(screen.getByText(topic.name)).toBeDefined();
    }
  });

  it("says plainly that nothing self-reported counts", async () => {
    render(await StartPage({ searchParams: search() }));
    // The form asks for a level because §8 screen 3 does. §7.2 means it cannot
    // move the record, and the screen has to say so where it is asked.
    expect(screen.getByText(/nothing you pick here counts as proof/i)).toBeDefined();
    expect(screen.getByText(/start with nothing proven/i)).toBeDefined();
  });

  it("tells a visitor their anonymous check is coming with them", async () => {
    jar.set("check_photography", encode({ a: [{ i: "any", c: 1 }] }));
    render(await StartPage({ searchParams: search() }));
    expect(screen.getByText(/your check comes with you/i)).toBeDefined();
  });

  it("says nothing about a check that was never taken", async () => {
    render(await StartPage({ searchParams: search() }));
    expect(screen.queryByText(/your check comes with you/i)).toBeNull();
  });

  it("shows an error handed back by the action", async () => {
    render(await StartPage({ searchParams: search({ error: "Pick a subject." }) }));
    expect(screen.getByText("Pick a subject.")).toBeDefined();
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/start/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("creating the goal", () => {
  it("requires a signed-in learner", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(createGoalAction(form(valid))).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("rejects a form with no subject on it at all", async () => {
    // Not reachable through the rendered form, which marks the radio required —
    // but `required` is a courtesy to the browser, not a control on the server.
    const { topic: _omitted, ...rest } = valid;
    await expect(createGoalAction(form(rest))).rejects.toThrow(
      "REDIRECT:/start?error=subject",
    );
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("rejects a subject that is not a real pack", async () => {
    await expect(
      createGoalAction(form({ ...valid, topic: "underwater-basket-weaving" })),
    ).rejects.toThrow("REDIRECT:/start?error=subject");
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("hands a bad field back to the form rather than throwing", async () => {
    await expect(
      createGoalAction(form({ ...valid, weeklyHours: "900" })),
    ).rejects.toThrow(/REDIRECT:\/start\?error=/);
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("stores the goal and lands on /today", async () => {
    await expect(createGoalAction(form(valid))).rejects.toThrow(
      "REDIRECT:/today",
    );

    expect(createGoalMock).toHaveBeenCalledTimes(1);
    const [, input] = createGoalMock.mock.calls[0] as unknown as [
      unknown,
      { userId: string; packSlug: string; mastery: unknown[] },
    ];
    expect(input.userId).toBe("u1");
    expect(input.packSlug).toBe("photography");
    expect(input.mastery).toEqual([]);
  });

  it("carries an anonymous check into the new goal (§24 E11)", async () => {
    const pack = findPack("photography")!;
    const closed = toDiagnostic(pack).items.find(
      (i) => gradingModeFor(i.type) === "auto",
    )!;
    jar.set("check_photography", encode({ a: [{ i: closed.slug, c: 1 }] }));

    await expect(createGoalAction(form(valid))).rejects.toThrow(
      "REDIRECT:/today",
    );

    const [, input] = createGoalMock.mock.calls[0] as unknown as [
      unknown,
      { mastery: Array<{ skillId: string; evidenceCount: number }> },
    ];
    expect(input.mastery.map((m) => m.skillId)).toEqual([closed.skill]);
    expect(input.mastery[0]!.evidenceCount).toBe(1);
  });

  it("does not pick up a check taken in a different subject", async () => {
    jar.set("check_sql-data-analysis", encode({ a: [{ i: "any", c: 1 }] }));
    await expect(createGoalAction(form(valid))).rejects.toThrow(
      "REDIRECT:/today",
    );

    const [, input] = createGoalMock.mock.calls[0] as unknown as [
      unknown,
      { mastery: unknown[] },
    ];
    expect(input.mastery).toEqual([]);
  });
});
