import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { logCall, shouldDegrade } from "@/lib/ai/runlog";
import { degradesGeneration, type PlanId } from "@/lib/billing/catalog";
import type {
  DraftItem,
  DraftResource,
  PackGraphDraft,
} from "@/lib/contracts/pack";
import type { BuildStage } from "../build";
import type { DomainPack } from "../types";
import type { ValidationReport } from "../validate";
import { checkDrafts, type LinkCheckDeps } from "../resources";
import { assemblePack, meetsQualityFloor } from "./assemble";
import { skillRef } from "./derive";
import { generatePackGraph } from "./graph";
import { batchSkills, generateItems, type RefSkill } from "./items";
import { generateResources } from "./resources";
import { generateRubrics } from "./rubrics";

/**
 * §7.1's Generated tier, end to end: author, assemble, validate, or fail
 * honestly.
 *
 * The shape mirrors `curriculum/generate.ts` with one deliberate difference.
 * Curriculum generation falls back to the pack's canonical path after two
 * failures (§14.9.5), because a pack always has one. A subject nobody has
 * curated has no canonical anything to fall back to — so this fails, and says
 * so, rather than handing over a pack it does not believe in. A learner told
 * "we could not build this well enough, here is what we do cover" is being
 * treated honestly; a learner given eleven skills and four questions is not.
 */

export type PackSource = "generated" | "none";

export interface PackOutcome {
  /** Null whenever `source` is "none". */
  pack: DomainPack | null;
  report: ValidationReport | null;
  source: PackSource;
  /** Pieces removed during assembly, phrased for a human (§14.6 shows drops). */
  dropped: string[];
  /** Why it failed, when it did. Empty on success. */
  reasons: string[];
  attempts: number;
}

/** Two attempts, the same cap §14.6 puts on curriculum generation. */
export const MAX_PACK_ATTEMPTS = 2;

/**
 * Skills paired with the reference later calls quote back, by position in the
 * graph. Assigned once, before batching, so `s7` means the same skill in every
 * call and in `assemblePack` — see `skillRef` for why names do not work.
 */
export function withRefs(graph: PackGraphDraft): RefSkill[] {
  return graph.skills.map((skill, i) => ({ ref: skillRef(i), skill }));
}

export interface PackGenerateDeps {
  client: Anthropic;
  db: Db;
  /** Null for system-initiated work; the run is still logged, nobody is billed. */
  userId: string | null;
  plan?: PlanId;
  /** The link checker's seam. Defaults to the real `fetch` and the real clock. */
  linkCheck?: LinkCheckDeps;
  /**
   * Called as the run enters each phase, so somebody waiting can be told where
   * it is. Optional, and awaited rather than fired off: a script or a test has
   * nobody watching, and the run must not depend on this succeeding — see
   * `markBuildStage`, which is what the queue passes in.
   */
  onStage?: (stage: BuildStage) => Promise<void>;
}

export interface PackGenerateInput {
  /** The slug the pack will live under. Checked as free by the caller. */
  slug: string;
  subject: string;
  rawGoal: string | null;
}

/**
 * The item bank, gathered a batch at a time.
 *
 * A batch that fails is skipped rather than aborting the pack: the bank is
 * additive, and losing one area's questions is a thinner pack, which the
 * quality floor will judge on the whole. Losing the run would waste the graph
 * call, which is the expensive one.
 */
async function gatherItems(
  deps: PackGenerateDeps,
  graph: PackGraphDraft,
  subject: string,
  degraded: boolean,
): Promise<DraftItem[]> {
  const batches = batchSkills(
    withRefs(graph).filter(({ skill }) => !skill.selfReportOnly),
  );

  const results = await Promise.all(
    batches.map(async (skills) =>
      logCall(
        deps.db,
        deps.userId,
        await generateItems(deps.client, { subject, skills }, { degraded }),
      ),
    ),
  );

  return results.flatMap((r) => (r.status === "ok" ? r.value.items : []));
}

/**
 * Rewrites a reading list's skill references as skill *names*, so it can
 * outlive the graph it was written against.
 *
 * This is what makes carrying the list across a retry safe, and skipping it
 * would be a silent correctness bug rather than a missed optimisation.
 * `skillRef` is deliberately positional — `s0`, `s1`, `s2`, opaque so a model
 * cannot "tidy" it — and `assemblePack` resolves those refs against the graph
 * *it* is assembling. A second attempt re-authors the graph from scratch, so
 * `s7` still resolves, just to a different skill: the pack would ship with
 * reading material attached to the wrong skills, and nothing would flag it,
 * because a ref that resolves is indistinguishable from a ref that resolves
 * correctly.
 *
 * Names survive that, because `nameResolver` takes them: exact match first,
 * then `slugify` for the punctuation a model tidies. A skill the new graph
 * simply does not have resolves to nothing and the resource is dropped with
 * the reason already written for it — "covers no skill this pack contains".
 *
 * Done once, when the list is first cached rather than when it is reused, so
 * what is carried is always name-shaped and re-carrying it cannot double-map.
 */
export function retargetResources(
  resources: DraftResource[],
  graph: PackGraphDraft,
): DraftResource[] {
  const nameAt = new Map(
    graph.skills.map((skill, i) => [skillRef(i), skill.name]),
  );

  return resources.map((resource) => ({
    ...resource,
    // A ref this graph has no skill for is dropped here rather than carried as
    // a string the next resolver would fail on anyway.
    skills: resource.skills.flatMap((ref) => {
      const name = nameAt.get(ref);
      return name ? [name] : [];
    }),
  }));
}

export async function generatePack(
  deps: PackGenerateDeps,
  input: PackGenerateInput,
): Promise<PackOutcome> {
  // §14.9.7 limit 1 — checked before the first call, not after the bill lands.
  // As in `curriculum/generate.ts`: the month's ceiling, or a plan without the
  // deep tier. Authoring a pack is generation, so price may degrade it.
  const degraded =
    deps.userId !== null && deps.plan !== undefined
      ? degradesGeneration(deps.plan) ||
        (await shouldDegrade(deps.db, deps.userId, deps.plan))
      : false;

  let attempts = 0;
  let reasons: string[] = [];
  // Carried out of the loop rather than reset with it: when a pack fails the
  // quality floor, *what was dropped* is the whole explanation, and throwing it
  // away leaves "7 items" with no way to find out why.
  let dropped: string[] = [];
  /*
   * The reading list, once any attempt has one, in name form.
   *
   * The one thing worth keeping across a retry — see the `Promise.all` below
   * for why it is skipped rather than re-bought, and `retargetResources` for
   * why what is kept is names rather than the refs the model returned.
   */
  let carried: DraftResource[] | null = null;

  while (attempts < MAX_PACK_ATTEMPTS) {
    attempts += 1;

    /*
     * Reported per attempt rather than once, so a second attempt visibly starts
     * again from the graph. It is the truth — the retry re-authors everything —
     * and a screen that quietly held at "checking" through a rewrite would be
     * claiming the first attempt's work still counted for something.
     */
    await deps.onStage?.("graph");

    const graph = await logCall(
      deps.db,
      deps.userId,
      await generatePackGraph(
        deps.client,
        { subject: input.subject, rawGoal: input.rawGoal },
        { degraded },
      ),
    );

    if (graph.status !== "ok") {
      reasons = [`the skill graph could not be written (${graph.status})`];
      continue;
    }

    // The bank, the rubrics and the reading list do not depend on each other,
    // and all three depend only on the graph, so they are asked for together.
    // One stage covers all three: they finish in whatever order the models
    // answer, so reporting them separately would report a race.
    await deps.onStage?.("writing");

    /*
     * `.then(logCall)` rather than `logCall(db, userId, await …)`, and the
     * difference is the whole point: **the previous shape did not run these in
     * parallel at all.**
     *
     * Array elements evaluate left to right, so an `await` written *inside* the
     * literal suspends the function before the next element is even
     * constructed. `generateRubrics` ran to completion, and only then did
     * `generateResources` start — `Promise.all` received three already-settled
     * or already-running promises and had nothing left to overlap. Only
     * `gatherItems` was ever concurrent, because it is the one element that was
     * not awaited inline.
     *
     * The run that exposed it is unambiguous: rubrics finished at 22:53:28.502
     * and the reading list's 285,681ms latency puts its start at 22:53:28.5 —
     * the same instant, back to back. Two of the three calls in a fan-out
     * written to be a fan-out were a queue, costing the longer of them in wall
     * clock on every attempt.
     */
    const [items, rubrics, researched] = await Promise.all([
      gatherItems(deps, graph.value, input.subject, degraded),
      generateRubrics(
        deps.client,
        { subject: input.subject, skills: withRefs(graph.value) },
        { degraded },
      ).then((result) => logCall(deps.db, deps.userId, result)),
      /*
       * Skipped outright when a previous attempt already found one.
       *
       * The reading list is the most expensive call in the pipeline (46¢, and
       * nearly five minutes of the fifteen the wait screen allows) and the only
       * one whose output does not depend on the graph being re-authored — it is
       * material about the *subject*, and the subject did not change. Paying
       * for it again on every retry was most of what made two attempts
       * impossible to fit inside `BUILD_TIMEOUT_MINUTES`.
       */
      carried
        ? null
        : generateResources(
            deps.client,
            { subject: input.subject, skills: withRefs(graph.value) },
            { degraded },
          ).then((result) => logCall(deps.db, deps.userId, result)),
    ]);

    /*
     * Cached before the rubrics are judged, not after.
     *
     * The reading list has already been bought by this point, and the two calls
     * have nothing to do with each other — so letting a rubrics failure carry
     * it out of scope would throw away the most expensive result in the run
     * over an unrelated one, and buy it again on the next attempt. In name form
     * the moment it arrives; see `retargetResources` for why the refs cannot be
     * what travels.
     */
    if (researched?.status === "ok") {
      carried = retargetResources(researched.value.resources, graph.value);
    }

    if (rubrics.status !== "ok") {
      reasons = [`the rubrics could not be written (${rubrics.status})`];
      continue;
    }

    /*
     * A failed search is a thinner pack, not a failed one — the same call the
     * item batches make. Resources are additive: nothing in the diagnostic, the
     * planner or the grader reads them, so a pack without them teaches exactly
     * what it would have taught anyway and simply cannot point anywhere else.
     * Failing the whole run here would throw away the graph, which is the
     * expensive call, over the cheap one.
     *
     * The link check is where the money already spent gets its value: it is the
     * difference between a list of URLs a model produced and a list of pages
     * that answered. Every one of them is checked before assembly, so a pack is
     * never written carrying a citation we have not tried.
     */
    // Fetching every cited page and then validating the assembly. The one
    // phase that is honest work rather than a model call, and the one the
    // learner is most owed a name for: it is where the wait stops looking like
    // it is only about waiting for a model.
    await deps.onStage?.("checking");

    // Re-checked every attempt even when the list is carried: a link that
    // answered four minutes ago is not a link that answers now, and the whole
    // value of this phase is that a shipped citation was actually tried.
    const resources = carried
      ? await checkDrafts(carried, deps.linkCheck)
      : [];

    // Built fresh per attempt and combined at the end, so `dropped` keeps
    // saying what the *last* attempt lost rather than accumulating every
    // attempt's losses into one list nobody can read.
    const researchDrops = carried
      ? []
      : [
          // `researched` is only null when the call was skipped, and it is only
          // skipped when a list was already carried — so this branch always has
          // a real outcome to report.
          `no reading list — the research call ${
            researched?.status === "refused"
              ? "was declined"
              : "returned nothing usable"
          }`,
        ];

    const assembled = assemblePack({
      slug: input.slug,
      graph: graph.value,
      items,
      rubrics: rubrics.value,
      resources,
    });
    dropped = [...researchDrops, ...assembled.dropped];

    /*
     * Assembly produced nothing the schema accepts. This used to be a throw
     * that left the function entirely, so the queue saw a *step* failure and
     * retried the whole pipeline — a deterministic error charged for three
     * times. It is an attempt that failed, which is what this loop is for.
     */
    if (!assembled.pack || !assembled.report) {
      reasons = assembled.reasons;
      continue;
    }

    // One gate: the validator's blocking issues and the generator's own floor.
    // A repair step would have nothing to do — every repairable case is already
    // handled in assembly — so a failure here is worth a fresh attempt.
    const floor = meetsQualityFloor(assembled.pack, assembled.report);
    if (!floor.passed) {
      reasons = floor.reasons;
      continue;
    }

    return {
      pack: assembled.pack,
      report: assembled.report,
      source: "generated",
      // The combined list, not `assembled.dropped`: a pack that shipped without
      // a reading list because the search was declined has lost something, and
      // a drop log that only covered assembly would show a pack with no
      // resources and no reason — indistinguishable from a subject nobody had
      // anything to recommend for.
      dropped,
      reasons: [],
      attempts,
    };
  }

  return { pack: null, report: null, source: "none", dropped, reasons, attempts };
}
