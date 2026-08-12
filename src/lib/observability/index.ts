import type { EnvLike } from "@/lib/env-types";

/**
 * §14.8 / §25 — observability, wired from day one but requiring no accounts to
 * develop against.
 *
 * Each sink no-ops when its key is absent. That keeps §25's event names in code
 * from the first commit — which matters, because the day-60 kill-criteria review
 * (§17.3) depends on events having been recorded from launch, not added later
 * once someone noticed the funnel was unmeasurable.
 */

/** §25.1 — the activation event the whole product is measured on. */
export type AnalyticsEvent =
  // Acquisition
  | "page_viewed"
  | "tool_started"
  | "tool_completed"
  | "check_result_shown"
  | "cta_clicked"
  // Activation
  | "signup_started"
  | "signup_completed"
  | "goal_created"
  | "clarification_completed"
  | "diagnostic_started"
  | "diagnostic_completed"
  | "curriculum_generated"
  | "first_session_started"
  | "first_session_completed"
  | "first_submission_created"
  /** ← THE ACTIVATION EVENT (§25.1). Not signup. */
  | "first_evaluation_received"
  // Engagement
  | "session_started"
  | "session_completed"
  | "session_abandoned"
  | "retrieval_item_answered"
  | "submission_created"
  | "evaluation_received"
  | "evaluation_rated"
  | "evaluation_disputed"
  | "mastery_threshold_crossed"
  | "plan_adapted"
  // Quality and cost
  | "agent_run"
  | "evaluation_verifier_failed"
  | "curriculum_validator_failed"
  | "content_quality_scored";

export type EventProperties = Record<string, string | number | boolean | null>;

export interface Sink {
  readonly name: string;
  readonly enabled: boolean;
  capture(event: AnalyticsEvent, properties?: EventProperties): void;
}

/** Records events in memory. Used when no key is configured, and by tests. */
export class MemorySink implements Sink {
  readonly name = "memory";
  readonly enabled = true;
  readonly events: Array<{
    event: AnalyticsEvent;
    properties: EventProperties;
  }> = [];

  capture(event: AnalyticsEvent, properties: EventProperties = {}): void {
    this.events.push({ event, properties });
  }

  clear(): void {
    this.events.length = 0;
  }
}

/**
 * A sink that is configured but deliberately does nothing yet. PostHog, Sentry
 * and Langfuse all arrive in E13; until then this records that the key exists
 * without pulling three SDKs into the bundle.
 */
export class NoopSink implements Sink {
  constructor(
    readonly name: string,
    readonly enabled: boolean,
  ) {}

  capture(): void {
    /* intentionally empty — see class docstring */
  }
}

export function resolveSinks(env: EnvLike = process.env): Sink[] {
  return [
    new NoopSink("posthog", Boolean(env.NEXT_PUBLIC_POSTHOG_KEY)),
    new NoopSink("sentry", Boolean(env.SENTRY_DSN)),
    new NoopSink("langfuse", Boolean(env.LANGFUSE_PUBLIC_KEY)),
  ];
}

let sinks: Sink[] | undefined;

export function getSinks(): Sink[] {
  sinks ??= resolveSinks();
  return sinks;
}

/** Test seam. */
export function setSinks(next: Sink[] | undefined): void {
  sinks = next;
}

export function capture(
  event: AnalyticsEvent,
  properties?: EventProperties,
): void {
  for (const sink of getSinks()) {
    if (sink.enabled) sink.capture(event, properties);
  }
}
