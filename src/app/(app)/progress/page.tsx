import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { digestFor } from "@/lib/mastery/view";
import {
  Button,
  Card,
  DisplayTitle,
  EmptyState,
  Lead,
  Meta,
  stagger,
  Status,
  Title,
} from "@/components/ui";

/**
 * §8 screen 11 — the weekly digest, for "weekly re-motivation and honest
 * recalibration".
 *
 * Five things and no more (§8.5.1's density rule): the hours against the
 * commitment, what moved, what was handed in, what is slipping, and how long
 * the rest looks from here. The recalibration is the second estimate — the same
 * remaining work priced at the pace actually kept rather than the one intended,
 * which is the number nobody else in this category will show you.
 *
 * No percentage anywhere, here either.
 */
export const metadata: Metadata = {
  title: "Your week",
  robots: { index: false, follow: false },
};

function hours(value: number): string {
  return `${value} ${value === 1 ? "hour" : "hours"}`;
}

function weeks(value: number): string {
  return `${value} ${value === 1 ? "week" : "weeks"}`;
}

export default async function ProgressPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const view = await digestFor(getDb(), session.user.id, new Date());

  if (!view) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        <DisplayTitle>Your week</DisplayTitle>
        <Card>
          <EmptyState message="You don't have a goal yet. Once you do, this is where each week gets an honest read." />
        </Card>
        <div>
          <Link href="/start">
            <Button>Set a goal</Button>
          </Link>
        </div>
      </main>
    );
  }

  const { digest } = view;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="rise flex flex-col gap-3">
        <DisplayTitle>The last seven days</DisplayTitle>
      </header>

      {/* ── Hours against the commitment ─────────────────────────────────── */}
      <Card className="rise flex flex-col gap-3" style={stagger(1)}>
        <Title className="text-[length:var(--text-label-size)]">Time</Title>
        <Lead className="text-ink">
          {hours(digest.hoursLogged)} of the {hours(digest.committedHours)} you
          set aside
          {digest.sessions > 0
            ? `, across ${digest.sessions} ${digest.sessions === 1 ? "session" : "sessions"}`
            : ""}
          .
        </Lead>
        {digest.keptCommitment ? (
          <Status tone="verified">You did what you said you would</Status>
        ) : (
          <Status tone="attention">Short of what you planned</Status>
        )}
      </Card>

      {/* ── What moved, and what was handed in ───────────────────────────── */}
      <Card className="rise flex flex-col gap-3" style={stagger(2)}>
        <Title className="text-[length:var(--text-label-size)]">
          What changed
        </Title>
        {digest.moved.length > 0 ? (
          <ul className="flex list-none flex-col gap-2 p-0 m-0">
            {digest.moved.map((move) => (
              <li key={move.name}>{move.name}</li>
            ))}
          </ul>
        ) : (
          <Meta tone="muted">
            Nothing moved. Mastery only moves on work we can mark.
          </Meta>
        )}
        <Meta>
          {digest.artefacts > 0
            ? `${digest.artefacts} ${digest.artefacts === 1 ? "piece" : "pieces"} of work handed in`
            : "Nothing handed in"}
        </Meta>
      </Card>

      {/* ── Retention health ─────────────────────────────────────────────── */}
      <Card className="rise flex flex-col gap-3" style={stagger(3)}>
        <Title className="text-[length:var(--text-label-size)]">
          Holding on to it
        </Title>
        {digest.tracked > 0 ? (
          <>
            <Lead className="text-ink">
              {digest.tracked} {digest.tracked === 1 ? "skill" : "skills"} you
              have shown.{" "}
              {digest.slipping > 0
                ? `${digest.slipping} of them ${digest.slipping === 1 ? "is" : "are"} starting to slip.`
                : "None of them are slipping."}
            </Lead>
            {digest.slipping > 0 ? (
              <Link
                href="/mastery?show=left"
                className="w-fit font-[550] text-accent underline-offset-4 hover:underline"
              >
                See which
              </Link>
            ) : null}
          </>
        ) : (
          <Meta tone="muted">
            Nothing to hold on to yet — this fills up as you show what you can
            do.
          </Meta>
        )}
      </Card>

      {/* ── The revised estimate ─────────────────────────────────────────── */}
      <Card className="rise flex flex-col gap-3" style={stagger(4)}>
        {/* Not "What's left": that is the name of a list of skills on
            /mastery, and one label for two different things is how a product
            teaches people to distrust its words. */}
        <Title className="text-[length:var(--text-label-size)]">
          What&rsquo;s ahead
        </Title>
        <Lead className="text-ink">
          About {hours(digest.remainingHours)}, which is{" "}
          {weeks(digest.weeksAtCommitment)} at the {hours(digest.committedHours)}{" "}
          a week you planned for.
        </Lead>
        {/* The honest half. Pricing the same work at the pace actually kept is
            the difference between a plan and a wish. */}
        {digest.weeksAtActualPace === null ? (
          <Meta tone="muted">
            At last week&rsquo;s pace there is no finish date to give you.
          </Meta>
        ) : (
          <Meta tone="muted">
            At the {hours(digest.hoursLogged)} you actually did:{" "}
            {weeks(digest.weeksAtActualPace)}. Today&rsquo;s session already
            takes that into account.
          </Meta>
        )}
      </Card>
    </main>
  );
}
