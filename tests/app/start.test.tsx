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
// `finish` clears the stored conversation, so the stub answers to delete.
vi.mock("@/db", () => ({
  getDb: () => ({ delete: () => ({ where: async () => undefined }) }),
}));
// These exercise the disk half of `resolvePack` with the real `findPack`. The
// database half has nothing to find and no stub db to find it with, so a miss
// on disk is a miss outright — which is what "not a real pack" means here.
vi.mock("@/lib/packs/read", () => ({ packFromDb: async () => undefined }));
vi.mock("@/lib/goals/store", () => ({
  createGoal: (...args: unknown[]) => createGoalMock(...(args as [])),
}));
/*
 * The other half of the form: a subject nothing covers goes to §7.1's
 * Generated tier, which means writing the answers down, checking the account
 * may commission a pack, claiming the slug and handing it to the queue. All
 * four are somebody else's unit tests; these are about what the form does with
 * them.
 */
const saveIntakeMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/goals/intake-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals/intake-store")>()),
  saveIntake: (...a: unknown[]) => saveIntakeMock(...(a as [])),
  clearIntake: async () => undefined,
}));
const mayBuildMock = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/billing/quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/quota")>()),
  mayBuild: (...a: unknown[]) => mayBuildMock(...(a as [])),
}));
const startBuildMock = vi.fn(
  async (..._a: unknown[]): Promise<{ kind: string; build?: unknown }> => ({
    kind: "started",
  }),
);
const finishBuildMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/packs/build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/build")>()),
  startBuild: (...a: unknown[]) => startBuildMock(...(a as [])),
  finishBuild: (...a: unknown[]) => finishBuildMock(...(a as [])),
}));
const sendMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/inngest/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inngest/client")>()),
  inngest: { send: (...a: unknown[]) => sendMock(...(a as [])) },
}));
/*
 * A queue that cannot be reached is now reported to the team as well as
 * written down, so this path reaches the mail. Stubbed here for the same
 * reason the two above are: what it sends is `tests/packs/notify.test.ts`'s
 * subject, and the real one would write `notified_at` through a `db.update`
 * the stub above deliberately does not have.
 */
const notifyFailedMock = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/packs/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/packs/notify")>()),
  notifyBuildFailed: (...a: unknown[]) => notifyFailedMock(...(a as [])),
}));

/*
 * The form moved to /start/form when §8 screen 3's conversation took over
 * /start. It is kept as the no-JavaScript, no-model fallback, and it still
 * fills the same GoalSpec — which is what these tests are about.
 */
const { default: StartPage } = await import("@/app/(app)/start/form/page");
const { createGoalAction } = await import("@/app/(app)/start/actions");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const search = (params: { error?: string; subject?: string } = {}) =>
  Promise.resolve(params);

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
  // Explicit, because `clearAllMocks` clears the calls but keeps a return value
  // a previous test set — a refused build would otherwise leak into every test
  // after it.
  mayBuildMock.mockResolvedValue(true);
  startBuildMock.mockResolvedValue({ kind: "started" });
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

  /*
   * The list is not the offer. §7.1's Generated tier is why the conversation
   * takes any subject at all, and this form is the same intake with the model
   * taken out — so seven radios and nothing else told anyone whose subject was
   * missing that we could not teach it, on the screen that exists to take the
   * answer.
   */
  it("takes a subject that is not on the list", async () => {
    const { container } = render(await StartPage({ searchParams: search() }));

    expect(screen.getByText("Something else")).toBeDefined();
    const box = container.querySelector<HTMLInputElement>(
      "input[name=customSubject]",
    )!;
    expect(box).not.toBeNull();
    // Not `required`: the field is hidden until its radio is chosen, and a
    // hidden required control blocks submission in a way nothing can focus to
    // fix. The action checks it instead.
    expect(box.required).toBe(false);
  });

  it("keeps the typed subject when the form comes back with an error", async () => {
    const { container } = render(
      await StartPage({
        searchParams: search({ error: "Pick what this is for.", subject: "Rust" }),
      }),
    );

    const box = container.querySelector<HTMLInputElement>(
      "input[name=customSubject]",
    )!;
    expect(box.defaultValue).toBe("Rust");

    // And the row it belongs to is the one selected — a form rejected over the
    // hours field used to come back with "Rust" gone and Photography chosen.
    const radios = container.querySelectorAll<HTMLInputElement>(
      "input[name=topic]",
    );
    const checked = [...radios].filter((r) => r.defaultChecked);
    expect(checked.map((r) => r.value)).toEqual(["__other"]);
  });

  it("says what the level picker is for, without lecturing", async () => {
    render(await StartPage({ searchParams: search() }));
    /*
     * The form asks for a level because §8 screen 3 does, and §7.2 means it
     * cannot move the record. The screen used to say so twice — once under the
     * picker and once in a card of its own, on the accent field.
     *
     * That is marketing copy on a task screen. Someone filling this in has
     * already signed up; telling them their self-assessment is not evidence
     * answers a question they did not ask, in a register that reads as
     * distrust. What they actually need is what the field does.
     */
    expect(screen.getByText(/just a starting point/i)).toBeDefined();
    expect(screen.queryByText(/counts as proof/i)).toBeNull();
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
    const { metadata } = await import("@/app/(app)/start/form/page");
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
    //
    // What comes back is a sentence rather than the word "subject": this lands
    // in a query parameter the screen renders as it stands, so an error code
    // there is an error code shown to a person.
    const { topic: _omitted, ...rest } = valid;
    await expect(createGoalAction(form(rest))).rejects.toThrow(
      /REDIRECT:\/start\/form\?error=Pick\+a\+subject/,
    );
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("rejects a subject that is not a real pack", async () => {
    await expect(
      createGoalAction(form({ ...valid, topic: "underwater-basket-weaving" })),
    ).rejects.toThrow(/REDIRECT:\/start\/form\?error=Pick\+a\+subject/);
    expect(createGoalMock).not.toHaveBeenCalled();
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("hands a bad field back to the form rather than throwing", async () => {
    await expect(
      createGoalAction(form({ ...valid, weeklyHours: "900" })),
    ).rejects.toThrow(/REDIRECT:\/start\/form\?error=/);
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

/**
 * §7.1's Generated tier, reached from the form rather than the conversation.
 *
 * The two intakes end in the same two places on purpose: a subject we run
 * becomes a goal, and one we do not becomes a build. What the form has to add
 * is somewhere for the answers to live while the pack is written, because a
 * `GoalSpec` cannot name a pack that does not exist yet.
 */
describe("a subject we do not have", () => {
  const custom = (over: Record<string, string> = {}) =>
    form({
      ...valid,
      topic: "__other",
      customSubject: "Rust",
      ...over,
    });

  it("starts a build and sends the learner to watch it", async () => {
    await expect(createGoalAction(custom())).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust",
    );

    expect(startBuildMock).toHaveBeenCalledWith(expect.anything(), {
      slug: "rust",
      subject: "Rust",
      userId: "u1",
    });
    expect(sendMock).toHaveBeenCalledOnce();
    // No goal yet: there is no pack for it to point at until the build lands.
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("writes the answers down before anything is claimed or queued", async () => {
    // The wait screen adopts from this intake when the pack arrives, and
    // `/start` renders it if the build is refused or stops. Without it the form
    // would take six answers and forget every one of them at the door.
    await expect(createGoalAction(custom())).rejects.toThrow("REDIRECT:");

    expect(saveIntakeMock).toHaveBeenCalledOnce();
    const [, userId, intake] = saveIntakeMock.mock.calls[0] as unknown as [
      unknown,
      string,
      { captured: { subject: string; weeklyHours: number }; done: boolean },
    ];
    expect(userId).toBe("u1");
    expect(intake.captured.subject).toBe("Rust");
    expect(intake.captured.weeklyHours).toBe(4);
    expect(intake.done).toBe(true);
  });

  it("treats a typed subject we already run as having picked it", async () => {
    // Someone who types "Photography" has chosen Photography. Building a second
    // pack for it would be a worse answer to a better-spelled question.
    await expect(
      createGoalAction(custom({ customSubject: "Photography" })),
    ).rejects.toThrow("REDIRECT:/today");

    expect(startBuildMock).not.toHaveBeenCalled();
    const [, input] = createGoalMock.mock.calls[0] as unknown as [
      unknown,
      { packSlug: string },
    ];
    expect(input.packSlug).toBe("photography");
  });

  it("ignores the box when a subject on the list is the one chosen", async () => {
    // The box is hidden by its radio rather than emptied by it, so a change of
    // mind still submits what was typed first.
    await expect(
      createGoalAction(form({ ...valid, customSubject: "Rust" })),
    ).rejects.toThrow("REDIRECT:/today");

    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("asks again rather than guessing when the box is empty", async () => {
    await expect(
      createGoalAction(custom({ customSubject: "  " })),
    ).rejects.toThrow(/REDIRECT:\/start\/form\?error=Pick\+a\+subject/);

    expect(saveIntakeMock).not.toHaveBeenCalled();
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("hands a bad field back with the typed subject still on it", async () => {
    await expect(
      createGoalAction(custom({ weeklyHours: "900" })),
    ).rejects.toThrow(/REDIRECT:\/start\/form\?error=Weekly\+hours.*&subject=Rust/);

    // Nothing is written and nothing is claimed for a form that did not parse.
    expect(saveIntakeMock).not.toHaveBeenCalled();
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("does not spend a build the account does not have", async () => {
    mayBuildMock.mockResolvedValue(false);

    await expect(createGoalAction(custom())).rejects.toThrow(
      "REDIRECT:/start?error=generated",
    );

    // The answers survive the refusal: that screen renders this intake, with
    // the subject, the wall, and the way past it.
    expect(saveIntakeMock).toHaveBeenCalledOnce();
    expect(startBuildMock).not.toHaveBeenCalled();
  });

  it("says so rather than queueing a second build at once", async () => {
    startBuildMock.mockResolvedValue({ kind: "rate-limited" });

    await expect(createGoalAction(custom())).rejects.toThrow(
      "REDIRECT:/start?error=busy",
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("joins a build already running rather than sending a second event", async () => {
    startBuildMock.mockResolvedValue({ kind: "already", build: {} });

    await expect(createGoalAction(custom())).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust",
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("marks the build failed when the queue cannot be reached", async () => {
    // §24 E8 — never a silent loss. The row is what the quota counts, so a
    // claim left standing for a build that never ran would cost a free account
    // its one custom subject.
    sendMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createGoalAction(custom())).rejects.toThrow(
      "REDIRECT:/start/building?subject=rust",
    );

    expect(finishBuildMock).toHaveBeenCalledWith(
      expect.anything(),
      "rust",
      expect.objectContaining({ status: "failed" }),
    );

    // And somebody is told. This is the failure the worker never sees — it is
    // the queue itself that is down — so nothing else would report it, and the
    // learner is meanwhile promised on the wait screen that we know.
    expect(notifyFailedMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slug: "rust", userId: "u1" }),
    );
    logged.mockRestore();
  });
});
