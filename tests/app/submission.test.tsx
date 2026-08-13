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

const pack = findPack("photography")!;

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
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

const { default: SubmissionPage, confidenceLevel } = await import(
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
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeTruthy();
  });

  it("says nothing was recorded when marking failed", async () => {
    evaluationMock.mockResolvedValue(undefined);
    submissionMock.mockResolvedValue(stored({ status: "failed" }));

    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText(/Nothing has been added to your record/)).toBeDefined();
    // Nothing to wait for, so it stops refreshing.
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });

  it("leaves out the sections it has nothing for", async () => {
    evaluationMock.mockResolvedValue(evaluated({ gaps: [], nextActions: [] }));
    render(await SubmissionPage({ params: params() }));

    expect(screen.queryByText("What to fix, in order")).toBeNull();
    expect(screen.queryByText("Do next")).toBeNull();
  });

  it("falls back to a plain title when the brief has gone", async () => {
    submissionMock.mockResolvedValue(stored({ projectSlug: "deleted-brief" }));
    render(await SubmissionPage({ params: params() }));
    expect(screen.getByText("Your marked work")).toBeDefined();
  });
});

describe("confidenceLevel", () => {
  it("maps §7.2's ranges onto what the UI may claim", () => {
    expect(confidenceLevel(0.9)).toBe("high");
    expect(confidenceLevel(0.65)).toBe("medium");
    expect(confidenceLevel(0.2)).toBe("low");
  });
});
