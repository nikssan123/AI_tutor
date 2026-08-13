import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { ledgerFor } from "@/lib/mastery/view";
import { CLAIMED, type LedgerEntry } from "@/lib/mastery/ledger";
import {
  Button,
  Card,
  Confidence,
  confidenceLevel,
  cx,
  DisplayTitle,
  EmptyState,
  Lead,
  Meta,
  stagger,
  Status,
  Title,
} from "@/components/ui";

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
    <li>
      <Card className="rise flex flex-col gap-3" style={stagger(index)}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Title className="text-[length:var(--text-label-size)]">
            {entry.name}
          </Title>
          {SLIPPING.includes(entry.standing) ? (
            <Status tone="attention">Slipping</Status>
          ) : null}
        </div>

        {/* §14.4's can-do statement, in the pack's own words. This is the
            capability claim, so it is the largest thing on the row. */}
        <Lead className="text-ink">{entry.statement}</Lead>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* §7.2 — "confidence propagates to the UI everywhere". Shown only
              where a claim is being made: a faded skill keeps its evidence but
              stops carrying a verdict, because the verdict is what expired. */}
          {CLAIMED.includes(entry.standing) ? (
            <Confidence level={confidenceLevel(entry.confidence)} />
          ) : null}
          <Meta tone="muted">{entry.note}</Meta>
        </div>

        {/* The link §24 E9 requires. A claim whose evidence you cannot open is
            the kind of claim every competitor already makes. */}
        {entry.submissionId === null ? null : (
          <Link
            href={`/submission/${entry.submissionId}`}
            className="w-fit font-[550] text-accent underline-offset-4 hover:underline"
          >
            See the work
          </Link>
        )}
      </Card>
    </li>
  );
}

type Props = { searchParams: Promise<{ show?: string }> };

export default async function MasteryPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { show } = await searchParams;
  const view = await ledgerFor(getDb(), session.user.id, new Date());

  if (!view) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        <DisplayTitle>What you can do</DisplayTitle>
        <Card>
          <EmptyState message="You don't have a goal yet. Once you do, everything you prove along the way is recorded here." />
        </Card>
        <div>
          <Link href="/start">
            <Button>Set a goal</Button>
          </Link>
        </div>
      </main>
    );
  }

  const { pack, ledger } = view;
  const showing = show === "left" ? "left" : "can-do";
  const entries = showing === "left" ? ledger.whatsLeft : ledger.canDo;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="rise flex flex-col gap-3">
        <DisplayTitle>What you can do</DisplayTitle>
        <Lead>
          {/* §4.2 law 1, said out loud. The learner should know the rule the
              screen is applying before they wonder why something is missing. */}
          Everything on this list is backed by work you handed in and we marked.
          Answering questions moves you along {pack.name}; it doesn&rsquo;t get
          you onto this list.
        </Lead>
      </header>

      <nav className="rise flex gap-6 border-b border-hairline">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={showing === tab.key ? "page" : undefined}
            className={cx(
              "-mb-px border-b-2 pb-3 text-[length:var(--text-label-size)]",
              showing === tab.key
                ? "border-accent font-[550] text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {entries.length > 0 ? (
        <ul className="flex list-none flex-col gap-4 p-0 m-0">
          {entries.map((entry, i) => (
            <Entry key={entry.skillSlug} entry={entry} index={i} />
          ))}
        </ul>
      ) : (
        <Card>
          <EmptyState
            message={
              showing === "left"
                ? "Nothing left on this path — every skill in it is yours."
                : "Nothing here yet. Hand in the work at the end of a session and what it proves lands here."
            }
            action={
              <Link href="/today">
                <Button>Go to today</Button>
              </Link>
            }
          />
        </Card>
      )}
    </main>
  );
}
