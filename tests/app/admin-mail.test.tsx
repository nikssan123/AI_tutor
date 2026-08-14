// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MessageRow, ThreadRow } from "@/lib/mail/store";

/**
 * The three mail screens.
 *
 * The guard is stubbed here and tested for real in tests/lib/admin-guard.test.ts;
 * what these assert is the other half — that each page calls it, that a thread
 * that does not exist 404s rather than reporting itself, and that the compose
 * screen previews the message it is actually going to send.
 */

const requireAdminMock = vi.fn();
const listThreadsMock = vi.fn();
const waitingCountMock = vi.fn();
const getThreadMock = vi.fn();
const listMessagesMock = vi.fn();
const accountForMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/lib/admin/guard", () => ({ requireAdmin: () => requireAdminMock() }));
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/mail/store", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/mail/store")>("@/lib/mail/store");
  return {
    ...actual,
    listThreads: (...args: unknown[]) => listThreadsMock(...args),
    waitingCount: (...args: unknown[]) => waitingCountMock(...args),
    getThread: (...args: unknown[]) => getThreadMock(...args),
    listMessages: (...args: unknown[]) => listMessagesMock(...args),
    accountFor: (...args: unknown[]) => accountForMock(...args),
  };
});
vi.mock("@/app/admin/mail/actions", () => ({
  sendMailAction: vi.fn(),
  setThreadStatusAction: vi.fn(),
}));

const { default: MailPage, threadState, toneForThread } = await import(
  "@/app/admin/mail/page"
);
const { default: ThreadPage, Message } = await import(
  "@/app/admin/mail/[id]/page"
);
const { default: ComposePage, COMPOSABLE } = await import(
  "@/app/admin/mail/compose/page"
);
const { Fields, one, toneForMessage } = await import("@/app/admin/mail/parts");
const { templateById } = await import("@/lib/email/catalog");

function thread(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: "t1",
    participantEmail: "ana@example.com",
    participantName: "Ana Ivanova",
    userId: "u9",
    subject: "Broken login",
    locale: "bg",
    kind: "support",
    status: "open",
    needsReply: true,
    lastMessageAt: new Date("2027-06-15T12:00:00.000Z"),
    createdAt: new Date("2027-06-15T11:00:00.000Z"),
    ...overrides,
  };
}

function message(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "m1",
    threadId: "t1",
    direction: "inbound",
    fromAddress: "ana@example.com",
    toAddress: "support@meritkeep.com",
    subject: "Broken login",
    body: "It will not let me in.",
    html: null,
    providerId: "re_1",
    messageId: "<a@b>",
    inReplyTo: null,
    template: null,
    locale: "bg",
    sentByEmail: null,
    status: "received",
    error: null,
    createdAt: new Date("2027-06-15T12:00:00.000Z"),
    ...overrides,
  };
}

const search = (query: Record<string, string> = {}) => Promise.resolve(query);

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    userId: "u0",
    email: "admin@example.com",
    name: "Nikolay",
    role: "admin",
  });
  listThreadsMock.mockResolvedValue([thread()]);
  waitingCountMock.mockResolvedValue(1);
  getThreadMock.mockResolvedValue(thread());
  listMessagesMock.mockResolvedValue([message()]);
  accountForMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("/admin/mail", () => {
  it("requires an admin", async () => {
    render(await MailPage({ searchParams: search() }));
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("refuses to render for a non-admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(MailPage({ searchParams: search() })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("opens on what is waiting on us", async () => {
    // The only question an operator has when they arrive is who is owed an
    // answer; a list that opens on everything answers it by making you look.
    render(await MailPage({ searchParams: search() }));
    expect(listThreadsMock.mock.calls[0]![1]).toBe("waiting");
  });

  it("honours a filter, and ignores one it does not have", async () => {
    render(await MailPage({ searchParams: search({ filter: "all" }) }));
    expect(listThreadsMock.mock.calls[0]![1]).toBe("all");

    cleanup();
    render(await MailPage({ searchParams: search({ filter: "drafts" }) }));
    expect(listThreadsMock.mock.calls[1]![1]).toBe("waiting");
  });

  it("links each thread to its conversation", async () => {
    render(await MailPage({ searchParams: search() }));

    expect(
      screen.getByRole("link", { name: "ana@example.com" }).getAttribute("href"),
    ).toBe("/admin/mail/t1");
  });

  it("names the language the thread is conducted in", async () => {
    render(await MailPage({ searchParams: search() }));
    expect(screen.getByText("Български")).toBeDefined();
  });

  it("counts what is waiting", async () => {
    render(await MailPage({ searchParams: search() }));
    expect(screen.getByText("1 waiting on us")).toBeDefined();

    cleanup();
    waitingCountMock.mockResolvedValue(0);
    render(await MailPage({ searchParams: search() }));
    expect(screen.getByText("0 waiting on us")).toBeDefined();
  });

  it("shows a name under the address only when there is one", async () => {
    render(await MailPage({ searchParams: search() }));
    expect(screen.getByText("Ana Ivanova")).toBeDefined();

    cleanup();
    listThreadsMock.mockResolvedValue([thread({ participantName: null })]);
    render(await MailPage({ searchParams: search() }));
    expect(screen.queryByText("Ana Ivanova")).toBeNull();
  });

  it("reads a repeated query parameter as its first value", async () => {
    // `searchParams` hands back an array when a key appears twice, and a form
    // field wants one string.
    render(
      await MailPage({
        searchParams: Promise.resolve({ filter: ["all", "open"] }),
      }),
    );
    expect(listThreadsMock.mock.calls[0]![1]).toBe("all");
  });

  it("says so when nothing is waiting, differently from having no mail at all", async () => {
    listThreadsMock.mockResolvedValue([]);
    render(await MailPage({ searchParams: search() }));
    expect(screen.getByText(/Nothing is waiting on an answer/)).toBeDefined();

    cleanup();
    render(await MailPage({ searchParams: search({ filter: "all" }) }));
    expect(screen.getByText(/No correspondence yet/)).toBeDefined();
  });

  it("reports the outcome of the last action", async () => {
    render(
      await MailPage({ searchParams: search({ notice: "Sent.", ok: "1" }) }),
    );
    expect(screen.getByText("Sent.")).toBeDefined();
  });

  describe("state", () => {
    it.each([
      [thread({ needsReply: true }), "waiting", "attention"],
      [thread({ needsReply: false, status: "open" }), "open", "verified"],
      [thread({ needsReply: false, status: "closed" }), "closed", "neutral"],
    ])("shows %#", (row, label, tone) => {
      expect(threadState(row)).toBe(label);
      expect(toneForThread(row)).toBe(tone);
    });
  });
});

describe("/admin/mail/[id]", () => {
  const params = Promise.resolve({ id: "t1" });

  it("requires an admin", async () => {
    render(await ThreadPage({ params, searchParams: search() }));
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("404s on a thread that does not exist", async () => {
    // The same answer as an id that is not a uuid, which is the one a prober
    // learns nothing from.
    getThreadMock.mockResolvedValue(undefined);
    await expect(
      ThreadPage({ params, searchParams: search() }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the conversation and a box to answer it in", async () => {
    render(await ThreadPage({ params, searchParams: search() }));

    expect(screen.getByText("It will not let me in.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Send" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Send and close" })).toBeDefined();
  });

  it("offers both send buttons off one textarea", async () => {
    // Two submit values rather than a template picker: they are the only two
    // things anyone does here, and without JavaScript a select cannot swap the
    // field the templates would otherwise disagree about.
    render(await ThreadPage({ params, searchParams: search() }));

    const send = screen.getByRole("button", { name: "Send" });
    const close = screen.getByRole("button", { name: "Send and close" });
    expect(send.getAttribute("value")).toBe("reply");
    expect(close.getAttribute("value")).toBe("resolved");
    expect(send.getAttribute("name")).toBe("template");
  });

  it("shows an open thread that nobody owes an answer on as settled", async () => {
    getThreadMock.mockResolvedValue(thread({ needsReply: false }));
    render(await ThreadPage({ params, searchParams: search() }));
    expect(screen.getByText("open")).toBeDefined();
  });

  it("defaults the language to the thread's", async () => {
    render(await ThreadPage({ params, searchParams: search() }));
    expect(
      screen.getByRole("combobox", { name: /Language/ }).getAttribute("value") ??
        (screen.getByRole("combobox", { name: /Language/ }) as HTMLSelectElement)
          .value,
    ).toBe("bg");
  });

  it("shows the address a reply will come back to", async () => {
    render(await ThreadPage({ params, searchParams: search() }));
    expect(screen.getByText(/support\+t1@/)).toBeDefined();
  });

  it("offers to close an open thread and to reopen a closed one", async () => {
    render(await ThreadPage({ params, searchParams: search() }));
    expect(screen.getByRole("button", { name: /Close without replying/ })).toBeDefined();

    cleanup();
    getThreadMock.mockResolvedValue(thread({ status: "closed", needsReply: false }));
    render(await ThreadPage({ params, searchParams: search() }));
    expect(screen.getByRole("button", { name: /Reopen without replying/ })).toBeDefined();
  });

  it("says whether the address belongs to an account", async () => {
    render(await ThreadPage({ params, searchParams: search() }));
    expect(screen.getByText("No account with this address")).toBeDefined();

    cleanup();
    accountForMock.mockResolvedValue({ id: "u9", name: "Ana", locale: "bg" });
    render(await ThreadPage({ params, searchParams: search() }));
    expect(screen.getByRole("link", { name: "Has an account" })).toBeDefined();
  });

  it("renders the reply fields the catalog declares", async () => {
    // Hand-written inputs are how a form ends up posting a name the catalog
    // stopped using; these come from the template itself.
    render(await ThreadPage({ params, searchParams: search() }));

    expect(screen.getByRole("textbox", { name: /Their name/ })).toBeDefined();
    expect(screen.getByRole("textbox", { name: /Your answer/ })).toBeDefined();
  });

  it("falls back to the account's name when the thread has none", async () => {
    getThreadMock.mockResolvedValue(thread({ participantName: null }));
    accountForMock.mockResolvedValue({ id: "u9", name: "Ana", locale: "bg" });

    render(await ThreadPage({ params, searchParams: search() }));
    expect(
      (screen.getByRole("textbox", { name: /Their name/ }) as HTMLInputElement).value,
    ).toBe("Ana");
  });

  it("uses the address itself when nothing names the person", async () => {
    getThreadMock.mockResolvedValue(thread({ participantName: null }));
    render(await ThreadPage({ params, searchParams: search() }));
    expect(screen.getByText("With ana@example.com.")).toBeDefined();
  });

  describe("Message", () => {
    it("distinguishes what they said from what we said", async () => {
      // An inbox where you have to check the addresses before you understand a
      // line is one that gets misread under time pressure.
      const { container } = render(<Message message={message()} />);
      expect(container.querySelector(".border-l-attention")).not.toBeNull();

      cleanup();
      const ours = render(
        <Message
          message={message({
            direction: "outbound",
            sentByEmail: "admin@example.com",
            template: "reply",
            status: "sent",
          })}
        />,
      );
      expect(ours.container.querySelector(".border-l-accent")).not.toBeNull();
      expect(screen.getByText("admin@example.com")).toBeDefined();
      expect(screen.getByText("template reply")).toBeDefined();
    });

    it("names us when an outbound message has no operator on it", () => {
      render(<Message message={message({ direction: "outbound" })} />);
      expect(screen.getByText("us")).toBeDefined();
    });

    it("shows why a send failed", () => {
      render(
        <Message
          message={message({
            direction: "outbound",
            status: "failed",
            error: "Resend is down",
          })}
        />,
      );
      expect(screen.getByText("Resend is down")).toBeDefined();
    });
  });
});

describe("/admin/mail/compose", () => {
  it("requires an admin", async () => {
    render(await ComposePage({ searchParams: search() }));
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("offers only the templates that can start a conversation", async () => {
    // A reply's subject is the thread's, so sent cold it arrives as "Re:" a
    // conversation the reader never had.
    expect(COMPOSABLE.map((template) => template.id)).toEqual([
      "welcome",
      "checkIn",
      "packReady",
    ]);
  });

  it("asks for a template before it asks for anything else", async () => {
    render(await ComposePage({ searchParams: search() }));

    expect(screen.getByRole("button", { name: "Load the template" })).toBeDefined();
    expect(screen.queryByText("Read it, then send it")).toBeNull();
  });

  it("renders the fields the chosen template declares", async () => {
    render(await ComposePage({ searchParams: search({ template: "checkIn" }) }));

    expect(screen.getByRole("textbox", { name: /Their name/ })).toBeDefined();
    expect(screen.getByRole("textbox", { name: /The goal they set/ })).toBeDefined();
  });

  it("ignores a template that can only be a reply", async () => {
    render(await ComposePage({ searchParams: search({ template: "reply" }) }));
    expect(screen.getByRole("button", { name: "Load the template" })).toBeDefined();
  });

  it("previews the message that will actually be sent", async () => {
    render(
      await ComposePage({
        searchParams: search({
          template: "welcome",
          to: "ana@example.com",
          name: "Ana",
        }),
      }),
    );

    expect(screen.getByText("Welcome to MeritKeep, Ana")).toBeDefined();
    // Signed by the operator, not by the brand.
    expect(screen.getByText(/— Nikolay/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Send to ana@example.com" }),
    ).toBeDefined();
  });

  it("previews in the reader's language", async () => {
    render(
      await ComposePage({
        searchParams: search({
          template: "welcome",
          to: "ana@example.com",
          name: "Ana",
          locale: "de",
        }),
      }),
    );
    expect(screen.getByText("Willkommen bei MeritKeep, Ana")).toBeDefined();
  });

  it("defaults the language and the name to the account behind the address", async () => {
    // An operator who has to look the account up first will eventually not.
    accountForMock.mockResolvedValue({ id: "u9", name: "Ana Ivanova", locale: "bg" });

    render(
      await ComposePage({
        searchParams: search({ template: "welcome", to: "ana@example.com" }),
      }),
    );

    expect(
      (screen.getByRole("textbox", { name: /Their name/ }) as HTMLInputElement).value,
    ).toBe("Ana Ivanova");
    expect(screen.getByText("Добре дошли в MeritKeep, Ana Ivanova")).toBeDefined();
  });

  it("will not offer to send until every hole is filled", async () => {
    render(
      await ComposePage({
        searchParams: search({ template: "checkIn", to: "ana@example.com", name: "Ana" }),
      }),
    );

    expect(screen.getByText(/Fill in goal/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
  });

  it("counts a missing recipient as a hole", async () => {
    render(
      await ComposePage({ searchParams: search({ template: "welcome", name: "Ana" }) }),
    );
    expect(screen.getByText(/Fill in a recipient/)).toBeDefined();
  });

  it("reports the outcome of a send", async () => {
    render(
      await ComposePage({
        searchParams: search({ notice: "Could not send.", ok: "0" }),
      }),
    );
    expect(screen.getByText("Could not send.")).toBeDefined();
  });
});

describe("the shared parts", () => {
  it("reads one value out of a repeated query parameter", () => {
    expect(one(["a", "b"])).toBe("a");
    expect(one("a")).toBe("a");
    expect(one(undefined)).toBeUndefined();
  });

  it.each([
    ["sent", "verified"],
    ["received", "verified"],
    ["failed", "problem"],
    // A bounce is neither success nor our failure: the address is wrong, and
    // that is something for the operator to act on rather than to retry.
    ["bounced", "attention"],
    ["complained", "attention"],
  ])("tones %s as %s", (status, tone) => {
    expect(toneForMessage(status)).toBe(tone);
  });

  it("renders a multiline variable as a textarea and the rest as inputs", () => {
    render(
      <Fields template={templateById("checkIn")!} values={{}} required={false} />,
    );
    expect(screen.queryByRole("textbox", { name: /Your answer/ })).toBeNull();

    cleanup();
    render(
      <Fields template={templateById("reply")!} values={{}} required={false} />,
    );
    expect(
      screen.getByRole("textbox", { name: /Your answer/ }).tagName,
    ).toBe("TEXTAREA");
  });
});
