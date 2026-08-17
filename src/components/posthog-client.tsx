"use client";

import { useEffect } from "react";
import type { PostHog } from "posthog-js";
import type { ConsentChoice } from "@/lib/consent/cookie";
import { CONSENT_COOKIE_MAX_AGE } from "@/lib/consent/cookie";

/**
 * PostHog, loaded only for someone who said yes.
 *
 * ## Why the import is inside the effect
 *
 * `posthog-js` carries the session recorder, and it is the largest thing this
 * product would ship to a browser by some distance — §13.3's JavaScript budget
 * is already the one number in the plan we cannot meet. A static import puts it
 * in the first-load bundle of every page for every visitor, including the ones
 * who are about to decline it.
 *
 * A dynamic `import()` inside the effect makes it a separate chunk that is
 * requested at the moment consent is confirmed and never at any other time. A
 * visitor who says no, or who has not been asked yet, downloads nothing —
 * which is the difference between a consent prompt and a formality.
 *
 * ## Why the promise is module-level
 *
 * `client` is the initialised library, not a boolean. Every route change
 * re-runs the effect, and `??=` means the second one waits on the first
 * import rather than starting a second — and, more importantly, cannot call
 * `init` twice on a library that treats that as a reset.
 */

let client: Promise<PostHog> | null = null;

/** Who `client` has been told about, so an unchanged id is not re-sent. */
let identified: string | null = null;

/** Test seam: forget the loaded library, as a fresh page load would. */
export function resetPostHogForTests(): void {
  client = null;
  identified = null;
}

function load(apiKey: string, apiHost: string): Promise<PostHog> {
  client ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(apiKey, {
      api_host: apiHost,

      /*
       * A cookie, not localStorage — the library's default is both.
       *
       * This is the load-bearing line behind the promise on `/privacy`. A "no
       * thanks" is answered by a server action, and a server can delete a
       * cookie; it cannot reach into localStorage. Keeping the id in the one
       * store the server can see is what makes withdrawing consent actually
       * remove the thing consent was given for, rather than merely stop adding
       * to it. It is also what lets the privacy page list this cookie by name
       * and be telling the whole truth.
       */
      persistence: "cookie",
      // The id must not outlive the permission to hold it.
      cookie_expiration: CONSENT_COOKIE_MAX_AGE / (60 * 60 * 24),

      /*
       * A person record only once someone signs in. Anonymous reading of the
       * marketing pages is counted, but it is counted as traffic rather than
       * as a profile with a name waiting to be attached to it.
       */
      person_profiles: "identified_only",

      /*
       * The library watches `pushState` itself. Doing this by hand from a
       * `usePathname` effect was the obvious alternative and is worse: it
       * misses a navigation that changes only the query string, which on this
       * site is the monthly/yearly switch on `/pricing` — the one navigation
       * where knowing which view someone was looking at is the point.
       */
      capture_pageview: "history_change",
      capture_pageleave: true,

      session_recording: {
        /*
         * Nothing typed is ever recorded — not an email on the sign-in form,
         * not an answer to a skill check, not a word of the work being handed
         * in.
         */
        maskAllInputs: true,
        /*
         * And nothing *written* is either, anywhere inside the signed-in app.
         * `(app)/layout.tsx` marks its whole tree `data-private`, and rrweb
         * inherits masking down through children — so a replay of a session
         * screen shows where somebody clicked, scrolled and stalled, with the
         * lesson, their submission and the marking of it blanked out.
         *
         * The marketing pages are not marked, and are recorded as they look.
         * That is the half of the funnel a replay is actually for, and there
         * is nothing on those pages that is not already public.
         */
        maskTextSelector: "[data-private]",
      },
    });
    return posthog;
  });

  return client;
}

export interface PostHogClientProps {
  /** `undefined` until the visitor has answered the banner. */
  consent: ConsentChoice | undefined;
  /** Absent in development and on any deploy with no analytics configured. */
  apiKey: string | undefined;
  apiHost: string;
  /** The signed-in learner, if there is one. */
  userId: string | undefined;
}

/**
 * Renders nothing. It exists to hold the effect above, which is the only piece
 * of this that has to run in a browser.
 */
export function PostHogClient({
  consent,
  apiKey,
  apiHost,
  userId,
}: PostHogClientProps) {
  useEffect(() => {
    if (consent !== "granted" || !apiKey) return;

    void load(apiKey, apiHost).then((posthog) => {
      if (userId) {
        // Stitches the anonymous visit that came before signing in onto the
        // account it turned into — without which the funnel §17.3 is judged on
        // has a gap exactly where activation happens.
        if (identified !== userId) {
          identified = userId;
          posthog.identify(userId);
        }
        return;
      }

      /*
       * Signed out, having been signed in — so on a shared machine the next
       * person is a new anonymous visitor rather than a continuation of the
       * last one. `reset` mints a fresh id; it does not remove the cookie,
       * which is still consented to.
       */
      if (identified !== null) {
        identified = null;
        posthog.reset();
      }
    });
  }, [consent, apiKey, apiHost, userId]);

  return null;
}
