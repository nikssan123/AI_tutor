import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two things `/admin/mail` can do to the outside world, as endpoints.
 *
 * What each one *does* is tested against a real database in tests/mail/send.ts.
 * What these assert is the endpoint contract: that the caller is re-established
 * from the session rather than from the form, that the operator's identity is
 * the guard's rather than the request's, and that the outcome comes back as a
 * redirect so the whole surface works with scripting off.
 */

const requireAdminMock = vi.fn();
const sendTemplatedEmailMock = vi.fn();
const changeThreadStatusMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const revalidatePathMock = vi.fn();
const appDb = { marker: "db" };

vi.mock("@/lib/admin/guard", () => ({ requireAdmin: () => requireAdminMock() }));
vi.mock("@/db", () => ({ getDb: () => appDb }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));
vi.mock("@/lib/mail/send", () => ({
  sendTemplatedEmail: (...args: unknown[]) => sendTemplatedEmailMock(...args),
  changeThreadStatus: (...args: unknown[]) => changeThreadStatusMock(...args),
}));

const { sendMailAction, setThreadStatusAction } = await import(
  "@/app/admin/mail/actions"
);

const ADMIN = {
  userId: "u0",
  email: "admin@example.com",
  name: "Nikolay",
  role: "admin",
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** Every action ends in a redirect, which throws. */
async function run(
  action: (data: FormData) => Promise<void>,
  fields: Record<string, string>,
): Promise<string> {
  try {
    await action(form(fields));
  } catch (error) {
    const message = String((error as Error).message);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN);
  sendTemplatedEmailMock.mockResolvedValue({
    ok: true,
    message: "Sent to ana@example.com.",
    threadId: "t1",
  });
  changeThreadStatusMock.mockResolvedValue({
    ok: true,
    message: "Thread closed.",
    threadId: "t1",
  });
});

describe("sendMailAction", () => {
  it("re-establishes the caller rather than trusting the page that rendered the button", async () => {
    // A Server Action is a public POST endpoint; the button being absent from
    // a non-admin's screen protects nothing.
    await run(sendMailAction, { template: "welcome", to: "ana@example.com", name: "Ana" });
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("refuses to act when the guard refuses", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(sendMailAction(form({ template: "welcome" }))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(sendTemplatedEmailMock).not.toHaveBeenCalled();
  });

  it("passes the operator's own identity, not the form's", async () => {
    await run(sendMailAction, {
      template: "welcome",
      to: "ana@example.com",
      name: "Ana",
      userId: "someone-else",
      email: "attacker@example.com",
    });

    expect(sendTemplatedEmailMock.mock.calls[0]![1]).toEqual(ADMIN);
    expect(sendTemplatedEmailMock.mock.calls[0]![0]).toBe(appDb);
  });

  it("collects only the variables the template declares", async () => {
    // The catalog decides what a template interpolates, not the request.
    await run(sendMailAction, {
      template: "checkIn",
      to: "ana@example.com",
      name: "Ana",
      goal: "SQL",
      sender: "Someone Else",
      brand: "NotMeritKeep",
    });

    expect(sendTemplatedEmailMock.mock.calls[0]![2].variables).toEqual({
      name: "Ana",
      goal: "SQL",
    });
  });

  it("collects nothing for a template that does not exist", async () => {
    await run(sendMailAction, { template: "nope", to: "ana@example.com" });
    expect(sendTemplatedEmailMock.mock.calls[0]![2].variables).toEqual({});
  });

  it("reads a declared field that was not posted as blank", async () => {
    // Which `sendTemplatedEmail` then refuses. The alternative is `undefined`
    // reaching the renderer and printing `{goal}` in somebody's inbox.
    await run(sendMailAction, { template: "checkIn", to: "ana@example.com" });
    expect(sendTemplatedEmailMock.mock.calls[0]![2].variables).toEqual({
      name: "",
      goal: "",
    });
  });

  it("copes with a post that names no template at all", async () => {
    await run(sendMailAction, { to: "ana@example.com" });
    expect(sendTemplatedEmailMock.mock.calls[0]![2].templateId).toBe("");
  });

  it("sends to an address when composing, and to a thread when replying", async () => {
    await run(sendMailAction, { template: "welcome", to: "ana@example.com", name: "Ana" });
    expect(sendTemplatedEmailMock.mock.calls[0]![2]).toMatchObject({
      to: "ana@example.com",
    });
    expect(sendTemplatedEmailMock.mock.calls[0]![2]).not.toHaveProperty("threadId");

    await run(sendMailAction, { template: "reply", threadId: "t7", name: "Ana", message: "Hi" });
    expect(sendTemplatedEmailMock.mock.calls[1]![2]).toMatchObject({ threadId: "t7" });
    expect(sendTemplatedEmailMock.mock.calls[1]![2]).not.toHaveProperty("to");
  });

  it("returns to the conversation, carrying the outcome", async () => {
    const url = await run(sendMailAction, {
      template: "welcome",
      to: "ana@example.com",
      name: "Ana",
    });

    expect(url).toBe(
      "/admin/mail/t1?notice=Sent+to+ana%40example.com.&ok=1",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/mail/t1");
  });

  it("returns to the conversation even when the send failed", async () => {
    // The failure is recorded on the thread, which is where it should be read.
    sendTemplatedEmailMock.mockResolvedValue({
      ok: false,
      message: "Could not send: Resend is down",
      threadId: "t1",
    });

    expect(
      await run(sendMailAction, { template: "welcome", to: "a@b.co", name: "A" }),
    ).toBe("/admin/mail/t1?notice=Could+not+send%3A+Resend+is+down&ok=0");
  });

  it("returns to the compose screen when there is no thread to return to", async () => {
    sendTemplatedEmailMock.mockResolvedValue({
      ok: false,
      message: "No template called \"nope\".",
    });

    expect(await run(sendMailAction, { template: "nope" })).toBe(
      '/admin/mail/compose?notice=No+template+called+%22nope%22.&ok=0',
    );
  });
});

describe("setThreadStatusAction", () => {
  it("re-establishes the caller", async () => {
    await run(setThreadStatusAction, { threadId: "t1", status: "closed" });
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("passes the status through", async () => {
    await run(setThreadStatusAction, { threadId: "t1", status: "closed" });
    expect(changeThreadStatusMock).toHaveBeenCalledWith(appDb, ADMIN, "t1", "closed");
  });

  it("treats anything that is not 'closed' as reopening", async () => {
    // The form only ever posts one of two values; a third is a request that
    // did not come from the form, and opening is the harmless reading.
    await run(setThreadStatusAction, { threadId: "t1", status: "deleted" });
    expect(changeThreadStatusMock.mock.calls[0]![3]).toBe("open");
  });

  it("copes with a post that names no thread", async () => {
    changeThreadStatusMock.mockResolvedValue({ ok: false, message: "No such thread." });
    await run(setThreadStatusAction, { status: "closed" });
    expect(changeThreadStatusMock.mock.calls[0]![2]).toBe("");
  });

  it("returns to the thread, carrying the outcome", async () => {
    expect(
      await run(setThreadStatusAction, { threadId: "t1", status: "closed" }),
    ).toBe("/admin/mail/t1?notice=Thread+closed.&ok=1");
  });
});
