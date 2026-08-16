// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { findPack } from "@/lib/content";
import type { EvaluationView, SubmissionDetail } from "@/lib/submissions/store";

/**
 * §8 screen 9 and the form that reaches it.
 *
 * The claim this screen makes is the product's whole pitch: every score is
 * anchored in the learner's own words. So the assertions here are about the
 * quote being on the page, and about the caveats travelling with the number.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const activeGoalMock = vi.fn();
const createSubmissionMock = vi.fn(async () => "sub-1");
const sendMock = vi.fn(async () => undefined);
const submissionMock = vi.fn(async () => undefined as unknown);
const evaluationMock = vi.fn(async () => undefined as unknown);
const entitlementsMock = vi.fn(async () => ({
  planId: "pro" as const,
  entitlements: { evaluationsPerMonth: 10, premiumModels: true },
  spendCapCents: 1_500,
  source: "plan" as const,
}));
const consumeMock = vi.fn(async () => ({ ok: true, used: 1, limit: 10 }));
const captureMock = vi.fn();
const nudgeMock = vi.fn(async (..._a: unknown[]) => undefined as unknown);
const routerRefreshMock = vi.fn();

const pack = findPack("photography")!;

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: routerRefreshMock }),
}));
// The poller is a client component that renders nothing, so what the page owes
// is that it is *there* while marking and gone once there is nothing to wait
// for. What it does when it is there is asserted against the real one below.
vi.mock("@/app/(app)/submission/[id]/poll-while-marking", () => ({
  PollWhileMarking: ({ seconds }: { seconds: number }) => (
    <div data-testid="poll-while-marking">every {seconds}s</div>
  ),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/packs/read", () => ({ packFromDb: async () => undefined }));
vi.mock("@/lib/goals/store", () => ({
  activeGoal: (...a: unknown[]) => activeGoalMock(...(a as [])),
}));
vi.mock("@/lib/submissions/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/submissions/store")>()),
  createSubmission: (...a: unknown[]) => createSubmissionMock(...(a as [])),
  submissionById: (...a: unknown[]) => submissionMock(...(a as [])),
  evaluationFor: (...a: unknown[]) => evaluationMock(...(a as [])),
}));
vi.mock("@/lib/inngest/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inngest/client")>()),
  inngest: { send: sendMock },
}));
vi.mock("@/lib/billing/store", () => ({
  entitlementsForUser: (...a: unknown[]) => entitlementsMock(...(a as [])),
}));
vi.mock("@/lib/billing/quota", () => ({
  consumeEvaluation: (...a: unknown[]) => consumeMock(...(a as [])),
  evaluationsUsed: async () => 0,
}));
// The result screen asks whether that was the learner's last graded project.
// Nothing here, so the nudge stays silent and these assertions stay about the
// verdict rather than about billing.
vi.mock("@/lib/billing/gate", () => ({
  nudgeAt: (...a: unknown[]) => nudgeMock(...(a as [])),
}));
vi.mock("@/lib/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability")>()),
  capture: (...a: unknown[]) => captureMock(...(a as [])),
}));

const { default: SubmissionPage } = await import(
  "@/app/(app)/submission/[id]/page"
);
const { submitWorkAction } = await import("@/app/(app)/submission/actions");
const { projectForBlock } = await import("@/lib/submissions/project");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const params = (id = "sub-1") => Promise.resolve({ id });

const project = pack.projects[0]!;
const skill = pack.skills.find((s) => project.targetSkills.includes(s.slug))!;

const stored = (over: Partial<SubmissionDetail> = {}): SubmissionDetail => ({
  id: "sub-1",
  userId: "u1",
  packSlug: "photography",
  projectSlug: project.slug,
  skillSlug: skill.slug,
  status: "complete",
  artefact: "the horizon sits on the lower third",
  truncated: false,
  submittedAt: new Date("2026-08-13T12:00:00.000Z"),
  failureCause: null,
  ...over,
});

const evaluated = (over: Partial<EvaluationView> = {}): EvaluationView => ({
  id: "ev-1",
  overall: 0.72,
  confidence: 0.81,
  evalTier: 2,
  criteria: [
    {
      criterionId: "framing",
      name: "Framing",
      band: "strong",
      evidence: "the horizon sits on the lower third",
      reasoning: "you placed it deliberately rather than by accident",
      weight: 1,
    },
  ],
  strengths: ["good instinct for light"],
  gaps: ["the background is doing nothing"],
  nextActions: ["reshoot with the background in mind"],
  verifierPassed: true,
  humanReviewed: false,
  createdAt: new Date("2026-08-13T12:01:00.000Z"),
  ...over,
});

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  activeGoalMock.mockResolvedValue({ packSlug: "photography" });
  submissionMock.mockResolvedValue(stored());
  evaluationMock.mockResolvedValue(evaluated());
});

afterEach(cleanup);

describe("projectForBlock", () => {
  it("finds the project that publishes the block's rubric", () => {
    expect(projectForBlock(pack, project.rubric, skill.slug)!.slug).toBe(
      project.slug,
    );
  });

  it("falls back to a project targeting the skill", () => {
    // A block composed before the pack put rubrics on its projects: a thin
    // pack, not a broken one.
    expect(projectForBlock(pack, null, skill.slug)).toBeDefined();
  });

  it("finds nothing when the pack has no project for that skill", () => {
    expect(projectForBlock(pack, null, "not-a-skill")).toBeUndefined();
  });
});

describe("handing work in", () => {
  it("stores the work and queues it to be marked", async () => {
    await expect(
      submitWorkAction(
        form({
          skill: skill.slug,
          rubric: project.rubric,
          work: "the horizon sits on the lower third",
          returnTo: "/session/s1",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/submission/sub-1");

    expect(createSubmissionMock).toHaveBeenCalledOnce();
    // Marking is two deep-tier calls; it cannot run inside the request.
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it("sends a signed-out visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(submitWorkAction(form({}))).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("goes back rather than filing an empty hand-in", async () => {
    await expect(
      submitWorkAction(
        form({ skill: skill.slug, work: "   ", returnTo: "/session/s1" }),
      ),
    ).rejects.toThrow("REDIRECT:/session/s1?error=empty");
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });

  it("does nothing when there is no brief to mark it against", async () => {
    await expect(
      submitWorkAction(
        form({ skill: "not-a-skill", work: "something", returnTo: "/session/s1" }),
      ),
    ).rejects.toThrow("REDIRECT:/session/s1");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("needs a goal to know which pack the work belongs to", async () => {
    activeGoalMock.mockResolvedValue(undefined);
    await expect(submitWorkAction(form({}))).rejects.toThrow("REDIRECT:/today");
  });

  it("needs the goal's pack to still exist", async () => {
    activeGoalMock.mockResolvedValue({ packSlug: "a-pack-that-went-away" });
    await expect(submitWorkAction(form({}))).rejects.toThrow("REDIRECT:/today");
  });

  it("treats a form with no rubric field as no rubric", async () => {
    // Falls through to the project targeting the skill, which is the thin-pack
    // case rather than a broken one.
    await expect(
      submitWorkAction(form({ skill: skill.slug, work: "the horizon sits low" })),
    ).rejects.toThrow("REDIRECT:/submission/sub-1");
    expect(createSubmissionMock).toHaveBeenCalledOnce();
  });

  it("treats a form with no fields at all as nothing to hand in", async () => {
    // Every field absent rather than empty: `formData.get` returns null, not "".
    await expect(submitWorkAction(form({}))).rejects.toThrow("REDIRECT:/today");
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });

  it("treats an absent work field as an empty hand-in", async () => {
    await expect(
      submitWorkAction(form({ skill: skill.slug, returnTo: "/session/s1" })),
    ).rejects.toThrow("REDIRECT:/session/s1?error=empty");
  });

  it("defaults its return to today when the form did not say", async () => {
    await expect(
      submitWorkAction(form({ skill: "not-a-skill", work: "x" })),
    ).rejects.toThrow("REDIRECT:/today");
  });

  describe("the evaluation quota (§14.9.7 limit 2)", () => {
    it("claims one against the plan's monthly allowance", async () => {
      await expect(
        submitWorkAction(
          form({ skill: skill.slug, work: "the horizon sits low" }),
        ),
      ).rejects.toThrow("REDIRECT:/submission/sub-1");

      // The limit comes from the resolved plan, not from a constant here.
      expect(consumeMock).toHaveBeenCalledWith(expect.anything(), "u1", 10);
    });

    it("refuses the hand-in when the month is spent", async () => {
      consumeMock.mockResolvedValueOnce({ ok: false, used: 1, limit: 1 });

      await expect(
        submitWorkAction(
          form({ skill: skill.slug, work: "the horizon sits low", returnTo: "/session/s1" }),
        ),
      ).rejects.toThrow("REDIRECT:/session/s1?error=quota");
    });

    it("files nothing and queues nothing when it refuses", async () => {
      // The point of claiming before the row: a submission that will not be
      // marked never becomes a queued row somebody has to explain later, and
      // the learner is told at the button rather than after 45 seconds.
      consumeMock.mockResolvedValueOnce({ ok: false, used: 1, limit: 1 });

      await expect(
        submitWorkAction(form({ skill: skill.slug, work: "the horizon sits low" })),
      ).rejects.toThrow("REDIRECT:/today?error=quota");

      expect(createSubmissionMock).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("records the paywall being met", async () => {
      // §17.3's free→paid criterion is unreadable without this event.
      consumeMock.mockResolvedValueOnce({ ok: false, used: 3, limit: 3 });

      await expect(
        submitWorkAction(form({ skill: skill.slug, work: "the horizon sits low" })),
      ).rejects.toThrow("REDIRECT:/today?error=quota");

      expect(captureMock).toHaveBeenCalledWith("quota_reached", {
        quota_type: "evaluation",
        used: 3,
        limit: 3,
      });
    });
  });
});

describe("the result screen", () => {
  it("sends a signed-out visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(SubmissionPage({ params: params() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("404s on a submission that is not the reader's", async () => {
    submissionMock.mockResolvedValue(undefined);
    await expect(SubmissionPage({ params: params() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("shows every score anchored in the learner's own words", async () => {
    /*
     * The product's whole pitch. A criterion whose quote could not be found in
     * the work was thrown out before it reached this page, so anything here is
     * quotable by construction — and the quote is on screen to prove it.
     */
    render(await SubmissionPage({ params: params() }));

    expect(screen.getByText("Framing")).toBeDefined();
    expect(
      screen.getByText("the horizon sits on the lower third"),
    ).toBeDefined();
    expect(screen.getByText(/placed it deliberately/)).toBeDefined();
    expect(screen.getByText("72%")).toBeDefined();
  });

  it("never shows the number without what it is worth (§7.2)", async () => {
    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText(/Tier 2 evidence/)).toBeDefined();
  });

  it("says when a person is checking it before it counts", async () => {
    submissionMock.mockResolvedValue(stored({ status: "human_review" }));
    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText(/rather be slow than wrong/)).toBeDefined();
  });

  it("discloses that long work was cut off", async () => {
    // §14.9.5 — truncation is disclosed on the evaluation, never silent.
    submissionMock.mockResolvedValue(stored({ truncated: true }));
    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText(/cut off/)).toBeDefined();
  });

  it("waits, and says so, while it is still being marked", async () => {
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(stored({ status: "grading" }));

    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText("Marking your work")).toBeDefined();
    // Polls without reloading — a full reload every few seconds blanked the
    // page, rebuilt the shell and reset the scroll, over and over, for the
    // whole minute a learner spends watching their work be marked.
    expect(screen.getByTestId("poll-while-marking")).toBeDefined();
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });

  it("still polls the old way with no JavaScript", async () => {
    // The enhancement is client-side; the fallback must not depend on it. The
    // tag is raw markup inside `<noscript>` because React hoists a `<meta>`
    // element into the head — where it would reload the page for everybody.
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(stored({ status: "grading" }));

    render(await SubmissionPage({ params: params() }));
    const fallback = document.querySelector("noscript");
    expect(fallback?.textContent).toContain('http-equiv="refresh"');
  });

  it("says nothing was recorded when marking failed", async () => {
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(stored({ status: "failed" }));

    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText(/Nothing has been added to your record/)).toBeDefined();
    // Nothing to wait for, so it stops looking.
    expect(screen.queryByTestId("poll-while-marking")).toBeNull();
    expect(document.querySelector("noscript")).toBeNull();
  });

  /*
   * Every failure used to read the same, because `fail` threw away the reason
   * it was given: "We couldn't mark this one. Nothing has been added to your
   * record. You can hand it in again" — whether the page was empty, the brief
   * had been withdrawn mid-queue, or our own marker had fallen over.
   */
  it("says which thing went wrong", async () => {
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(
      stored({ status: "failed", failureCause: "empty" }),
    );

    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText("There was nothing to mark")).toBeDefined();
    expect(screen.getByText(/Hand in the work itself/)).toBeDefined();
  });

  it("stops offering a retry that cannot work", async () => {
    // A withdrawn brief has no rubric left to mark against, so the old closing
    // line was an instruction to spend a second evaluation on a certain repeat.
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(
      stored({ status: "failed", failureCause: "brief_gone" }),
    );

    render(await SubmissionPage({ params: params() }));
    expect(
      screen.getByText("This brief is no longer part of the course"),
    ).toBeDefined();
    expect(screen.getByText(/Nothing has been added to your record/)).toBeDefined();
    expect(screen.queryByText(/You can hand it in again/)).toBeNull();
  });

  it("still offers a retry where one is worth making", async () => {
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(
      stored({ status: "failed", failureCause: "marker_unavailable" }),
    );

    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText(/You can hand it in again/)).toBeDefined();
  });

  it("reads an unrecognised cause as the generic apology", async () => {
    // Every row that failed before the column existed holds null, and a row
    // written by a newer deployment can hold a word this build never heard of.
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(
      stored({ status: "failed", failureCause: "from-the-future" }),
    );

    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText("We couldn’t mark this one")).toBeDefined();
    expect(screen.getByText(/You can hand it in again/)).toBeDefined();
  });

  it("says none of it while the work is still being marked", async () => {
    // The consequence line belongs to the failed branch only; on the waiting
    // screen it would be telling somebody their marking had cost them nothing
    // while it was still running.
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(stored({ status: "grading" }));

    render(await SubmissionPage({ params: params() }));
    expect(screen.queryByText(/Nothing has been added to your record/)).toBeNull();
  });

  it("leaves out the sections it has nothing for", async () => {
    evaluationMock.mockResolvedValue(evaluated({ gaps: [], nextActions: [] }));
    render(await SubmissionPage({ params: params() }));

    expect(screen.queryByText("What to fix, in order")).toBeNull();
    expect(screen.queryByText("Do next")).toBeNull();
    // The band that holds them goes too, rather than leaving a heading over
    // nothing.
    expect(screen.queryByText("What to do about it")).toBeNull();
  });

  /**
   * The two cards share a band and a grid row, so each has to stand on its own
   * — an evaluation that found gaps but had nothing to suggest next is a
   * normal outcome, not an empty half of a layout.
   */
  it("keeps the band for gaps alone", async () => {
    evaluationMock.mockResolvedValue(evaluated({ nextActions: [] }));
    render(await SubmissionPage({ params: params() }));

    expect(screen.getByText("What to do about it")).toBeDefined();
    expect(screen.getByText("What to fix, in order")).toBeDefined();
    expect(screen.queryByText("Do next")).toBeNull();
  });

  it("keeps the band for next actions alone", async () => {
    evaluationMock.mockResolvedValue(evaluated({ gaps: [] }));
    render(await SubmissionPage({ params: params() }));

    expect(screen.getByText("What to do about it")).toBeDefined();
    expect(screen.getByText("Do next")).toBeDefined();
    expect(screen.queryByText("What to fix, in order")).toBeNull();
  });

  it("falls back to a plain title when the brief has gone", async () => {
    submissionMock.mockResolvedValue(stored({ projectSlug: "deleted-brief" }));
    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText("Your marked work")).toBeDefined();
  });
});

describe("the moment after a verdict lands", () => {
  it("asks for the upgrade there, and only there", async () => {
    // §19.3 calls the first graded submission the activation event and calls
    // everything before it preamble. It is the only screen where the ask is
    // "more of what you just had" rather than "trust us".
    nudgeMock.mockResolvedValue({
      reason: "evaluation_landed",
      headline: "That was this month's graded project",
      body: "Pro marks ten a month against the same public rubrics.",
      cta: "See what Pro includes",
      href: "/pricing",
    });

    render(await SubmissionPage({ params: params() }));

    expect(
      screen.getByRole("heading", { name: "That was this month's graded project" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "See what Pro includes" }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("stays silent when there is allowance left", async () => {
    // `nudgeAt` returns nothing unless that was their last one, so the screen
    // needs no opinion of its own about when to sell.
    nudgeMock.mockResolvedValue(undefined);
    render(await SubmissionPage({ params: params() }));

    expect(screen.queryByRole("link", { name: /Pro/ })).toBeNull();
  });

  it("asks after the verdict, never before it", async () => {
    // Somebody reading their own marked work should finish reading it.
    nudgeMock.mockResolvedValue({
      reason: "evaluation_landed",
      headline: "That was this month's graded project",
      body: "…",
      cta: "See what Pro includes",
      href: "/pricing",
    });

    const { container } = render(await SubmissionPage({ params: params() }));
    const text = container.textContent ?? "";

    expect(text.indexOf("the horizon sits on the lower third")).toBeLessThan(
      text.indexOf("That was this month's graded project"),
    );
  });

  it("says nothing on a submission that was never marked", async () => {
    // Rule 3: never trade on our own failure.
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(stored({ status: "failed" }));

    render(await SubmissionPage({ params: params() }));
    expect(nudgeMock).not.toHaveBeenCalled();
  });
});

/**
 * The poller itself — the real one, not the stub the page test uses.
 *
 * It replaced `<meta http-equiv="refresh">`, which reloaded the whole document
 * every few seconds while a learner watched their work being marked: the page
 * blanked, the shell was rebuilt and the scroll reset, repeatedly, for the
 * minute or so that marking takes.
 */
describe("polling while the work is marked", () => {
  it("asks the server again on the interval, without reloading", async () => {
    vi.useFakeTimers();
    const { PollWhileMarking } = await vi.importActual<
      typeof import("@/app/(app)/submission/[id]/poll-while-marking")
    >("@/app/(app)/submission/[id]/poll-while-marking");

    const { unmount } = render(<PollWhileMarking seconds={5} />);
    expect(routerRefreshMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(routerRefreshMock).toHaveBeenCalledTimes(3);

    // And it stops when the page does. An interval left running after the
    // marked screen arrives is a refresh loop nothing is waiting for.
    unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(routerRefreshMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
