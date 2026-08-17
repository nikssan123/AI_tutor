import type { Metadata } from "next";
import { ConsentChoices, readConsent } from "@/components/analytics";
import { JsonLdScript, PageFrame, PageIntro } from "@/components/marketing";
import { LegalSection, LEGAL_UPDATED, SupportLine } from "@/components/legal";
import { Meta } from "@/components/ui";
import { posthogKey } from "@/lib/observability/posthog";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * Every sentence here is a statement about what the code actually does, and
 * each one was checked against it rather than adapted from a template. Two
 * things were cut during that check because they are not built: self-serve data
 * export and self-serve account deletion, both of which §13 describes. Until
 * they exist, this page promises the manual route instead — which is a real
 * commitment somebody has to honour, not a smaller version of the same claim.
 *
 * The cookie list is the part that rots fastest, and it had: it named three
 * cookies at a point when the code set seven. It is now written from the
 * constants themselves — `mk_currency`, `mk_ref`, `verify_snooze`, `mk_consent`
 * — so that adding a cookie and not saying so takes a deliberate omission
 * rather than a lapse of memory.
 */
export const revalidate = 86_400;

export function generateMetadata(): Metadata {
  return marketingMetadata({
    title: "Privacy",
    description:
      "What MeritKeep stores, who else sees it, which cookies exist and why, and how to get a copy of your data or have it deleted. In plain language.",
    path: "/privacy",
  });
}

export default async function PrivacyPage() {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Privacy", path: "/privacy" },
  ];

  // Only offered where there is something to decide. With no analytics
  // configured there is no cookie to allow, and a switch for it would be a
  // control that does nothing — the same failure as a promised export button.
  const measurable = Boolean(posthogKey());
  const consent = measurable ? await readConsent() : undefined;

  return (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs)]} />

      <PageFrame crumbs={crumbs}>
        <PageIntro
          title="Privacy"
          lead="What we store, who else sees it, and what you can ask us to do about it. Short, because we do not do very much with it."
          facts={<SupportLine />}
        />

        <LegalSection title="What we store">
          <p>
            <strong>Your account.</strong> An email address, and a name if you
            give one. If you sign in with Google we receive your email address
            and name from Google; we never receive your Google password.
          </p>
          <p>
            <strong>Your learning.</strong> The goal you set and the answers you
            gave while setting it, your answers to skill checks, the work you
            submit, the marks and comments that work receives, and when your
            sessions happened. This is the product — without it there is nothing
            to show you.
          </p>
          <p>
            <strong>Nothing else.</strong> We never ask where you are, we do not
            build an advertising profile, and we do not buy or sell data about
            you. The one exception is worth stating rather than burying: if you
            allow the analytics cookie below, PostHog works out roughly where a
            visit came from the way every site does, from the connection it
            arrived on. That is the only sense in which anything here knows
            where you are, and it stops the moment you say no.
          </p>
        </LegalSection>

        <LegalSection title="Cookies">
          <p>
            All set by this site. None for advertising, and none of them tells
            anyone else where you have been.
          </p>
          <p>
            <strong>Seven that need no permission.</strong> Each is doing a job
            you asked for, and removing it breaks the thing you were trying to
            do.
          </p>
          <ul>
            <li>
              <strong>Sign-in.</strong> Keeps you signed in between pages.
            </li>
            <li>
              <strong>Theme.</strong> Remembers whether you chose light or dark.
            </li>
            <li>
              <strong>Skill check progress.</strong> Lets an anonymous check
              survive a reload, and lets the result follow you into an account
              if you make one. It holds your answers to that check and nothing
              else.
            </li>
            <li>
              <strong>Currency.</strong> Remembers which currency you asked to
              see prices in.
            </li>
            <li>
              <strong>Invite.</strong> Set only if you arrive through somebody
              else&rsquo;s invite link, so that if you sign up later they get
              the credit they were promised. It holds their code, not anything
              about you, and it is deleted the moment you make an account.
            </li>
            <li>
              <strong>Banner snooze.</strong> Set only if you close the
              &ldquo;confirm your email&rdquo; banner, so it stays closed for a
              week.
            </li>
            <li>
              <strong>Your answer to the question below.</strong> Yes or no,
              nothing else. We keep it so we only have to ask once.
            </li>
          </ul>
          <p>
            <strong>And one we ask about.</strong> Analytics is the only thing
            here stored for our benefit rather than yours, so it is the only
            thing we ask for. If you allow it, PostHog keeps one cookie holding
            a random id — not your name, not your email. If you say no, or if
            you have not answered, it is never set, and the code that would set
            it is never even downloaded.
          </p>
        </LegalSection>

        <LegalSection title="If you allow the analytics one">
          <p>
            We count page views and clicks, and we record a replay of the
            visit — where the pointer went, what was clicked, where somebody
            scrolled back and gave up. It is how we find the screen that loses
            people, which is not a thing anyone reports to us.
          </p>
          <p>
            <strong>What a replay never contains.</strong> Anything you type is
            blanked out before it leaves your browser — every field, on every
            page, including the work you hand in and anything you say to the
            tutor. So is all the text on every signed-in screen: a replay of a
            lesson, a submission or its marking shows the shape of the page and
            where you moved, and not one word of what was on it. The public
            pages are recorded as they look, because everything on them is
            already public.
          </p>
          <p>
            <strong>Changing your mind.</strong> Below, whenever you like.
            Saying no deletes the cookie in the same breath rather than merely
            stopping there from being more of it.
          </p>
          {measurable ? (
            <>
              <ConsentChoices current={consent} />
              <Meta>
                {consent === "granted"
                  ? "Right now: allowed."
                  : consent === "denied"
                    ? "Right now: not allowed."
                    : "You have not answered yet, so nothing is being measured in this browser."}
              </Meta>
            </>
          ) : (
            <p>
              Nothing is configured to receive any of this at the moment, so
              nothing is being measured and there is nothing to allow or refuse.
            </p>
          )}
        </LegalSection>

        <LegalSection title="If you say no">
          <p>
            Nothing is stored on your device, no replay is made, and PostHog
            never hears from your browser at all.
          </p>
          <p>
            We do still keep our own count of things that happen to an account
            on our servers — a session finished, a mark returned, a limit
            reached. That is our record of our own service rather than anything
            kept on your machine, it follows you nowhere else, and no advertiser
            ever sees it. We would rather say so plainly than let you find out
            that &ldquo;no&rdquo; had meant less than it sounded.
          </p>
        </LegalSection>

        <LegalSection title="Who else sees it">
          <p>
            Five companies, each for one job. None of them is an advertiser.
          </p>
          <ul>
            <li>
              <strong>Anthropic</strong> — the work you submit and the messages
              you send the tutor are sent to Anthropic&rsquo;s API to be marked
              or answered. This is how the product works; there is no version of
              it that does not do this.
            </li>
            <li>
              <strong>Resend</strong> — your email address, so we can send you
              email.
            </li>
            <li>
              <strong>Google</strong> — only if you choose to sign in with
              Google.
            </li>
            <li>
              <strong>Inngest</strong> — schedules the background work that
              marks a submission after you hand it in.
            </li>
            <li>
              <strong>PostHog</strong> — how the site is used: pages, clicks,
              and the replay described above. Only from your browser, and only
              if you allowed it. It goes to their European servers.
            </li>
          </ul>
          <p>
            <strong>Nobody else, and nothing is sold.</strong> If that ever
            changes, this page changes first and the date at the bottom moves
            with it.
          </p>
        </LegalSection>

        <LegalSection title="Getting a copy, or getting it deleted">
          <p>
            Email us and we will do it. There is no self-serve button for either
            yet, so we are saying plainly that it is a person doing it rather
            than implying an automatic process that does not exist.
          </p>
          <p>
            A copy comes back as a JSON file with everything above in it.
            Deletion removes your account and the learning record attached to
            it, and it cannot be undone.
          </p>
          <SupportLine />
        </LegalSection>

        <LegalSection title="How long we keep it">
          <p>
            While your account exists, and until you ask us to delete it. Work
            you submitted is kept because it is the evidence behind a claim on
            your record — a mark with no artefact attached is exactly the kind
            of unbacked progress this product exists to avoid.
          </p>
        </LegalSection>

        <LegalSection title="Changes">
          <p>
            This page was last updated on {LEGAL_UPDATED}. If we change what we
            do, we change this page first.
          </p>
        </LegalSection>
      </PageFrame>
    </>
  );
}
