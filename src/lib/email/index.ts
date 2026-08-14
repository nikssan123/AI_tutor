import type { EnvLike } from "@/lib/env-types";
import type { EmailMessage } from "./templates";

export * from "./templates";

/**
 * Transactional email, wired the same way observability is (§14.8): the
 * interface exists from the first commit, and the absence of a key degrades to
 * something visible rather than to nothing.
 *
 * §18.1 names Resend. It is reached over plain `fetch` rather than through the
 * SDK — one POST to one URL, and the SDK's value is types we would write here
 * anyway. That also keeps the transport injectable, which is what makes the
 * failure paths testable without a network.
 */

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Records messages instead of sending them. Used by tests. */
export class MemoryTransport implements EmailTransport {
  readonly name = "memory";
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * The no-key fallback: print the whole message, body included.
 *
 * Printing the body rather than "would have sent an email" is the entire point.
 * Every flow this module serves — verify, reset, change email — is a link the
 * developer needs to click, and a local environment where sign-up sends nothing
 * and says nothing is one where nobody exercises verification until production
 * does it for them.
 */
export class LogTransport implements EmailTransport {
  readonly name = "log";

  constructor(private readonly write: (line: string) => void = console.info) {}

  send(message: EmailMessage): Promise<void> {
    this.write(
      [
        "",
        "──────── email (no RESEND_API_KEY — not sent) ────────",
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "──────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return Promise.resolve();
  }
}

export class ResendTransport implements EmailTransport {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      // Resend puts the actionable part — unverified domain, malformed `from` —
      // in the body, so a status code on its own would send whoever reads the
      // log to the dashboard to find out what we already knew.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Resend rejected the message (${response.status}): ${detail || "no response body"}`,
      );
    }
  }
}

export function resolveTransport(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): EmailTransport {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return new LogTransport();

  const from = env.EMAIL_FROM;
  if (!from) {
    // Loud, at the first send rather than at the first bounce. Resend rejects a
    // message whose `from` is not on a verified domain, so guessing a default
    // here would turn a missing variable into a silent failure to deliver
    // exactly the mail people need — password resets.
    throw new Error(
      "RESEND_API_KEY is set but EMAIL_FROM is not. Set EMAIL_FROM to an address on a domain verified with Resend, e.g. \"MeritKeep <hello@yourdomain.com>\".",
    );
  }

  return new ResendTransport(apiKey, from, fetchImpl);
}

let transport: EmailTransport | undefined;

export function getTransport(): EmailTransport {
  transport ??= resolveTransport();
  return transport;
}

/** Test seam, and the way a script swaps in a recorder. */
export function setTransport(next: EmailTransport | undefined): void {
  transport = next;
}

/**
 * Send, and never let the failure reach the caller.
 *
 * Every caller is an auth flow, and in every one of them a thrown error is
 * worse than a lost email. A sign-up that 500s because Resend is having an
 * afternoon leaves someone with no account and no explanation; a sign-up whose
 * verification mail is lost leaves them signed in, with a "resend" button on
 * `/account`. The second is recoverable by the person affected, which the first
 * is not.
 *
 * Returns whether it got through, so a caller that genuinely needs to know can
 * ask — and logs the reason, because "no email arrived" is otherwise the least
 * debuggable report a user can file.
 */
export async function deliver(message: EmailMessage): Promise<boolean> {
  try {
    await getTransport().send(message);
    return true;
  } catch (error) {
    console.error(
      `[email] failed to send "${message.subject}" to ${message.to}:`,
      error,
    );
    return false;
  }
}
