import type { EnvLike } from "@/lib/env-types";
import type { AnalyticsEvent, EventProperties, Sink } from "./index";

/**
 * The server half of §25's instrumentation.
 *
 * Two halves exist because two different things fire events. The browser sends
 * page views, clicks and the session replay, and it only does so for a visitor
 * who has said yes — see `posthog-client.tsx`. This is the other half: things
 * that happen to an *account* rather than on a device, and that no browser is
 * necessarily present for. A subscription created by a Stripe webhook and a
 * quota reached inside a Server Action are both facts about our own service,
 * recorded on our own server, with nothing stored on anybody's machine.
 *
 * That distinction is why this sink does not read the consent cookie. The
 * question the banner asks is the question ePrivacy actually poses — may we
 * keep something on your device — and this half keeps nothing. `/privacy` says
 * so in as many words rather than leaving the reader to infer it.
 */

/**
 * PostHog's European region, and the reason `/privacy` can tell readers their
 * analytics stays on European servers. Changing it changes that sentence.
 *
 * Both halves of the product talk to this host directly rather than through a
 * first-party `/ingest/*` rewrite. The rewrite is PostHog's own recommendation
 * and would survive ad-blockers, but it requires `skipTrailingSlashRedirect`,
 * which switches off Next's trailing-slash redirect for **every** route — and
 * §13.2 makes "no trailing slash, ever" a canonical guarantee with tests behind
 * it. Losing some blocked events is the cheaper of the two.
 */
export const POSTHOG_HOST_DEFAULT = "https://eu.i.posthog.com";

export function posthogKey(env: EnvLike = process.env): string | undefined {
  return env.NEXT_PUBLIC_POSTHOG_KEY || undefined;
}

export function posthogHost(env: EnvLike = process.env): string {
  const configured = env.NEXT_PUBLIC_POSTHOG_HOST;
  return (configured || POSTHOG_HOST_DEFAULT).replace(/\/+$/, "");
}

/**
 * The id used when an event has no person behind it — a referral link followed
 * by a stranger, a paywall drawn for a signed-out reader.
 *
 * PostHog requires *some* distinct id on every event, so the choice is not
 * whether to send one but whether to invent one per visitor. Sending a constant
 * alongside `$process_person_profile: false` is the documented way to say "this
 * happened, and there is no person to attach it to" — which is true, and which
 * keeps the person count from filling up with ghosts nobody can act on.
 */
export const ANONYMOUS_ACTOR = "server";

/** How long a fire-and-forget event may hold a socket before it is abandoned. */
const TIMEOUT_MS = 5_000;

export class PosthogSink implements Sink {
  readonly name = "posthog";
  readonly enabled = true;

  constructor(
    private readonly key: string,
    private readonly host: string,
    /** Injected so a test can assert the payload without a network. */
    private readonly send: typeof fetch = fetch,
  ) {}

  capture(
    event: AnalyticsEvent,
    properties: EventProperties = {},
    distinctId?: string,
  ): void {
    const body = JSON.stringify({
      api_key: this.key,
      event,
      distinct_id: distinctId ?? ANONYMOUS_ACTOR,
      properties: distinctId
        ? properties
        : { ...properties, $process_person_profile: false },
      timestamp: new Date().toISOString(),
    });

    /*
     * Not awaited, and never allowed to throw.
     *
     * Every call site is in the middle of doing something the learner asked
     * for — handing in work, starting a checkout. An analytics endpoint being
     * slow, unreachable or misconfigured must cost that nothing, so the request
     * is launched and forgotten and every failure is swallowed here rather than
     * surfacing as a 500 on a page that had already succeeded.
     */
    void (async () => {
      try {
        await this.send(`${this.host}/i/v0/e/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // See above. There is deliberately no log: a sink that shouts on every
        // dropped event turns one misconfigured key into pages of noise in the
        // one place someone is trying to read a real error.
      }
    })();
  }
}
