import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { todayFor } from "@/lib/goals/today";
import { SubjectIcon } from "@/components/icons";
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
import type { SessionBlock } from "@/lib/engine";

/**
 * §8 screen 6 — the daily dashboard, and the retention surface. It must answer
 * "what do I do now" in under two seconds, with one primary card and nothing
 * else: no feed, no browse.
 *
 * The sentence under the title is the planner's own `reason`, template-filled
 * from the score components that actually decided the choice (§16.1). It is not
 * generated, which is why it can be trusted: it cannot say something the
 * ranking did not.
 */
export const metadata: Metadata = {
  title: "Today",
  robots: { index: false, follow: false },
};

/** Minutes offered by "I have less time". */
const SHORTER = 15;

const BLOCK_LABEL: Record<SessionBlock["type"], string> = {
  explain: "Read",
  check: "Recall",
  apply: "Do",
  review: "Review",
  reflect: "Reflect",
};

function blockDetail(block: SessionBlock, names: Map<string, string>): string {
  switch (block.type) {
    case "explain":
      return names.get(block.skillId) ?? block.skillId;
    case "check":
      return block.isRetrieval
        ? `${names.get(block.skillId) ?? block.skillId} — from memory`
        : (names.get(block.skillId) ?? block.skillId);
    case "apply":
      return names.get(block.skillId) ?? block.skillId;
    case "review":
      return block.focus;
    case "reflect":
      return block.prompt;
  }
}

type Props = { searchParams: Promise<{ minutes?: string }> };

export default async function TodayPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { minutes } = await searchParams;
  const requested = Number(minutes);
  const view = await todayFor(getDb(), session.user.id, new Date(), {
    availableMinutes:
      Number.isFinite(requested) && requested > 0 ? requested : undefined,
  });

  if (!view) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        <DisplayTitle>Today</DisplayTitle>
        <Card>
          <EmptyState message="You don't have a goal yet. Once you do, this is where the one thing worth doing today will be." />
        </Card>
        <div>
          <Link href="/start">
            <Button>Set a goal</Button>
          </Link>
        </div>
        <Meta>Signed in as {session.user.email}</Meta>
      </main>
    );
  }

  const { pack, projection, session: planned, skillNames } = view;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="rise flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
          <SubjectIcon taxonomyParent={pack.taxonomyParent} />
        </span>
        <DisplayTitle>Today</DisplayTitle>
      </div>

      <Card className="rise p-0 overflow-hidden" style={stagger(1)}>
        <div className="flex flex-col gap-5 p-7">
          <div className="flex items-baseline justify-between gap-4">
            <Title>{pack.name}</Title>
            <Meta>{planned.totalMinutes} min</Meta>
          </div>

          {/* The planner's own `reason`, template-filled from the components
              that actually decided the choice (§16.1). It is the single most
              important sentence on the screen, so it gets the accent field
              rather than sitting in the same grey as everything else. */}
          <div className="rounded-[var(--radius-control)] bg-accent-weak px-5 py-4">
            <Lead className="text-ink">{planned.reason}</Lead>
          </div>

          {planned.backingOff ? (
            <Status tone="attention">
              Backing off — a worked example today, nothing to hand in
            </Status>
          ) : null}

          {planned.blocks.length > 0 ? (
            <ul className="flex list-none flex-col gap-0 p-0 m-0 overflow-hidden rounded-[var(--radius-control)] bg-raised">
              {planned.blocks.map((block, i) => (
                <li
                  key={`${block.type}-${i}`}
                  className="rise flex items-center justify-between gap-4 border-b border-hairline px-5 py-3 last:border-b-0"
                  style={stagger(i + 2)}
                >
                  <span className="flex items-center gap-3">
                    <span className="inline-flex min-w-14 justify-center rounded-[var(--radius-pill)] bg-accent-weak px-2.5 py-1 text-[length:var(--text-meta-size)] font-[650] text-accent">
                      {BLOCK_LABEL[block.type]}
                    </span>
                    <span>{blockDetail(block, skillNames)}</span>
                  </span>
                  <Meta>{block.estMinutes} min</Meta>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="Nothing is unlocked right now — every skill on your path is either done or waiting on a prerequisite." />
          )}

        </div>

        {/* The session runner is E7. Until it exists this card says what it
            would contain rather than offering a button that goes nowhere. */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline px-7 py-5">
          <Meta>The session runner arrives with E7.</Meta>
          <Link
            href={`/today?minutes=${SHORTER}`}
            className="text-accent font-[550] hover:underline underline-offset-4"
          >
            I have less time
          </Link>
        </div>
      </Card>

      {planned.compression ? (
        <Card className="rise flex flex-col gap-2" style={stagger(3)}>
          <Status tone="attention">Deadline</Status>
          <Meta>{planned.compression.message}</Meta>
        </Card>
      ) : null}

      <div className="rise flex flex-col gap-3" style={stagger(4)}>
        <Title>Your path</Title>
        <Meta>
          {projection.requiredSkillIds.length} skills to go ·{" "}
          {projection.estimatedHours} hours at your current level
          {projection.optionalSkillIds.length > 0
            ? ` · ${projection.optionalSkillIds.length} optional`
            : ""}
        </Meta>

        {projection.excludedSkillIds.length > 0 ? (
          <ul className="flex list-none flex-col gap-2 p-0 m-0">
            {projection.excludedSkillIds.map((id) => (
              <li key={id}>
                <Meta>{projection.exclusionReasons[id]}</Meta>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Meta>Signed in as {session.user.email}</Meta>
    </main>
  );
}
