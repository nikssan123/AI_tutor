import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import {
  isInboxFilter,
  listThreads,
  waitingCount,
  type InboxFilter,
  type ThreadRow,
} from "@/lib/mail/store";
import { LOCALE_NAMES } from "@/lib/i18n/locales";
import { Meta, stagger, Status, EmptyState, Card } from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { Cell, DataGrid } from "@/components/admin-grid";
import { Notice, one, when } from "./parts";

export const metadata: Metadata = {
  title: "Mail",
  robots: { index: false, follow: false },
};

/**
 * The inbox.
 *
 * It opens on **waiting** rather than on everything, because the only question
 * an operator has when they come here is "who is owed an answer". A list that
 * opens on all correspondence answers that question by making you look for it,
 * and the surest way to lose a support request is to file it in a place that
 * looks the same whether or not anything is wrong.
 */

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "waiting", label: "Waiting on us" },
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
];

export function toneForThread(thread: ThreadRow) {
  if (thread.needsReply) return "attention" as const;
  return thread.status === "closed" ? "neutral" : ("verified" as const);
}

export function threadState(thread: ThreadRow): string {
  if (thread.needsReply) return "waiting";
  return thread.status;
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function MailPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();

  const query = await searchParams;
  const requested = one(query.filter);
  const filter: InboxFilter = isInboxFilter(requested) ? requested : "waiting";

  const db = getDb();
  const [threads, waiting] = await Promise.all([
    listThreads(db, filter),
    waitingCount(db),
  ]);

  return (
    <AppFrame width="full">
      <AppHeader
        eyebrow="Operations"
        title="Mail"
        lead="Everything a person sent us, and everything a person sent them."
        facts={
          <>
            <Status tone={waiting > 0 ? "attention" : "verified"}>
              {waiting} waiting on us
            </Status>
            <Meta>Times are UTC</Meta>
            <Link
              href="/admin/mail/compose"
              className="text-[length:var(--text-meta-size)] font-[550] text-accent underline-offset-4 hover:underline"
            >
              Write to someone
            </Link>
          </>
        }
      />

      <Notice message={one(query.notice)} ok={one(query.ok) === "1"} />

      <nav aria-label="Filter" className="flex flex-wrap gap-4">
        {FILTERS.map((option) => (
          <Link
            key={option.value}
            href={`/admin/mail?filter=${option.value}`}
            aria-current={option.value === filter ? "page" : undefined}
            className={
              option.value === filter
                ? "font-[650] text-ink underline underline-offset-4"
                : "text-ink-muted underline-offset-4 hover:underline"
            }
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <section className="rise flex flex-col gap-4" style={stagger(1)}>
        {threads.length === 0 ? (
          <Card>
            <EmptyState
              message={
                filter === "waiting"
                  ? "Nothing is waiting on an answer."
                  : "No correspondence yet."
              }
            />
          </Card>
        ) : (
          <DataGrid
            columns={["Last", "Who", "Subject", "Kind", "Language", "State"]}
            empty="No correspondence yet."
            rows={threads.map((thread) => [
              <Cell key="t" value={when(thread.lastMessageAt)} />,
              <span key="w" className="flex min-w-0 flex-col">
                <Link
                  href={`/admin/mail/${thread.id}`}
                  className="truncate font-[550] text-accent underline-offset-4 hover:underline"
                >
                  {thread.participantEmail}
                </Link>
                {thread.participantName === null ? null : (
                  <Meta>{thread.participantName}</Meta>
                )}
              </span>,
              <Link
                key="s"
                href={`/admin/mail/${thread.id}`}
                className="block max-w-md truncate underline-offset-4 hover:underline"
              >
                {thread.subject}
              </Link>,
              <Cell key="k" value={thread.kind} />,
              <Cell key="l" value={LOCALE_NAMES[thread.locale]} />,
              <Status key="x" tone={toneForThread(thread)}>
                {threadState(thread)}
              </Status>,
            ])}
          />
        )}
      </section>
    </AppFrame>
  );
}
