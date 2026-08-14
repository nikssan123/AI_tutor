import type { Metadata } from "next";
import { JsonLdScript, PageFrame, PageIntro } from "@/components/marketing";
import { LegalSection, LEGAL_UPDATED, SupportLine } from "@/components/legal";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * Every sentence here is a statement about what the code actually does, and
 * each one was checked against it rather than adapted from a template. Two
 * things were cut during that check because they are not built: self-serve data
 * export and self-serve account deletion, both of which §13 describes. Until
 * they exist, this page promises the manual route instead — which is a real
 * commitment somebody has to honour, not a smaller version of the same claim.
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

export default function PrivacyPage() {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Privacy", path: "/privacy" },
  ];

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
            <strong>Nothing else.</strong> We do not collect your location, we
            do not build an advertising profile, and we do not buy or sell data
            about you.
          </p>
        </LegalSection>

        <LegalSection title="Cookies">
          <p>
            Three, all set by this site, none for advertising. We do not use a
            cookie banner because none of these requires consent — each one is
            doing a job you asked for.
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
          </ul>
        </LegalSection>

        <LegalSection title="Who else sees it">
          <p>
            Four companies, each for one job. None of them is an advertiser.
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
          </ul>
          <p>
            <strong>No third-party analytics currently receives anything.</strong>{" "}
            If that changes, this page changes with it and the date at the
            bottom moves.
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
