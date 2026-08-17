import { cookies } from "next/headers";
import Link from "next/link";
import { PostHogClient } from "@/components/posthog-client";
import { Button } from "@/components/ui";
import { currentUser } from "@/lib/account/session";
import { setConsentAction } from "@/lib/consent/actions";
import {
  CONSENT_COOKIE,
  toConsent,
  type ConsentChoice,
} from "@/lib/consent/cookie";
import { posthogHost, posthogKey } from "@/lib/observability/posthog";

/**
 * Measurement, and the permission for it, in one file because they are one
 * decision. Splitting them is how a product ends up with a banner that asks
 * about a cookie the code sets regardless.
 *
 * Everything here renders on the server. The only piece that has to run in a
 * browser is the effect inside `PostHogClient`, and it is handed the answer as
 * a prop rather than reading the cookie itself — so there is exactly one place
 * that decides whether analytics runs.
 *
 * ## Why the reading and the rendering are separate exports
 *
 * `analyticsContext()` is async; `Analytics` is not. A layout awaits the first
 * and passes the result to the second. The obvious alternative — one async
 * component that reads its own cookie — nests an async component inside a tree
 * somebody else is rendering, which React only resolves in a real request and
 * which quietly renders *nothing* everywhere else. The first thing it broke was
 * the test asserting the app chrome draws its children at all.
 */

/** The answer, or `undefined` while the question is still unanswered. */
export async function readConsent(): Promise<ConsentChoice | undefined> {
  const jar = await cookies();
  return toConsent(jar.get(CONSENT_COOKIE)?.value);
}

export interface AnalyticsContext {
  /** Absent in development, and on any deploy with no analytics configured. */
  key: string | undefined;
  consent: ConsentChoice | undefined;
  /** The signed-in learner, looked up only once they have agreed to be counted. */
  userId: string | undefined;
}

/**
 * Read once per request, by the layout, and handed to everything that needs it.
 *
 * With no key there is nothing to consent to, so nothing else is even read: no
 * cookie, no session, no banner, no bundle. That is the state of every deploy
 * until a PostHog project exists, and of every developer's machine.
 */
export async function analyticsContext(): Promise<AnalyticsContext> {
  const key = posthogKey();
  if (!key) return { key: undefined, consent: undefined, userId: undefined };

  const consent = await readConsent();

  // Consent first, identity after. Not a saving — `currentSession` is memoized
  // and the header has already called it — but the shape of the rule is worth
  // keeping: we do not look up who you are in order to not measure you.
  const user = consent === "granted" ? await currentUser() : null;

  return { key, consent, userId: user?.id };
}

/**
 * The two buttons, on their own so the banner and `/privacy` cannot drift into
 * offering different choices.
 *
 * Equal weight, and that is a requirement rather than a taste: a consent prompt
 * whose "yes" is a filled button and whose "no" is a grey link is a prompt that
 * has answered itself. It also happens to be what §8.5.5 wants — one filled
 * button per screen, and it is never this one.
 */
export function ConsentChoices({ current }: { current?: ConsentChoice }) {
  return (
    <form
      action={setConsentAction}
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <Button
        type="submit"
        name="consent"
        value="granted"
        variant="social"
        aria-pressed={current === "granted"}
      >
        Allow
      </Button>
      <Button
        type="submit"
        name="consent"
        value="denied"
        variant="social"
        aria-pressed={current === "denied"}
      >
        No thanks
      </Button>
    </form>
  );
}

/**
 * The question, asked once.
 *
 * ## Why this exists at all, on a site that used to boast it did not need one
 *
 * Every other cookie here is doing a job the visitor asked for — staying signed
 * in, remembering a theme, holding a half-finished skill check — and none of
 * those needs permission. This one is for us. That is the line, and the honest
 * response to crossing it is to ask rather than to quietly reword the privacy
 * page.
 *
 * ## Why it is a form
 *
 * The marketing pages ship no framework JavaScript (§8.5.8). A banner that
 * needed a bundle before either button worked would be a consent prompt some
 * visitors could not answer — and an unanswerable prompt is worse than none,
 * because it sits there implying a choice.
 */
function ConsentBanner() {
  return (
    <div
      // `fixed`, so it never reflows the page it lands on — §13.3 budgets CLS
      // at 0.05 and a bar that pushes the fold down on arrival spends all of it.
      className="fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-surface"
      // A live region would announce itself over whatever the page is saying.
      // This is a standing offer, not an alert: findable by landmark, ignorable
      // until wanted.
      role="region"
      aria-label="Cookies"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[var(--measure)] text-[length:var(--text-label-size)] leading-[var(--text-lead-line)] text-ink-muted">
          One cookie, so we can see which subjects people finish and where the
          site loses them — plus a replay of where you click. Nothing you type
          is recorded, and once you&rsquo;re signed in the words on screen are
          blanked out too. No advertising, nothing sold.{" "}
          <Link href="/privacy" className="text-accent hover:underline">
            The detail
          </Link>
          .
        </p>
        <div className="shrink-0">
          <ConsentChoices />
        </div>
      </div>
    </div>
  );
}

/**
 * Loads PostHog for a visitor who said yes, and asks anyone who has not been
 * asked yet. Nothing at all for everybody else.
 *
 * Rendered by the marketing and app layouts. Deliberately *not* by `/admin`:
 * the people who run this product are not the funnel it is measured on, and a
 * replay of a staff member reading somebody's account is a recording nobody
 * asked for.
 */
export function Analytics({ context }: { context: AnalyticsContext }) {
  const { key, consent, userId } = context;
  if (!key) return null;

  return (
    <>
      <PostHogClient
        consent={consent}
        apiKey={key}
        apiHost={posthogHost()}
        userId={userId}
      />
      {consent ? null : <ConsentBanner />}
    </>
  );
}
