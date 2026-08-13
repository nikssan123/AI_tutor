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
  ButtonLink,
  Card,
  EmptyState,
  Lead,
  Meta,
  stagger,
  Status,
  Title,
  MaturityBadge,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import type { SessionBlock } from "@/lib/engine";
import { startSessionAction } from "../session/[id]/actions";

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
      <AppFrame width="narrow">
        <AppHeader
          title="Today"
          lead="One thing at a time, chosen for you. Nothing here until there is a goal to choose from."
        />
        <Card className="rise flex flex-col items-start gap-4" style={stagger(1)}>
          <EmptyState
            message="You don't have a goal yet. Once you do, this is where the one thing worth doing today will be."
            action={<ButtonLink href="/start">Set a goal</ButtonLink>}
          />
        </Card>
      </AppFrame>
    );
  }

  const { pack, projection, session: planned, skillNames, openSessionId } = view;

  return (
    <AppFrame>
      <AppHeader
        icon={<SubjectIcon taxonomyParent={pack.taxonomyParent} />}
        title="Today"
        facts={
          <>
            <Meta>{pack.name}</Meta>
            <Meta>{planned.totalMinutes} min</Meta>
            {/*
              §7.1 — depth is declared, not faked, and this is where it has to
              be declared: a learner who never saw the wait screen would
              otherwise have nothing telling them their course was written on
              request and has not been read by a person. Only shown when there
              is something to say, so a curated pack does not carry a badge on
              every visit.
            */}
            {pack.maturity !== "curated" ? (
              <MaturityBadge maturity={pack.maturity} />
            ) : null}
          </>
        }
      />

      {/*
       * The session card is the one thing on this screen, so it is the only
       * thing at full width and the only thing carrying the accent field. The
       * bands under it are the context you read *after* deciding to start.
       */}
      <Card className="rise p-0 overflow-hidden" style={stagger(1)}>
        <div className="flex flex-col gap-6 p-7">
          {/* The planner's own `reason`, template-filled from the components
              that actually decided the choice (§16.1). It is the single most
              important sentence on the screen, so it gets the accent field and
              the largest type in the card rather than sitting in the same grey
              as everything else. */}
          <div className="rounded-[var(--radius-card)] bg-accent-weak px-6 py-5">
            <Title className="text-ink">{planned.reason}</Title>
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
                  className="rise flex items-center justify-between gap-4 border-b border-hairline px-5 py-3.5 last:border-b-0"
                  style={stagger(i + 2)}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex min-w-14 justify-center rounded-[var(--radius-pill)] bg-accent-weak px-2.5 py-1 text-[length:var(--text-meta-size)] font-[650] text-accent">
                      {BLOCK_LABEL[block.type]}
                    </span>
                    <span className="min-w-0">
                      {blockDetail(block, skillNames)}
                    </span>
                  </span>
                  <Meta className="shrink-0">{block.estMinutes} min</Meta>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="Nothing is unlocked right now — every skill on your path is either done or waiting on a prerequisite." />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline px-7 py-5">
          {/* A form, not a link: starting a session writes rows. The action
              hands back the session already in progress if there is one, so a
              second click cannot split a learner's answers across two. */}
          {planned.blocks.length > 0 ? (
            <form action={startSessionAction}>
              <Button type="submit">
                {openSessionId ? "Carry on" : "Start session"}
              </Button>
            </form>
          ) : (
            <Meta>Nothing to start today.</Meta>
          )}
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

      <section className="rise flex flex-col gap-6" style={stagger(4)}>
        <SectionHead label="The rest of it" title="Your path" />

        <Lead>
          {projection.requiredSkillIds.length} skills to go ·{" "}
          {projection.estimatedHours} hours at your current level
          {projection.optionalSkillIds.length > 0
            ? ` · ${projection.optionalSkillIds.length} optional`
            : ""}
        </Lead>

        {/* §8 screen 5's honesty half, on the screen people actually open
            daily: what we took off the path, and why. */}
        {projection.excludedSkillIds.length > 0 ? (
          <ul className="grid list-none grid-cols-1 gap-3 p-0 m-0 sm:grid-cols-2">
            {projection.excludedSkillIds.map((id) => (
              <li
                key={id}
                className="rounded-[var(--radius-control)] bg-surface px-4 py-3 shadow-[var(--shadow-raised)]"
              >
                <Meta>{projection.exclusionReasons[id]}</Meta>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </AppFrame>
  );
}
