import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { logCall, shouldDegrade } from "@/lib/ai/runlog";
import { degradesGeneration, type PlanId } from "@/lib/billing/catalog";
import type {
  CurriculumDraft,
  ValidatorReport,
} from "@/lib/contracts/curriculum";
import { factualSpotChecker, generateCurriculum, type ArchitectInput } from "./architect";
import { canonicalCurriculum, type CanonicalProject } from "./canonical";
import { applyRepairs, isRepairable } from "./repair";
import { runValidator, type SpotChecker, type ValidationInput } from "./validate";

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
}

export async function generateValidatedCurriculum(
  deps: GenerateDeps,
  input: ArchitectInput,
): Promise<GenerateOutcome> {
  const spotCheck = deps.spotCheck ?? factualSpotChecker(deps.client);

  const validationFor = (draft: CurriculumDraft): ValidationInput => ({
    draft,
    graph: input.graph,
    mastery: input.mastery,
    now: input.now,
    constraints: input.constraints,
    rubricCriteria: input.rubricCriteria,
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

    const result = await logCall(
      deps.db,
      deps.userId,
      await generateCurriculum(deps.client, input, { degraded }),
    );

    // A refusal or an unparseable draft is not something a repair can fix.
    if (result.status !== "ok") continue;

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
