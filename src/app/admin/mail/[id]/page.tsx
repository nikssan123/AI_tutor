import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/admin/guard";
import {
  accountFor,
  getThread,
  listMessages,
  type MessageRow,
} from "@/lib/mail/store";
import { threadReplyAddress } from "@/lib/email/addresses";
import { Card, cx, Meta, stagger, Status } from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { templateById } from "@/lib/email/catalog";
import { sendMailAction, setThreadStatusAction } from "../actions";
import { Fields, LocaleField, Notice, one, toneForMessage, when } from "../parts";

/** The form's shape. The buttons choose which of the two it is sent as. */
const REPLY = templateById("reply")!;

export const metadata: Metadata = {
  title: "Thread",
  robots: { index: false, follow: false },
};

/**
 * One conversation, and the box to answer it in.
 *
 * The two buttons under the box — "Send" and "Send and close" — are one form
 * with two submit values rather than a template picker, because they are the
 * only two things anyone ever does here and a select would put a decision in
 * front of an operator who has already made it.
 */

/**
 * A message, as an operator reads it.
 *
 * Inbound is what they said and outbound is what we said, so the two are
 * visually distinguishable at a glance rather than by reading the addresses —
 * an inbox where you have to check who sent a line before you understand it is
 * an inbox that gets misread under time pressure.
 */
export function Message({ message }: { message: MessageRow }) {
  const inbound = message.direction === "inbound";

  return (
    <Card
      className={cx(
        "flex flex-col gap-3 border-l-4",
        inbound ? "border-l-attention" : "border-l-accent",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="font-[550]">
          {inbound ? message.fromAddress : (message.sentByEmail ?? "us")}
        </span>
        <Meta>{when(message.createdAt)}</Meta>
        {message.template === null ? null : (
          <Meta>template {message.template}</Meta>
        )}
        <Status tone={toneForMessage(message.status)}>{message.status}</Status>
      </div>

      <p className="whitespace-pre-wrap text-ink">{message.body}</p>

      {message.error === null ? null : (
        <Meta>
          <span className="text-problem">{message.error}</span>
        </Meta>
      )}
    </Card>
  );
}

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  await requireAdmin();

  const { id } = await params;
  const query = await searchParams;

  const db = getDb();
  const thread = await getThread(db, id);
  // An id that is not a thread and an id that is not a uuid get the same
  // answer, which is the one a prober learns nothing from.
  if (thread === undefined) notFound();

  const [messages, account] = await Promise.all([
    listMessages(db, thread.id),
    accountFor(db, thread.participantEmail),
  ]);

  const closed = thread.status === "closed";

  return (
    <AppFrame>
      <AppHeader
        eyebrow="Mail"
        title={thread.subject}
        lead={`With ${thread.participantName ?? thread.participantEmail}.`}
        facts={
          <>
            <Status
              tone={
                thread.needsReply
                  ? "attention"
                  : closed
                    ? "neutral"
                    : "verified"
              }
            >
              {thread.needsReply ? "waiting on us" : thread.status}
            </Status>
            <Meta>{thread.participantEmail}</Meta>
            <Meta>
              {account === undefined ? (
                "No account with this address"
              ) : (
                <Link
                  href="/admin/data/user"
                  className="text-accent underline-offset-4 hover:underline"
                >
                  Has an account
                </Link>
              )}
            </Meta>
            <Link
              href="/admin/mail"
              className="text-[length:var(--text-meta-size)] font-[550] text-accent underline-offset-4 hover:underline"
            >
              Back to the inbox
            </Link>
          </>
        }
      />

      <Notice message={one(query.notice)} ok={one(query.ok) === "1"} />

      <section className="rise flex flex-col gap-4" style={stagger(1)}>
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </section>

      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead label="Answer" title="Reply" />

        <Meta>
          Sent from the support mailbox in the language below. Their reply comes
          back to this thread, because it is addressed to{" "}
          <code>{threadReplyAddress(thread.id)}</code>.
        </Meta>

        <form action={sendMailAction} className="flex flex-col gap-4">
          <input type="hidden" name="threadId" value={thread.id} />

          <LocaleField selected={thread.locale} />

          {/* `reply` and `resolved` declare the same two variables, which is
              what lets one form serve both buttons. */}
          <Fields
            template={REPLY}
            values={{ name: thread.participantName ?? account?.name ?? "" }}
            required
          />

          <div className="flex flex-wrap gap-4">
            <button
              type="submit"
              name="template"
              value="reply"
              className="rounded-[var(--radius-control)] bg-accent px-5 py-2.5 font-[550] text-on-accent"
            >
              Send
            </button>
            <button
              type="submit"
              name="template"
              value="resolved"
              className="rounded-[var(--radius-control)] border border-hairline px-5 py-2.5 font-[550]"
            >
              Send and close
            </button>
          </div>
        </form>

        <form action={setThreadStatusAction}>
          <input type="hidden" name="threadId" value={thread.id} />
          <input
            type="hidden"
            name="status"
            value={closed ? "open" : "closed"}
          />
          <button
            type="submit"
            className="text-accent underline-offset-4 hover:underline"
          >
            {closed ? "Reopen without replying" : "Close without replying"}
          </button>
        </form>
      </section>
    </AppFrame>
  );
}
