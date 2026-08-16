import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { logCall, shouldDegrade } from "@/lib/ai/runlog";
import { degradesGeneration, type PlanId } from "@/lib/billing/catalog";
import type {
  CurriculumDraft,
  ValidatorReport,
} from "@/lib/contracts/curriculum";
import type { PathBuildStage } from "./build-state";
import { factualSpotChecker, generateCurriculum, type ArchitectInput } from "./architect";
import { canonicalCurriculum, type CanonicalProject } from "./canonical";
import { applyRepairs, isRepairable } from "./repair";
import {
  runValidator,
  type CitedResource,
  type SpotChecker,
  type ValidationInput,
} from "./validate";

/**
 * §24 E6, end to end: generate, validate, repair, and fall back.
 *
 * §14.6 sets the policy — "fails closed: a failed check regenerates that
 * portion, and after 2 failures it falls back to the pack's canonical path" —
 * and this is that sentence as control flow. The learner is never shown an
 * unvalidated curriculum, and never shown nothing because a model had a bad
 * day.
 */

export type CurriculumSource = "generated" | "repaired" | "canonical" | "none";

export interface GenerateOutcome {
  /** Null only when the pack has too little left to teach to form a path. */
  draft: CurriculumDraft | null;
  /** Always the report for the draft above, never for a discarded attempt. */
  report: ValidatorReport | null;
  source: CurriculumSource;
  /** Repairs applied, phrased for the learner (§14.6 wants drops shown). */
  repairs: string[];
  /** Model generations attempted. Two is the cap (§14.6). */
  attempts: number;
}

/** §14.6 — "after 2 failures it falls back to the pack's canonical path". */
export const MAX_GENERATION_ATTEMPTS = 2;

export interface GenerateDeps {
  client: Anthropic;
  db: Db;
  /** Null for anonymous work; the run is still logged, nobody is billed. */
  userId: string | null;
  plan?: PlanId;
  /**
   * Whether this learner's plan includes a model-authored curriculum.
   *
   * Defaults to `true` so every existing caller — and every test — keeps the
   * behaviour it had. The one caller that knows about plans passes it.
   */
  aiCurriculum?: boolean;
  /** Overridable so tests need no model; defaults to the Opus adversarial pass. */
  spotCheck?: SpotChecker;
  projects?: CanonicalProject[];
  /**
   * §7.1's resource index for the pack being planned against, from
   * `citedResources`.
   *
   * §14.6's `resource_freshness` is the seventh of nine checks and it had never
   * run: nothing ever set this field, so it returned "no resources cited yet"
   * and the report counted a pass. Left unset it still does — a pack nobody has
   * researched has nothing to age out — but a pack that *has* been researched
   * now gets its citations checked rather than assumed.
   */
  resources?: CitedResource[];
  /**
   * Where the run has got to, for whoever is waiting on it.
   *
   * Optional because most callers are not being watched — a test, a script, the
   * validator's own fixtures — and a run nobody is waiting on owes nobody a
   * progress report. The queue passes one, and it writes the phase to the row
   * `/path` reads.
   *
   * Reported rather than derived: the alternative is a screen that guesses from
   * elapsed time, which is a bar that fills on a timer knowing nothing about
   * the run underneath it.
   */
  onStage?: (stage: PathBuildStage) => Promise<void>;
}

export async function generateValidatedCurriculum(
  deps: GenerateDeps,
  input: ArchitectInput,
): Promise<GenerateOutcome> {
  const spotCheck = deps.spotCheck ?? factualSpotChecker(deps.client);

  /** One place for "nobody is watching", rather than a `?.` at every phase. */
  const stage = async (reached: PathBuildStage): Promise<void> => {
    await deps.onStage?.(reached);
  };

  const validationFor = (draft: CurriculumDraft): ValidationInput => ({
    draft,
    graph: input.graph,
    mastery: input.mastery,
    now: input.now,
    constraints: input.constraints,
    rubricCriteria: input.rubricCriteria,
    resources: deps.resources,
  });

  // §14.9.7 limit 1 — "checked *before* every call", not after the bill lands.
  // Two reasons to drop a tier, and either is enough: the month's ceiling, or a
  // plan that does not include the deep tier at all (`degradesGeneration`).
  // A curriculum is a plan the learner can see, reject and regenerate, which is
  // why generation is degradable by price and marking is not.
  const degraded =
    deps.userId !== null && deps.plan !== undefined
      ? degradesGeneration(deps.plan) ||
        (await shouldDegrade(deps.db, deps.userId, deps.plan))
      : false;

  let attempts = 0;

  /*
   * §14.9.7 limit 1, and the largest single saving in the free tier.
   *
   * Curriculum generation is §20.2's dearest one-off at **$0.55** — more than a
   * third of a free month — and it is the one expensive thing whose output has
   * a genuine zero-cost alternative already sitting below this loop.
   * `canonicalCurriculum` is deterministic code over the skill graph; §14.9.5
   * already falls back to it after two failures, and §19.2 made exactly this
   * argument about the roadmap tool: "a roadmap for a subject we have is
   * arithmetic".
   *
   * So a plan without `aiCurriculum` does not attempt generation at all. It is
   * not a degraded path so much as a different, honest one — what the $0.55
   * actually buys is an order shaped around *this* learner's diagnostic rather
   * than the pack's default, which is a real thing to sell and a true sentence
   * to put on a pricing page.
   *
   * `attempts` stays 0, so `source: "canonical"` is reached with an attempt
   * count that says truthfully that nothing was tried.
   */
  const mayGenerate = deps.aiCurriculum ?? true;

  while (mayGenerate && attempts < MAX_GENERATION_ATTEMPTS) {
    attempts += 1;

    await stage("planning");

    const result = await logCall(
      deps.db,
      deps.userId,
      await generateCurriculum(deps.client, input, { degraded }),
    );

    // A refusal or an unparseable draft is not something a repair can fix.
    if (result.status !== "ok") continue;

    await stage("checking");

    const report = await runValidator(validationFor(result.value), spotCheck);
    if (report.passed) {
      return { draft: result.value, report, source: "generated", repairs: [], attempts };
    }

    if (isRepairable(report)) {
      const repaired = applyRepairs(result.value, report, input.graph);
      const recheck = await runValidator(validationFor(repaired.draft), spotCheck);

      if (recheck.passed) {
        return {
          draft: repaired.draft,
          report: recheck,
          source: "repaired",
          repairs: repaired.applied,
          attempts,
        };
      }
    }
  }

  /* ── Fall back (§14.9.5) ──────────────────────────────────────────────── */

  // Back to `planning`, and the screen watching this is meant to see it go
  // back. A second draft after a failed first one is what happened, and a
  // progress list that only ever moves forwards is one that has been asked to
  // flatter the run rather than report it.
  await stage("planning");

  const canonical = canonicalCurriculum({
    graph: input.graph,
    requiredSkillIds: input.goalSkillIds,
    mastery: input.mastery,
    now: input.now,
    rubricCriteria: input.rubricCriteria,
    projects: deps.projects,
  });

  if (canonical === null) {
    return { draft: null, report: null, source: "none", repairs: [], attempts };
  }

  await stage("checking");

  return {
    draft: canonical,
    // The canonical path is validated too. It is built to pass, but "built to
    // pass" and "passed" are different claims, and only one of them is checked.
    report: await runValidator(validationFor(canonical), spotCheck),
    source: "canonical",
    repairs: [],
    attempts,
  };
}
