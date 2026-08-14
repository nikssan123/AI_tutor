import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";

/**
 * Who marks a written answer in the anonymous Skill Check, and who does not.
 *
 * The check is the one surface in the product that spends money with nobody to
 * bill it to, so the decision *around* the model call carries as much weight as
 * the call. Every path that declines to spend has to land in the same place —
 * the learner marks themselves, and §7.2 refuses to count it — because that
 * fallback is not a degraded version of the feature, it is the honest older
 * one, and the result screen already distinguishes them.
 */

const anonymousBudgetSpent = vi.fn();
const logCall = vi.fn();
const gradeCheck = vi.fn();

vi.mock("@/lib/ai/runlog", () => ({
  anonymousBudgetSpent: (...args: unknown[]) => anonymousBudgetSpent(...args),
  logCall: (...args: unknown[]) => logCall(...args),
}));

vi.mock("@/lib/session/grade", () => ({
  gradeCheck: (...args: unknown[]) => gradeCheck(...args),
}));

const { BLANK_FEEDBACK, markOpenAnswer } = await import("@/lib/check/mark");

const db = { name: "db" } as unknown as Db;
const client = {} as Anthropic;

const request = {
  question: "Why does an outer join sometimes change the row count?",
  expected: "preserve unmatched rows with an outer join",
  answer: "Because unmatched rows on the preserved side come back as NULLs.",
};

/** What `logCall` returns is whatever the grader returned, logged. */
const graded = (value: { correct: boolean; feedback: string }) => {
  gradeCheck.mockResolvedValue({ status: "ok", value });
  logCall.mockImplementation(async (_db, _user, result: unknown) => result);
};

afterEach(() => {
  vi.clearAllMocks();
  anonymousBudgetSpent.mockReset();
  logCall.mockReset();
  gradeCheck.mockReset();
});

describe("markOpenAnswer", () => {
  it("marks a real answer and hands back the grader's own words", async () => {
    anonymousBudgetSpent.mockResolvedValue(false);
    graded({ correct: true, feedback: "You named the preserved side." });

    expect(
      await markOpenAnswer({ db: () => db, client }, request),
    ).toEqual({ correct: true, feedback: "You named the preserved side." });

    expect(gradeCheck).toHaveBeenCalledWith(client, request);
    // §14.8 — the run is logged against no user, which is what the cap counts.
    expect(logCall.mock.calls[0]![1]).toBeNull();
  });

  it("marks a blank answer wrong without paying anyone to say so", async () => {
    const marking = await markOpenAnswer({ db: () => db, client }, {
      ...request,
      answer: "   ",
    });

    expect(marking).toEqual({ correct: false, feedback: BLANK_FEEDBACK });
    expect(gradeCheck).not.toHaveBeenCalled();
    // Nine blank submissions in a row is the cheapest abuse of this surface
    // there is, and it costs nothing.
    expect(anonymousBudgetSpent).not.toHaveBeenCalled();
  });

  it("falls back to self-marking when there is no key", async () => {
    expect(await markOpenAnswer({ db: () => db, client: null }, request)).toBeNull();
    expect(anonymousBudgetSpent).not.toHaveBeenCalled();
  });

  it("stops spending when the day's budget is gone", async () => {
    anonymousBudgetSpent.mockResolvedValue(true);

    expect(await markOpenAnswer({ db: () => db, client }, request)).toBeNull();
    expect(gradeCheck).not.toHaveBeenCalled();
  });

  /**
   * §14.9.7 — "never silently overspend". A cap that cannot be read is not a
   * cap, so an unreachable database means no call rather than an uncounted one.
   * Failing towards self-marking is failing towards the cheaper and more
   * conservative claim.
   */
  it("spends nothing when the ledger cannot be read", async () => {
    anonymousBudgetSpent.mockRejectedValue(new Error("connection refused"));

    expect(await markOpenAnswer({ db: () => db, client }, request)).toBeNull();
    expect(gradeCheck).not.toHaveBeenCalled();
  });

  it("spends nothing when there is no database at all", async () => {
    // A marketing-only environment: `getDb()` throws, and the check has to keep
    // working rather than take the whole subject down.
    const factory = () => {
      throw new Error("DATABASE_URL is not set");
    };

    expect(await markOpenAnswer({ db: factory, client }, request)).toBeNull();
    expect(gradeCheck).not.toHaveBeenCalled();
  });

  /**
   * §4.2 law 1, at the smallest scale it appears anywhere: recording an
   * unreachable model as a correct answer would put mastery on the board with
   * nothing under it.
   */
  it("does not pass an answer the grader could not mark", async () => {
    anonymousBudgetSpent.mockResolvedValue(false);
    gradeCheck.mockResolvedValue({ status: "refused", detail: "no" });
    logCall.mockImplementation(async (_db, _user, result: unknown) => result);

    expect(await markOpenAnswer({ db: () => db, client }, request)).toBeNull();
  });

  it("does not pass an answer when the call itself threw", async () => {
    anonymousBudgetSpent.mockResolvedValue(false);
    gradeCheck.mockRejectedValue(new Error("network"));

    expect(await markOpenAnswer({ db: () => db, client }, request)).toBeNull();
  });
});
