import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { consoleSnapshot, type RunStatusCount } from "@/lib/admin/console";
import {
  Card,
  EmptyState,
  Meta,
  Row,
  RowList,
  stagger,
  Status,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * The operator's console.
 *
 * It answers one question — is the thing healthy and what is it costing? — and
 * refuses the temptation to become a CRUD surface. Everything on it is a read.
 *
 * The guard is called here, in the page, not in the layout above it. See
 * `src/lib/admin/guard.ts` for why that distinction is the security boundary.
 */

/** Cents are stored as `real` because model calls cost fractions of one. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function toneForStatus(status: string) {
  if (status === "ok") return "verified" as const;
  return status === "refusal" ? "attention" : ("problem" as const);
}

/**
 * Deliberately not the kit's `Figure`, and named apart from it so nobody
 * reaches for the wrong one: `Figure` is display-size and there is one per
 * scroll band, because it states something a learner earned. These are
 * instrument readings — three to a row, at title size — which is a shape the
 * learner-facing screens are not allowed to have and an operator console
 * cannot work without.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Meta>{label}</Meta>
      <span className="text-[length:var(--text-title-size)] font-semibold">
        {value}
      </span>
    </div>
  );
}

export default async function AdminPage() {
  await requireAdmin();

  const snapshot = await consoleSnapshot(getDb());
  const { spend, runs, learners } = snapshot;

  const totalRuns = runs.counts.reduce(
    (sum: number, row: RunStatusCount) => sum + row.runs,
    0,
  );

  return (
    /* The same shell the learner-facing screens use. This page used to
       hand-roll a `max-w-5xl` main with its own padding and demote every band
       heading to a bare `Title`, which is the exact shape §8.5.9 diagnoses:
       an operator console is still the product, and it drifted the moment it
       stopped sharing a frame with everything else. */
    <AppFrame>
      <AppHeader
        eyebrow="Operations"
        title="Console"
        lead="Read-only. Every number below is a live query."
        facts={
          <Meta>
            Taken{" "}
            <time dateTime={snapshot.generatedAt.toISOString()}>
              {snapshot.generatedAt.toISOString().replace("T", " ").slice(0, 16)}
            </time>{" "}
            UTC
          </Meta>
        }
      />

      <section className="rise flex flex-col gap-6" style={stagger(1)}>
        <SectionHead label="Cost" title="Spend" />
        <Meta>
          Includes anonymous runs, which the per-learner ledger excludes — the
          free check costs real money and is where a spike shows first.
        </Meta>
        <Card className="flex flex-wrap gap-x-12 gap-y-4">
          <Stat label="Today" value={formatCents(spend.todayCents)} />
          <Stat label="Month to date" value={formatCents(spend.monthCents)} />
          <Stat
            label="Learners at their cap"
            value={String(spend.cappedLearners)}
          />
        </Card>
      </section>

      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead label="Last 24 hours" title="Runs" />
        {totalRuns === 0 ? (
          <Card>
            <EmptyState message="No model calls in the last 24 hours." />
          </Card>
        ) : (
          <>
            <Card className="flex flex-wrap gap-x-12 gap-y-4">
              {runs.counts.map((row: RunStatusCount) => (
                <div key={row.status} className="flex flex-col gap-1">
                  <Status tone={toneForStatus(row.status)}>{row.status}</Status>
                  <span className="text-[length:var(--text-title-size)] font-semibold">
                    {row.runs}
                  </span>
                  <Meta>{formatCents(row.costCents)}</Meta>
                </div>
              ))}
            </Card>

            {runs.failures.length > 0 ? (
              <RowList>
                {runs.failures.map((failure, i) => (
                  <Row key={failure.id} style={stagger(i)}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {failure.agentName}{" "}
                        <Meta>
                          v{failure.promptVersion} · {failure.model}
                        </Meta>
                      </span>
                      <Meta>{failure.error ?? "No error recorded."}</Meta>
                    </span>
                    <Status tone={toneForStatus(failure.status)}>
                      {failure.status}
                    </Status>
                  </Row>
                ))}
              </RowList>
            ) : null}
          </>
        )}
      </section>

      <section className="rise flex flex-col gap-6" style={stagger(3)}>
        <SectionHead
          label="Who is here"
          title="Learners"
          action={
            <Link
              href="/admin/packs"
              className="font-[550] text-accent underline-offset-4 hover:underline"
            >
              Review the domain packs
            </Link>
          }
        />
        <Card className="flex flex-wrap gap-x-12 gap-y-4">
          <Stat label="Total" value={String(learners.total)} />
          <Stat label="New this week" value={String(learners.newThisWeek)} />
          <Stat label="Active goals" value={String(learners.activeGoals)} />
        </Card>
      </section>
    </AppFrame>
  );
}
