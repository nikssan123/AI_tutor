import type { Db } from "@/db";
import type { EnvLike } from "@/lib/env-types";
import { recordAudit } from "@/lib/admin/audit";
import { resolveLocale, type Locale } from "@/lib/i18n/locales";
import {
  isEmailAddress,
  parseMailbox,
  supportFrom,
  threadReplyAddress,
} from "@/lib/email/addresses";
import {
  missingVariables,
  renderOperatorMessage,
  templateById,
  threadSubjectFor,
  type OperatorTemplate,
} from "@/lib/email/catalog";
import { sendMessage } from "@/lib/email";
import type { ThemeChoice } from "@/lib/theme-script";
import {
  accountFor,
  appendMessage,
  createThread,
  getThread,
  listMessages,
  normalizeAddress,
  setThreadLocale,
  setThreadStatus,
  type MessageRow,
  type ThreadRow,
} from "./store";

/**
 * Sending, from the operator's side.
 *
 * The rule this module exists to enforce: **nothing leaves without a row and an
 * audit entry**. A support reply is a promise made on the product's behalf by
 * one of a handful of people, and an outreach send is a message to someone who
 * did not ask for it. Both are exactly the kind of act §14.8's audit log is for,
 * and both are useless to the operator later if the inbox does not remember
 * them.
 */

export interface Operator {
  userId: string;
  email: string;
  /** How the reader sees them — the signature on the message. */
  name: string;
}

export interface SendResult {
  ok: boolean;
  message: string;
  threadId?: string;
}

export interface SendInput {
  /** Ignored when `threadId` is given: a reply goes where the thread goes. */
  to?: string;
  templateId: string;
  locale?: string;
  variables: Record<string, string | undefined>;
  /** Continue an existing conversation instead of starting one. */
  threadId?: string;
}

/**
 * `In-Reply-To` and `References` for a reply.
 *
 * Best-effort, and not the mechanism threading depends on — that is the token
 * in the reply-to address. These headers only make the conversation *look*
 * right in the recipient's client, which is worth having and is not worth a
 * failed send: a thread whose inbound mail carried no `Message-ID` simply gets
 * no headers.
 */
export function threadHeaders(
  messages: readonly MessageRow[],
): Record<string, string> | undefined {
  const ids = messages
    .map((message) => message.messageId)
    .filter((id): id is string => id !== null);

  if (ids.length === 0) return undefined;

  return {
    "In-Reply-To": ids[ids.length - 1]!,
    References: ids.join(" "),
  };
}

async function fail(
  db: Db,
  operator: Operator,
  action: string,
  target: string,
  message: string,
  detail: unknown,
): Promise<SendResult> {
  await recordAudit(db, {
    actorId: operator.userId,
    actorEmail: operator.email,
    action,
    target,
    detail,
    outcome: "denied",
    error: message,
  });

  return { ok: false, message };
}

/**
 * Renders a catalog template and sends it, into a new thread or an existing one.
 *
 * The refusals happen before the thread is touched, so a rejected send leaves
 * nothing behind but the audit row saying it was rejected.
 */
export async function sendTemplatedEmail(
  db: Db,
  operator: Operator,
  input: SendInput,
  env: EnvLike = process.env,
): Promise<SendResult> {
  /** What a refusal is recorded against, before we know who it is going to. */
  const target = input.to ?? input.threadId ?? "";

  const template = templateById(input.templateId);
  if (template === undefined) {
    return fail(
      db,
      operator,
      "mail.send",
      target,
      `No template called "${input.templateId}".`,
      { templateId: input.templateId },
    );
  }

  const missing = missingVariables(template, input.variables);
  if (missing.length > 0) {
    return fail(
      db,
      operator,
      "mail.send",
      target,
      `Fill in every field first: ${missing.join(", ")}.`,
      { template: template.id, missing },
    );
  }

  if (template.repliesInThread && input.threadId === undefined) {
    // Its subject is the thread's, and its copy answers something. Sent cold it
    // would arrive as "Re:" a conversation the reader never had.
    return fail(
      db,
      operator,
      "mail.send",
      target,
      `"${template.name}" can only be sent as a reply in an existing thread.`,
      { template: template.id },
    );
  }

  const existing =
    input.threadId === undefined
      ? undefined
      : await getThread(db, input.threadId);

  if (input.threadId !== undefined && existing === undefined) {
    return fail(db, operator, "mail.send", input.threadId, "No such thread.", {
      template: template.id,
    });
  }

  const to = normalizeAddress(existing?.participantEmail ?? input.to ?? "");
  if (!isEmailAddress(to)) {
    return fail(
      db,
      operator,
      "mail.send",
      to,
      `"${to}" is not an email address.`,
      { template: template.id },
    );
  }

  /**
   * The learner's account, and from it the language — decided before the thread
   * exists because the thread's subject is written in it.
   *
   * Three sources in order of authority: what the operator picked on this
   * send, what the thread has been using, and — for a first message — the
   * language the learner chose for the product. `||` rather than `??` because
   * a `<select>` that was left alone posts an empty string, and an empty
   * string is an absent answer rather than a request for English.
   *
   * The read used to be skipped for a reply, since a thread already knows its
   * language. It is unconditional now because the frame also needs the reader's
   * appearance choice, and that is *not* on the thread: an operator switches a
   * thread's language and it stays switched, but the palette belongs to the
   * reader and follows them, so a copy on the thread could only go stale.
   */
  const account = await accountFor(db, to);
  const locale: Locale = resolveLocale(
    input.locale || existing?.locale || account?.locale,
  );

  const thread =
    existing ??
    (await createThread(db, {
      participantEmail: to,
      // Every template declares `name`, and a blank one was refused above, so
      // there is no missing case left to fall back from.
      participantName: input.variables.name!,
      subject: threadSubjectFor(template, input.variables, locale),
      kind: template.kind,
      locale,
    }));

  return dispatch(
    db,
    operator,
    { template, thread, locale, theme: account?.theme ?? "system", input, to },
    env,
  );
}

/** The half that talks to the transport, once everything has been checked. */
async function dispatch(
  db: Db,
  operator: Operator,
  context: {
    template: OperatorTemplate;
    thread: ThreadRow;
    locale: Locale;
    /** The recipient's, resolved above. `"system"` when they have no account. */
    theme: ThemeChoice;
    input: SendInput;
    to: string;
  },
  env: EnvLike,
): Promise<SendResult> {
  const { template, thread, locale, theme, to } = context;
  const from = supportFrom(env);
  const headers = threadHeaders(await listMessages(db, thread.id));

  const message = renderOperatorMessage({
    template,
    to,
    locale,
    theme,
    variables: context.input.variables,
    sender: operator.name,
    threadSubject: thread.subject,
    from,
    // Every message carries the thread in its reply address, so an answer to
    // any of them lands on this conversation rather than starting a new one.
    replyTo: threadReplyAddress(thread.id, env),
    ...(headers === undefined ? {} : { headers }),
    env,
  });

  const outcome = await sendMessage(message);

  await appendMessage(db, {
    threadId: thread.id,
    direction: "outbound",
    fromAddress: parseMailbox(from).address,
    toAddress: to,
    subject: message.subject,
    body: message.text,
    html: message.html,
    providerId: outcome.ok ? outcome.id : null,
    template: template.id,
    locale,
    sentByEmail: operator.email,
    status: outcome.ok ? "sent" : "failed",
    error: outcome.ok ? null : outcome.error,
  });

  // The thread remembers the last language we wrote in, so the next reply
  // defaults to it rather than to the account's UI language. Unconditional
  // because "did it change" is a question whose answer costs more than the
  // write it would save.
  await setThreadLocale(db, thread.id, locale);

  // "Reply and resolve" means both. Closing only on success is the point: a
  // send that failed has answered nobody.
  if (outcome.ok && template.id === "resolved") {
    await setThreadStatus(db, thread.id, "closed");
  }

  await recordAudit(db, {
    actorId: operator.userId,
    actorEmail: operator.email,
    action: "mail.send",
    target: to,
    detail: {
      template: template.id,
      locale,
      threadId: thread.id,
      subject: message.subject,
    },
    outcome: outcome.ok ? "ok" : "error",
    error: outcome.ok ? null : outcome.error,
  });

  return outcome.ok
    ? { ok: true, message: `Sent to ${to}.`, threadId: thread.id }
    : {
        ok: false,
        message: `Could not send: ${outcome.error}`,
        threadId: thread.id,
      };
}

/** Closing and reopening, which are privileged acts on someone's request. */
export async function changeThreadStatus(
  db: Db,
  operator: Operator,
  threadId: string,
  status: "open" | "closed",
): Promise<SendResult> {
  const thread = await getThread(db, threadId);
  if (thread === undefined) {
    return fail(
      db,
      operator,
      "mail.status",
      threadId,
      "No such thread.",
      { status },
    );
  }

  await setThreadStatus(db, threadId, status);

  await recordAudit(db, {
    actorId: operator.userId,
    actorEmail: operator.email,
    action: "mail.status",
    target: thread.participantEmail,
    detail: { threadId, from: thread.status, to: status },
    outcome: "ok",
  });

  return {
    ok: true,
    message: status === "closed" ? "Thread closed." : "Thread reopened.",
    threadId,
  };
}
