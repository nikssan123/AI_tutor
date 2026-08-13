import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import { consoleSnapshot, type RunStatusCount } from "@/lib/admin/console";
import {
  Card,
  DisplayTitle,
  EmptyState,
  Meta,
  Row,
  RowList,
  stagger,
  Status,
  Title,
} from "@/components/ui";

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

function Figure({ label, value }: { label: string; value: string }) {
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
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <DisplayTitle>Console</DisplayTitle>
        <Meta>
          Read-only. Every number below is a live query, taken{" "}
          <time dateTime={snapshot.generatedAt.toISOString()}>
            {snapshot.generatedAt.toISOString().replace("T", " ").slice(0, 16)}
          </time>{" "}
          UTC.
        </Meta>
      </header>

      <section className="flex flex-col gap-4">
        <Title>Spend</Title>
        <Meta>
          Includes anonymous runs, which the per-learner ledger excludes — the
          free check costs real money and is where a spike shows first.
        </Meta>
        <Card className="flex flex-wrap gap-x-12 gap-y-4">
          <Figure label="Today" value={formatCents(spend.todayCents)} />
          <Figure label="Month to date" value={formatCents(spend.monthCents)} />
          <Figure
            label="Learners at their cap"
            value={String(spend.cappedLearners)}
          />
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <Title>Runs, last 24 hours</Title>
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

      <section className="flex flex-col gap-4">
        <Title>Learners</Title>
        <Card className="flex flex-wrap gap-x-12 gap-y-4">
          <Figure label="Total" value={String(learners.total)} />
          <Figure label="New this week" value={String(learners.newThisWeek)} />
          <Figure label="Active goals" value={String(learners.activeGoals)} />
        </Card>
      </section>

      <Link
        href="/admin/packs"
        className="text-[length:var(--text-label-size)] text-accent hover:underline"
      >
        Review the domain packs →
      </Link>
    </main>
  );
}
