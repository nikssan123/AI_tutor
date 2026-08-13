import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { logCall, shouldDegrade, type SPEND_CAP_CENTS } from "@/lib/ai/runlog";
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
  plan?: keyof typeof SPEND_CAP_CENTS;
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
  const degraded =
    deps.userId !== null && deps.plan !== undefined
      ? await shouldDegrade(deps.db, deps.userId, deps.plan)
      : false;

  let attempts = 0;

  while (attempts < MAX_GENERATION_ATTEMPTS) {
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
