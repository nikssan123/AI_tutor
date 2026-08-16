/**
 * Why a submission was not marked, in a form the screen can say out loud.
 *
 * `evaluateHandler` has always passed a `reason` to its `fail` closure and the
 * closure has always thrown it away (`void reason`). So every failure looked
 * identical to the learner — "We couldn't mark this one", followed by an offer
 * to hand it in again — whether their page was empty, the brief had been
 * withdrawn from under them, or our marker had fallen over. One of those three
 * is their doing, one of them makes the offer to retry a lie, and none of them
 * was distinguishable.
 *
 * **A code is stored, never the sentence.** The reasons are composed deep in
 * the pipeline, at the point the cause is known, and one of them read `The
 * marker could not run (invalid)` — a `CallResult.status` spliced into a
 * sentence and shown to a person. Storing prose would have frozen that in the
 * database. A code keeps the copy here, where it can be rewritten for every row
 * ever written by changing one file, and makes it impossible for machinery to
 * reach a learner by accident: nothing is rendered that is not in this table.
 */

/**
 * The causes worth telling apart, which is fewer than the number of places a
 * marking can fail.
 *
 * The test is whether the learner would *do* something different, not whether
 * the code path differs. Two failures that mean "try again" are one cause, no
 * matter how far apart they are thrown.
 */
export const FAILURE_CAUSES = [
  /** Nothing in what they handed in. Caught before any model sees it. */
  "empty",
  /** The pack, project or rubric moved while the submission sat in the queue. */
  "brief_gone",
  /** The marker did not come back with something usable. Ours, not theirs. */
  "marker_unavailable",
  /** It came back, and none of it could be traced to the artefact. */
  "unverifiable",
] as const;

export type FailureCause = (typeof FAILURE_CAUSES)[number];

export interface FailureCopy {
  /** What happened, as a title. */
  title: string;
  /**
   * Why it happened, in their terms.
   *
   * **What to do next is not in here.** Every lead used to end with its own
   * version of "you can hand it in again", which is the sentence most likely to
   * be wrong and the one most likely to drift apart across four entries. It is
   * derived from `canRetry` at the point of rendering instead.
   */
  lead: string;
  /**
   * Whether handing the same work in again could plausibly work.
   *
   * Per-cause rather than always true, which is the change worth making: the
   * failed screen offered "You can hand it in again" to everybody, and for a
   * withdrawn brief that is an instruction to spend a second evaluation on a
   * submission guaranteed to fail in exactly the same way.
   */
  canRetry: boolean;
}

const COPY: Record<FailureCause, FailureCopy> = {
  empty: {
    title: "There was nothing to mark",
    lead: "What you handed in was empty, so there was nothing to judge against the rubric. Hand in the work itself — the query, the file, the writing.",
    canRetry: true,
  },
  brief_gone: {
    title: "This brief is no longer part of the course",
    lead: "The course changed while this was waiting to be marked, so there is no longer a rubric to mark it against. Open the brief from your plan and use the version that is there now.",
    canRetry: false,
  },
  marker_unavailable: {
    title: "Marking didn’t finish",
    lead: "Something on our side stopped partway through. This is ours to fix, and not a judgement about your work.",
    canRetry: true,
  },
  unverifiable: {
    title: "We couldn’t stand behind this marking",
    lead: "Nothing the marker said could be traced back to what you actually handed in. Rather than give you a grade we cannot show you the evidence for, we are giving you none.",
    canRetry: true,
  },
};

/**
 * The two things true of every failed submission, said once.
 *
 * Kept out of the per-cause leads so they cannot drift into four slightly
 * different promises. The second clause became true with `refundEvaluation`:
 * the meter is claimed at the button, and a marking that never happened now
 * gives it back — so this is a statement about their account rather than a
 * reassurance, and it would have been a lie a commit ago.
 */
export const FAILURE_CONSEQUENCE =
  "Nothing has been added to your record, and this has not used up one of your evaluations.";

/** Appended when, and only when, trying again is not a waste of their time. */
export const FAILURE_RETRY = "You can hand it in again.";

const UNKNOWN: FailureCopy = {
  title: "We couldn’t mark this one",
  lead: "Something went wrong that we have not seen before, so there is nothing more useful to tell you than that.",
  canRetry: true,
};

/**
 * Read back defensively, the same way `build-state` reads its phases.
 *
 * The column is `text`, so a row written by an older deployment — or by a
 * branch that added a cause this one has never heard of — can hold a word that
 * is not in the table above. That is not a reason to show a blank screen, and
 * `null` is the ordinary case rather than an error: every submission that
 * failed before this column existed has one.
 *
 * The fallback is deliberately the *retryable* copy. Being unable to name the
 * cause is not evidence that trying again is pointless, and of the two ways to
 * be wrong, telling somebody to stop when they could have carried on is the
 * one that costs them the work.
 */
export function failureCopy(cause: string | null): FailureCopy {
  return COPY[cause as FailureCause] ?? UNKNOWN;
}
