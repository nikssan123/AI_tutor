import type { Metadata } from "next";
import Link from "next/link";
import { JsonLdScript, PageFrame, PageIntro } from "@/components/marketing";
import { LegalSection, LEGAL_UPDATED, SupportLine } from "@/components/legal";
import { breadcrumbs } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * Written against what the product does today, which is why the money section
 * says there is no money. Terms describing a subscription that does not exist
 * would be the same failure as a privacy page describing an export button that
 * does not exist — a document that is technically about us and factually about
 * some other product.
 */
export const revalidate = 86_400;

export function generateMetadata(): Metadata {
  return marketingMetadata({
    title: "Terms",
    description:
      "What MeritKeep does, what it does not promise, who owns the work you submit, and what a mark from it is and is not. In plain language.",
    path: "/terms",
  });
}

export default function TermsPage() {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Terms", path: "/terms" },
  ];

  return (
    <>
      <JsonLdScript blocks={[breadcrumbs(crumbs)]} />

      <PageFrame crumbs={crumbs}>
        <PageIntro
          title="Terms"
          lead="What you get, what you owe us, and — more usefully — what a mark from this product is not. Written to be read rather than to be survived."
          facts={<SupportLine />}
        />

        <LegalSection title="What this is">
          <p>
            MeritKeep sets you real work, marks it against a checklist published
            before you start, and keeps a record of what you have demonstrably
            done. Using the site means agreeing to what is on this page.
          </p>
        </LegalSection>

        <LegalSection title="What a mark is, and is not">
          <p>
            This is the most important section and the one most likely to be
            skipped, so it is near the top.
          </p>
          <ul>
            <li>
              <strong>A mark is a model&rsquo;s judgement</strong> against a
              published checklist, checked by a second pass. It is not a
              qualification, a certification, or an accreditation, and nobody is
              obliged to accept it as one.
            </li>
            <li>
              <strong>It can be wrong.</strong> Every verdict is shown with the
              confidence behind it and the evidence it was drawn from, and you
              can dispute one. We would rather tell you we are 60% sure than
              round it up.
            </li>
            <li>
              <strong>We do not promise you a job, a grade or an outcome.</strong>{" "}
              Time estimates are estimates and the pace is yours.
            </li>
          </ul>
        </LegalSection>

        <LegalSection title="Your account">
          <p>
            One person per account, and a real email address so we can reach
            you. You are responsible for what happens under your sign-in. Tell
            us if you think somebody else is using it.
          </p>
        </LegalSection>

        <LegalSection title="The work you submit">
          <p>
            <strong>It stays yours.</strong> We do not claim ownership of
            anything you hand in, and we do not publish it. What you give us is
            permission to do the job you asked for: store it, send it to be
            marked, and show it back to you as the evidence behind a claim on
            your record.
          </p>
          <p>
            Hand in your own work. Submitting somebody else&rsquo;s as yours
            defeats the entire purpose of a product whose only output is a
            statement about what <em>you</em> can do — and it is the one thing
            here that we will close an account over.
          </p>
          <p>
            Do not upload anything unlawful, anything containing other
            people&rsquo;s personal data, or anything you do not have the right
            to share with us.
          </p>
        </LegalSection>

        <LegalSection title="Money">
          <p>
            There is none yet. MeritKeep is free while it is being built, and
            there is nothing to cancel. When paid plans arrive this page will
            say what they cost and what happens if you stop paying, before
            anyone is charged anything.
          </p>
        </LegalSection>

        <LegalSection title="Stopping">
          <p>
            You can stop at any time, and you can ask us to delete your account
            and everything attached to it — see{" "}
            <Link href="/privacy" className="text-accent">
              Privacy
            </Link>{" "}
            for how. We may suspend an account that is being used to attack the
            service or to submit other people&rsquo;s work.
          </p>
        </LegalSection>

        <LegalSection title="The service itself">
          <p>
            It is provided as it is. We work to keep it running and we do not
            guarantee it will be available at any given moment, or that a
            background marking job will always finish first time — if one fails
            it is retried, and you are told rather than left guessing.
          </p>
        </LegalSection>

        <LegalSection title="Changes">
          <p>
            Last updated {LEGAL_UPDATED}. If these terms change materially we
            will say so to anyone with an account rather than quietly editing
            the page.
          </p>
          <SupportLine />
        </LegalSection>
      </PageFrame>
    </>
  );
}
