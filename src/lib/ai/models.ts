/**
 * §14.8 — model routing. "Never default everything to Opus."
 *
 * The plan names models by friendly name; these are the exact API ids the later
 * epics route to, recorded in one place so a model change is a single edit and
 * an `AgentRun` row can be traced back to a specific model.
 *
 * No client is constructed here and no call is made — E3 is the first epic that
 * needs one, and it needs ANTHROPIC_API_KEY to exist first.
 */
export const MODELS = {
  /** Classification, closed-item grading, routing, artefact ingest. */
  fast: "claude-haiku-4-5",
  /** Generation and tutoring: lessons, practice, tutor turns, reflections. */
  standard: "claude-sonnet-5",
  /** Evaluation, curriculum validation, pack authoring — §14.5's crown jewel. */
  deep: "claude-opus-5",
} as const;

export type ModelTier = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelTier];

/**
 * Whether a model accepts `thinking: {type: "adaptive"}` and
 * `output_config.effort`.
 *
 * Haiku 4.5 accepts neither and returns a 400 for both — it predates them. This
 * is not a preference to tune: a call to the fast tier that sends either
 * parameter fails outright, which is how it was found (a live call, not a
 * test double).
 */
export const SUPPORTS_ADAPTIVE_THINKING: Record<ModelId, boolean> = {
  "claude-opus-5": true,
  "claude-sonnet-5": true,
  "claude-haiku-4-5": false,
};

export function supportsAdaptiveThinking(model: string): boolean {
  return SUPPORTS_ADAPTIVE_THINKING[model as ModelId] ?? false;
}

/** §14.9.3 — which tier each step in the harness runs on. */
export const STEP_MODELS = {
  goalAnalyzer: "standard",
  diagnosticOpenItems: "standard",
  diagnosticSummary: "standard",
  skillGraphProjector: "standard",
  curriculumArchitect: "standard",
  curriculumValidator: "deep",
  resourceResearcher: "standard",
  lessonGenerator: "standard",
  tutor: "standard",
  artifactIngestor: "fast",
  rubricGrader: "deep",
  consistencyPass: "deep",
  coherenceCheck: "fast",
  reflectionAgent: "standard",
} as const satisfies Record<string, ModelTier>;

/**
 * §14.9.7 limit 1 — on breach of the per-user monthly cap, degrade Opus to
 * Sonnet before queueing, and queue before notifying. Never silently overspend.
 */
export function degrade(tier: ModelTier): ModelTier {
  return tier === "deep" ? "standard" : tier;
}
