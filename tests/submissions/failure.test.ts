import { describe, expect, it } from "vitest";
import {
  FAILURE_CAUSES,
  FAILURE_CONSEQUENCE,
  FAILURE_RETRY,
  failureCopy,
} from "@/lib/submissions/failure";

/**
 * The copy a failed submission is allowed to show.
 *
 * `fail` used to discard the reason it was handed, so every failure rendered
 * "We couldn't mark this one. Nothing has been added to your record. You can
 * hand it in again" — the same three sentences whether the page was empty, the
 * brief had been withdrawn from under them, or our own marker had fallen over.
 */

describe("failureCopy", () => {
  it("has copy for every cause the pipeline can store", () => {
    // The guard against a cause being added to the union and nowhere else,
    // which would silently render the unknown fallback in production.
    for (const cause of FAILURE_CAUSES) {
      const copy = failureCopy(cause);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.lead.length).toBeGreaterThan(0);
      expect(copy).not.toEqual(failureCopy("something-else-entirely"));
    }
  });

  it("falls back for a null cause, which every older row has", () => {
    // The column was added after these rows failed. `null` is the ordinary
    // case, not an error, and it must still produce a readable screen.
    expect(failureCopy(null).title).toBe("We couldn’t mark this one");
  });

  it("falls back for a cause it has never heard of", () => {
    // A row written by a newer deployment, read by this one. Rendering nothing
    // would be worse than rendering the generic apology.
    expect(failureCopy("invented_later")).toEqual(failureCopy(null));
  });

  it("assumes retrying is worth it when it cannot name the cause", () => {
    // Of the two ways to be wrong, telling somebody to stop when they could
    // have carried on is the one that costs them the work.
    expect(failureCopy(null).canRetry).toBe(true);
  });

  it("stops inviting a retry that cannot work", () => {
    // The whole reason `canRetry` is per-cause. A withdrawn brief has no rubric
    // left to mark against, so "hand it in again" is an instruction to spend a
    // second evaluation on a submission guaranteed to fail identically.
    expect(failureCopy("brief_gone").canRetry).toBe(false);

    const retryable = FAILURE_CAUSES.filter((c) => failureCopy(c).canRetry);
    expect(retryable).toEqual(["empty", "marker_unavailable", "unverifiable"]);
  });

  it("blames us, not the learner, when the failure is ours", () => {
    // §4.2 law 3 — a claim about our failure must not read as a claim about
    // their work. `invalid` used to reach this screen and reads as a verdict.
    expect(failureCopy("marker_unavailable").lead).toContain("our side");
    expect(failureCopy("unverifiable").lead).toContain(
      "cannot show you the evidence for",
    );
  });

  it("keeps the machinery out of every line it can render", () => {
    /*
     * The rule this file exists to hold. `The marker could not run (invalid)`
     * was a `CallResult.status` spliced into a sentence and shown to a person;
     * storing prose would have frozen that into the database for good.
     */
    const machinery = [
      "invalid",
      "refused",
      "schema",
      "null",
      "undefined",
      "error",
      "rubric_grader",
      "CallResult",
      "status",
      "submission row",
      "http",
    ];

    const rendered = [
      FAILURE_CONSEQUENCE,
      FAILURE_RETRY,
      ...[...FAILURE_CAUSES, null].flatMap((c) => [
        failureCopy(c).title,
        failureCopy(c).lead,
      ]),
    ];

    for (const line of rendered) {
      for (const word of machinery) {
        expect(line.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("says what it cost them, once, in words about their account", () => {
    // True only since `refundEvaluation`: the meter is claimed at the button
    // and a marking that never happened gives it back. It would have been a
    // lie a commit earlier, which is why it is asserted rather than assumed.
    expect(FAILURE_CONSEQUENCE).toContain("Nothing has been added to your record");
    expect(FAILURE_CONSEQUENCE).toContain("not used up one of your evaluations");

    // And it is not repeated inside the per-cause leads, where four copies
    // would drift into four slightly different promises.
    for (const cause of [...FAILURE_CAUSES, null]) {
      expect(failureCopy(cause).lead).not.toContain("your record");
      expect(failureCopy(cause).lead).not.toContain("hand it in again");
    }
  });
});
