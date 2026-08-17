import type { EnvLike } from "@/lib/env-types";
import { PosthogSink, posthogHost, posthogKey } from "./posthog";

/**
 * §14.8 / §25 — observability, wired from day one but requiring no accounts to
 * develop against.
 *
 * Each sink no-ops when its key is absent. That keeps §25's event names in code
 * from the first commit — which matters, because the day-60 kill-criteria review
 * (§17.3) depends on events having been recorded from launch, not added later
 * once someone noticed the funnel was unmeasurable.
 *
 * PostHog is the first of the three to become real. Sentry and Langfuse are
 * still `NoopSink`s, and the class stays for them rather than as scaffolding.
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
  /*
   * Monetization (§25.1).
   *
   * Named in the plan since it was written and absent from this union until
   * E13, because until E13 nothing could fire them. `quota_reached` is the
   * exception and is the one that matters most before there is any revenue: it
   * is the paywall actually being met, and §17.3's free→paid criterion is
   * unreadable without it.
   */
  | "paywall_viewed"
  | "checkout_started"
  | "subscription_created"
  | "quota_reached"
  | "subscription_cancelled"
  | "subscription_reactivated"
  /*
   * Referral (E14). `share_clicked` is §25.1's, under Acquisition; the rest are
   * this product's own funnel, one per state the `referral` row moves through,
   * so "invites sent" and "invites that produced a paying learner" are
   * different numbers rather than the same number told twice.
   */
  | "share_clicked"
  | "referral_link_created"
  | "referral_visit"
  | "referral_signup"
  | "referral_qualified"
  | "referral_rewarded"
  // Quality and cost
  | "agent_run"
  | "evaluation_verifier_failed"
  | "curriculum_validator_failed"
  | "content_quality_scored";

export type EventProperties = Record<string, string | number | boolean | null>;

/**
 * Who an event happened to.
 *
 * Optional, and passed rather than looked up, because half the call sites have
 * no request to look it up from — a Stripe webhook and an Inngest job both fire
 * events for an account nobody is currently sitting in front of. Where it is
 * the learner's id it is the same string `posthog.identify` sends from the
 * browser, which is what makes the two halves of a funnel one funnel: the
 * anonymous visit, the signup, and the first mark line up on one person.
 */
export interface Sink {
  readonly name: string;
  readonly enabled: boolean;
  capture(
    event: AnalyticsEvent,
    properties?: EventProperties,
    distinctId?: string,
  ): void;
}

/** Records events in memory. Used when no key is configured, and by tests. */
export class MemorySink implements Sink {
  readonly name = "memory";
  readonly enabled = true;
  readonly events: Array<{
    event: AnalyticsEvent;
    properties: EventProperties;
    distinctId?: string;
  }> = [];

  capture(
    event: AnalyticsEvent,
    properties: EventProperties = {},
    distinctId?: string,
  ): void {
    this.events.push({ event, properties, distinctId });
  }

  clear(): void {
    this.events.length = 0;
  }
}

/**
 * A sink that is configured but deliberately does nothing yet — Sentry and
 * Langfuse, which record that a key exists without pulling an SDK in behind it.
 * It also stands in for a sink whose key is absent, which is every one of them
 * on a developer's machine.
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
  const key = posthogKey(env);
  return [
    key
      ? new PosthogSink(key, posthogHost(env))
      : new NoopSink("posthog", false),
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
  distinctId?: string,
): void {
  for (const sink of getSinks()) {
    if (sink.enabled) sink.capture(event, properties, distinctId);
  }
}
