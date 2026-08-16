import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryTransport, setTransport } from "@/lib/email";
import {
  failureBody,
  failureSubject,
  notifyBuildFailed,
  notifyPackReady,
  type BuildFailure,
} from "@/lib/packs/notify";

/**
 * Telling the team a build stopped.
 *
 * The learner used to be handed a "Try again" button, which asked the one
 * person who cannot tell a bad subject from a bad afternoon to spend four model
 * calls on a guess. The button is gone, so this is now the only thing standing
 * between a failed build and nobody ever knowing — which is why the record of
 * it is asserted as carefully as the mail itself.
 */

const FAILURE: BuildFailure = {
  slug: "net-development",
  subject: ".NET development",
  detail: "7 items; a diagnostic needs at least 24",
  userId: "u1",
};

const transport = new MemoryTransport();
const marked: Array<{ slug: string; now: Date }> = [];

vi.mock("@/lib/packs/build", () => ({
  markBuildNotified: async (_db: unknown, slug: string, now: Date) => {
    marked.push({ slug, now });
  },
}));

const db = {} as never;
const NOW = new Date("2026-08-15T14:40:00.000Z");

beforeEach(() => {
  transport.clear();
  marked.length = 0;
  setTransport(transport);
});

afterEach(() => setTransport(undefined));

describe("the message", () => {
  it("leads with the subject, because that is what an inbox is scanned for", () => {
    expect(failureSubject(FAILURE)).toBe("Pack build stopped: .NET development");
  });

  it("carries every fact the reader can act on", () => {
    const body = failureBody(FAILURE);

    // The slug, because it is what `/admin/packs` keys the retry on.
    expect(body).toContain("net-development");
    expect(body).toContain("7 items; a diagnostic needs at least 24");
    expect(body).toContain("u1");
    // And where to act, since the learner no longer can.
    expect(body).toContain("/admin/packs");
  });

  it("says plainly when nobody is waiting", () => {
    // A script, a seed, a probe. An operator triaging a queue should not spend
    // a moment wondering who to apologise to.
    const body = failureBody({ ...FAILURE, userId: null });
    expect(body).toContain("nobody");
  });
});

describe("notifyBuildFailed", () => {
  it("sends to the team and records that it did", async () => {
    const sent = await notifyBuildFailed(db, FAILURE, NOW);

    expect(sent).toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.subject).toContain(".NET development");
    // Two writes, not one: the mail, and the row that proves it went.
    expect(marked).toEqual([{ slug: "net-development", now: NOW }]);
  });

  it("escapes the learner's own words in the html part", async () => {
    // The subject is a string somebody typed into a chat box.
    await notifyBuildFailed(
      db,
      { ...FAILURE, subject: '<img src=x onerror="alert(1)">' },
      NOW,
    );

    expect(transport.sent[0]!.html).not.toContain("<img");
    expect(transport.sent[0]!.html).toContain("&lt;img");
  });

  it("does not record a notification that failed to send", async () => {
    /*
     * The deliberate consequence of using `deliver`: a mail failure cannot take
     * the build pipeline down with it, so it returns false instead. What must
     * not happen is the row claiming the team was told — a failed build nobody
     * knows about is a second failure, and `/admin/packs` can only show it if
     * `notified_at` stays null.
     */
    setTransport({
      name: "broken",
      send: () => Promise.reject(new Error("Resend is having an afternoon")),
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const sent = await notifyBuildFailed(db, FAILURE, NOW);

    expect(sent).toBe(false);
    expect(marked).toEqual([]);
    logged.mockRestore();
  });
});

/**
 * Telling the learner their subject exists now.
 *
 * The mirror of everything above, and the send that was simply missing: a build
 * takes about three minutes on a queue, so the person who commissioned it is
 * very often gone by the time it lands. Until this, a pack that *worked*
 * produced a finished course, a wait screen nobody was looking at, and no mail
 * at all — while a pack that failed at least told somebody.
 */
describe("notifyPackReady", () => {
  /** A `db` whose one query answers with these rows. */
  const dbWith = (rows: unknown[]) =>
    ({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => rows }),
        }),
      }),
    }) as never;

  const READER = {
    email: "ana@example.com",
    locale: "en",
    theme: "system",
  };

  it("writes to the learner who asked, about the subject they asked for", async () => {
    const sent = await notifyPackReady(dbWith([READER]), {
      subject: ".NET development",
      userId: "u1",
    });

    expect(sent).toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.to).toBe("ana@example.com");
    expect(transport.sent[0]!.subject).toContain(".NET development");
  });

  it("sends them to the plan, which is what three minutes bought", () => {
    // `/today` shows one session; `/path` shows the whole course. The wait is
    // only justified by the second.
    return notifyPackReady(dbWith([READER]), {
      subject: "Rust",
      userId: "u1",
    }).then(() => {
      expect(transport.sent[0]!.text).toContain("/path");
    });
  });

  it("says nothing when there is nobody left to tell", async () => {
    /*
     * `requestedBy` is nullable and its docstring says the pack outlives the
     * person who asked for it, so a build finishing after its commissioner
     * deleted their account is a case that happens rather than one that is
     * broken.
     */
    const sent = await notifyPackReady(dbWith([]), {
      subject: "Rust",
      userId: "gone",
    });

    expect(sent).toBe(false);
    expect(transport.sent).toEqual([]);
  });

  it("writes in the reader's own language", async () => {
    // The locale is read off the row at send time, the same way every other
    // message in the product resolves one.
    await notifyPackReady(dbWith([{ ...READER, locale: "bg" }]), {
      subject: "Rust",
      userId: "u1",
    });

    expect(transport.sent[0]!.html).toContain('lang="bg"');
  });

  it("does not take the build down with it when the mail fails", async () => {
    /*
     * `deliver`, not `sendMessage` — the same argument the failure path makes.
     * The pack is built and seeded by this point; a transport having an
     * afternoon must not undo that. The honest consequence is that they find
     * the course on their next visit instead.
     */
    setTransport({
      name: "broken",
      send: () => Promise.reject(new Error("Resend is having an afternoon")),
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyPackReady(dbWith([READER]), { subject: "Rust", userId: "u1" }),
    ).resolves.toBe(false);

    logged.mockRestore();
  });

  it("leaves the build row's own notification record alone", async () => {
    /*
     * `pack_build.notified_at` means "the team was told this stopped" and is
     * read by `/admin/packs`, which lists stopped builds only. Widening it to
     * mean two things would make the one screen that depends on it ambiguous.
     */
    await notifyPackReady(dbWith([READER]), { subject: "Rust", userId: "u1" });

    expect(marked).toEqual([]);
  });
});
