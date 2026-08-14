import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { ledgerFor } from "@/lib/mastery/view";
import { standingFor } from "@/lib/goals/standing";
import { CLAIMED, type LedgerEntry } from "@/lib/mastery/ledger";
import { STATUS_LABEL } from "@/lib/goals/lifecycle";
import {
  ButtonLink,
  Card,
  Confidence,
  confidenceLevel,
  EmptyState,
  Figure,
  Meta,
  stagger,
  Status,
  Title,
  ToggleGroup,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { NothingRunning, PickBackUp } from "@/components/nothing-running";
import { ArrowIcon } from "@/components/icons";

/**
 * §8 screen 10 — the mastery map, and "the reason to stay subscribed".
 *
 * Two tabs, as the plan specifies: what you can do, and what's left. The first
 * is the product's whole claim, so every row in it links to the marked hand-in
 * it rests on (§24 E9). The second says, per skill, exactly why it is not in the
 * first — including the one case people find hardest to believe, where a skill
 * they proved has decayed back onto their path.
 *
 * There is no percentage anywhere on this page, and no progress bar. "63%
 * complete" measures consumption; this screen measures evidence.
 */
export const metadata: Metadata = {
  title: "What you can do",
  robots: { index: false, follow: false },
};

const TABS = [
  { key: "can-do", href: "/mastery", label: "What I can do" },
  { key: "left", href: "/mastery?show=left", label: "What's left" },
] as const;

/** The two standings that mean a skill was proved and has started to slip. */
const SLIPPING: LedgerEntry["standing"][] = ["fading", "faded"];

function Entry({ entry, index }: { entry: LedgerEntry; index: number }) {
  return (
    <li className="flex">
      {/* `h-full` so a card in a grid row matches its tallest sibling rather
          than leaving a ragged bottom edge (§8.5.9). */}
      <Card
        className="rise flex h-full w-full flex-col items-start gap-3"
        style={stagger(index)}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          {/* The skill's own name is the label on the claim, not a heading —
              the statement below it is what the learner reads. */}
          <Meta tone="muted" className="font-[650] uppercase tracking-[0.1em]">
            {entry.name}
          </Meta>
          {SLIPPING.includes(entry.standing) ? (
            <Status tone="attention">Slipping</Status>
          ) : null}
        </div>

        {/* §14.4's can-do statement, in the pack's own words. This is the
            capability claim, so it is the largest thing on the card. */}
        <Title className="text-[length:var(--text-lead-size)] leading-[var(--text-lead-line)]">
          {entry.statement}
        </Title>

        <div className="mt-auto flex flex-col gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* §7.2 — "confidence propagates to the UI everywhere". Shown only
                where a claim is being made: a faded skill keeps its evidence
                but stops carrying a verdict, because the verdict expired. */}
            {CLAIMED.includes(entry.standing) ? (
              <Confidence level={confidenceLevel(entry.confidence)} />
            ) : null}
            <Meta tone="muted">{entry.note}</Meta>
          </div>

          {/* The link §24 E9 requires. A claim whose evidence you cannot open
              is the kind of claim every competitor already makes. */}
          {entry.submissionId === null ? null : (
            <Link
              href={`/submission/${entry.submissionId}`}
              className="inline-flex w-fit items-center gap-1.5 font-[550] text-accent underline-offset-4 hover:underline"
            >
              See the work
              <ArrowIcon className="size-4" />
            </Link>
          )}
        </div>
      </Card>
    </li>
  );
}

/** §8.5.9 — "a 26-item column is a scroll; a grid is a map." */
function Grid({
  entries,
  offset = 0,
}: {
  entries: LedgerEntry[];
  /** Keeps the stagger running across groups rather than restarting per band. */
  offset?: number;
}) {
  return (
    <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 md:grid-cols-2">
      {entries.map((entry, i) => (
        <Entry key={entry.skillSlug} entry={entry} index={i + offset} />
      ))}
    </ul>
  );
}

type Props = { searchParams: Promise<{ show?: string }> };

export default async function MasteryPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { show } = await searchParams;
  const view = await ledgerFor(getDb(), session.user.id, new Date());

  if (!view) {
    // Nothing proved and nothing running — which does not mean nothing
    // started. The same standing `/today` reads, so a learner mid-way through
    // creating a subject is not told here that they have nothing.
    const standing = await standingFor(getDb(), session.user.id);

    return (
      /* Wide, like the populated ledger and like `/today`. See `/progress` for
         why an empty screen keeps its route's width. */
      <AppFrame>
        <AppHeader
          title="What you can do"
          lead="The record of what you have proved. It fills up as work gets marked."
        />
        <NothingRunning
          standing={standing}
          note="This fills up with what you have proved — one line per skill, each linked to the work that proved it."
        />
        <PickBackUp courses={standing.again} />
      </AppFrame>
    );
  }

  const { active, claims, provedCount, whatsLeft } = view;
  const showing = show === "left" ? "left" : "can-do";

  /*
   * A heading per subject only once there is more than one.
   *
   * With a single course — the overwhelmingly common case, and the only one
   * that existed before a course could end — a band heading over the whole
   * list would name something the page has already named twice. §8.5.1's
   * density rule counts it either way.
   */
  const labelled = claims.length > 1;

  return (
    <AppFrame>
      <AppHeader
        title="What you can do"
        lead={
          /* §4.2 law 1, said out loud. The learner should know the rule the
             screen is applying before they wonder why something is missing.
             Named against the running course when there is one; a learner
             between courses is not being moved along anything. */
          active
            ? `Everything on this list is backed by work you handed in and we marked. Answering questions moves you along ${active.pack.name}; it doesn't get you onto this list.`
            : "Everything on this list is backed by work you handed in and we marked. It stays yours whether or not a course is running."
        }
      />

      {/*
       * §8.5.7 specifies this sentence exactly — "You can now do 12 things. 8
       * to go." — and it had never been built. It is the one line that turns a
       * list of rows into a claim about the person reading it, so it gets the
       * only display-size number on the screen (§8.5.5's figure), with the
       * view switch on the same line rather than as a second band.
       */}
      <div
        className="rise flex flex-wrap items-end justify-between gap-x-8 gap-y-6"
        style={stagger(1)}
      >
        <Figure
          value={provedCount}
          unit={provedCount === 1 ? "thing" : "things"}
          caption={
            /* "To go" is a statement about a path, so it is only made while
               the learner is on one. Between courses the count is complete in
               itself — there is no remainder to quote. */
            active === undefined
              ? "you can do, across everything you have studied."
              : whatsLeft.length > 0
                ? `you can do so far. ${whatsLeft.length} to go.`
                : "you can do. Nothing left on this path."
          }
        />

        <ToggleGroup
          label="Which list"
          options={TABS.map((tab) => ({
            href: tab.href,
            label: tab.label,
            current: showing === tab.key,
          }))}
        />
      </div>

      {showing === "left" ? (
        whatsLeft.length > 0 ? (
          <Grid entries={whatsLeft} />
        ) : (
          <Card className="rise">
            <EmptyState
              message={
                /* Two different absences, and telling a learner between
                   courses that "every skill in it is yours" would be claiming
                   something about a path they are not on. */
                active
                  ? "Nothing left on this path — every skill in it is yours."
                  : "No course running, so there is no path to have anything left on."
              }
              action={
                <ButtonLink href={active ? "/today" : "/subjects"}>
                  {active ? "Go to today" : "Pick a subject"}
                </ButtonLink>
              }
            />
          </Card>
        )
      ) : claims.length > 0 ? (
        claims.map((group, i) => (
          <section key={group.packSlug} className="flex flex-col gap-6">
            {labelled ? (
              <SectionHead
                label={STATUS_LABEL[group.status]}
                title={group.packName}
              />
            ) : null}
            <Grid entries={group.entries} offset={i} />
          </section>
        ))
      ) : (
        <Card className="rise">
          <EmptyState
            message="Nothing here yet. Hand in the work at the end of a session and what it proves lands here."
            action={<ButtonLink href="/today">Go to today</ButtonLink>}
          />
        </Card>
      )}
    </AppFrame>
  );
}
