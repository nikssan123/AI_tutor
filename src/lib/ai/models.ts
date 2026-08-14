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
  /**
   * §7.1's Generated tier. Authoring a skill graph for a subject nobody has
   * curated is the "pack authoring" this file's header already reserves the
   * deep tier for: every later step — the diagnostic, the planner, the
   * curriculum — reads the graph and cannot correct it, so it is the one place
   * in pack generation where a weaker model is a false economy. The item bank
   * and the rubrics are ordinary generation and run on standard.
   */
  packAuthor: "deep",
  packItems: "standard",
  packRubrics: "standard",
  diagnosticOpenItems: "standard",
  diagnosticSummary: "standard",
  skillGraphProjector: "standard",
  curriculumArchitect: "standard",
  curriculumValidator: "deep",
  resourceResearcher: "standard",
  lessonGenerator: "standard",
  tutor: "standard",
  /**
   * §14.2's first line — "Classification" is the fast tier's own job
   * description. Labelling one exchange into four values runs after the answer
   * has already streamed, so it is off the critical path as well as cheap.
   */
  tutorSignal: "fast",
  /**
   * §14.2 — "Assessment Agent: Haiku 4.5 *only* to grade free-text." §14.9.3's
   * cost table has no row for a session's recall checks, because it predates
   * there being a session to run; the routing rule it would follow is this one,
   * and a two-line recall answer is not work for the standard tier.
   */
  checkGrader: "fast",
  /**
   * §7.2 tier 3 — "multimodal rubric grading against technical criteria only".
   *
   * The standard tier rather than the fast one, and it is the only step in the
   * check that is not on Haiku. What this call does is *look at a photograph*
   * and say whether it demonstrates the thing that was asked for; the claim the
   * page then prints is that we marked it. A weaker eye would make that claim
   * cheaper and less true, which is the wrong direction on the one question
   * type that produces tier-3 evidence rather than talk about it.
   */
  checkPhotoGrader: "standard",
  artifactIngestor: "fast",
  rubricGrader: "deep",
  consistencyPass: "deep",
  coherenceCheck: "fast",
  reflectionAgent: "standard",
} as const satisfies Record<string, ModelTier>;

/**
 * §14.9.3's "Effort / thinking" column, which had never been read.
 *
 * The table gives extended thinking to exactly three steps and writes "none"
 * against every other. Sending it anyway is not free: a live lesson generation
 * on `high` took 40 seconds and cost 5.8c against the plan's $0.05 budget, for
 * a step whose output is four short fields. `null` means send no thinking
 * parameters at all.
 */
export const STEP_EFFORT = {
  goalAnalyzer: null,
  /**
   * Authoring a skill graph is reasoning about a whole subject at once — what
   * belongs in it, what genuinely depends on what — and it is done once per
   * pack and then read by everything. The item bank and the rubrics are
   * ordinary writing against a graph that has already been decided.
   */
  packAuthor: "high",
  packItems: null,
  packRubrics: null,
  diagnosticOpenItems: null,
  diagnosticSummary: null,
  skillGraphProjector: null,
  curriculumArchitect: null,
  curriculumValidator: "high",
  resourceResearcher: null,
  lessonGenerator: null,
  tutor: null,
  // Haiku rejects both thinking and effort outright (see above).
  tutorSignal: null,
  artifactIngestor: null,
  rubricGrader: "high",
  consistencyPass: "medium",
  coherenceCheck: null,
  checkGrader: null,
  checkPhotoGrader: null,
  reflectionAgent: null,
} as const satisfies Record<
  keyof typeof STEP_MODELS,
  "low" | "medium" | "high" | "xhigh" | "max" | null
>;

/**
 * §14.9.7 limit 1 — on breach of the per-user monthly cap, degrade Opus to
 * Sonnet before queueing, and queue before notifying. Never silently overspend.
 */
export function degrade(tier: ModelTier): ModelTier {
  return tier === "deep" ? "standard" : tier;
}
