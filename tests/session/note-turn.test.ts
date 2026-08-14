import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionBlock } from "@/lib/engine";

/**
 * PLAN-ADAPTATION step 3 — the write path, and mostly its failure modes.
 *
 * `noteTurn` runs *after* the tutor's answer has streamed to the learner. There
 * is no response left to fail, so the only correct behaviour when anything goes
 * wrong is to leave the system exactly as it was — which is the state it was in
 * before signals existed, and a perfectly good one.
 */

const classifyMock = vi.fn();
const recordSignalMock = vi.fn(async () => undefined);
const recordMisconceptionMock = vi.fn(async () => undefined);

vi.mock("@/lib/ai/call", () => ({
  callStructured: (...a: unknown[]) => classifyMock(...(a as [])),
}));
vi.mock("@/lib/ai/runlog", () => ({
  logCall: async (_db: unknown, _userId: unknown, result: unknown) => result,
}));
vi.mock("@/lib/session/store", () => ({
  recordTutorSignal: (...a: unknown[]) => recordSignalMock(...(a as [])),
  recordMisconception: (...a: unknown[]) => recordMisconceptionMock(...(a as [])),
}));

const { noteTurn } = await import("@/lib/session/signals");

const db = {} as never;
const client = {} as never;
const NOW = new Date("2026-08-13T09:00:00.000Z");

const block: SessionBlock = {
  type: "explain",
  skillId: "join-grain",
  content: "Teach join grain",
  estMinutes: 12,
};

const base = {
  userId: "u1",
  sessionId: "s1",
  packSlug: "sql-data-analysis",
  block,
  question: "I still don't follow",
  answer: "Here is another way to look at it",
  now: NOW,
};

function classifiedAs(signal: string, note: string | null = null) {
  classifyMock.mockResolvedValue({
    status: "ok",
    value: { signal, note },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("noteTurn", () => {
  it("files a stuck signal against the block's skill", async () => {
    classifiedAs("stuck");

    expect(await noteTurn(db, client, base)).toBe("stuck");
    expect(recordSignalMock).toHaveBeenCalledWith(db, {
      userId: "u1",
      sessionId: "s1",
      packSlug: "sql-data-analysis",
      skillSlug: "join-grain",
      signal: "stuck",
      now: NOW,
    });
    expect(recordMisconceptionMock).not.toHaveBeenCalled();
  });

  /**
   * There is no second list for the tutor's version of a wrong belief. It goes
   * where the grader's go, so it is revisited by the same machinery.
   */
  it("sends a misconception to the misconception table as well", async () => {
    classifiedAs("misconception", "thinks LEFT JOIN filters rows");

    expect(await noteTurn(db, client, base)).toBe("misconception");
    expect(recordMisconceptionMock).toHaveBeenCalledWith(db, {
      userId: "u1",
      packSlug: "sql-data-analysis",
      skillSlug: "join-grain",
      description: "thinks LEFT JOIN filters rows",
      now: NOW,
    });
    expect(recordSignalMock).toHaveBeenCalled();
  });

  it("writes nothing at all for an ordinary turn", async () => {
    classifiedAs("none");

    expect(await noteTurn(db, client, base)).toBe("none");
    expect(recordSignalMock).not.toHaveBeenCalled();
    expect(recordMisconceptionMock).not.toHaveBeenCalled();
  });

  it("downgrades a misconception that names no belief", async () => {
    classifiedAs("misconception", null);

    expect(await noteTurn(db, client, base)).toBe("none");
    expect(recordMisconceptionMock).not.toHaveBeenCalled();
    expect(recordSignalMock).not.toHaveBeenCalled();
  });

  it("records a signal with no skill when the block has none", async () => {
    classifiedAs("stuck");

    const outcome = await noteTurn(db, client, {
      ...base,
      block: { type: "reflect", prompt: "What was hardest?", estMinutes: 5 },
    });

    expect(outcome).toBe("stuck");
    expect(recordSignalMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ skillSlug: null }),
    );
  });

  it("cannot write a misconception it has no skill to attach to", async () => {
    classifiedAs("misconception", "some belief");

    await noteTurn(db, client, {
      ...base,
      block: { type: "reflect", prompt: "What was hardest?", estMinutes: 5 },
    });

    expect(recordMisconceptionMock).not.toHaveBeenCalled();
    // The signal row still lands: noticed, not attributable.
    expect(recordSignalMock).toHaveBeenCalled();
  });

  it("does nothing when the classification did not come back", async () => {
    classifyMock.mockResolvedValue({ status: "error", detail: "500" });

    expect(await noteTurn(db, client, base)).toBe("none");
    expect(recordSignalMock).not.toHaveBeenCalled();
  });

  /**
   * The swallow. The learner already has their answer; a label is a nicety, and
   * losing one must never turn a delivered answer into an error message.
   */
  it("swallows a classification that throws", async () => {
    classifyMock.mockRejectedValue(new Error("network"));

    await expect(noteTurn(db, client, base)).resolves.toBe("none");
    expect(recordSignalMock).not.toHaveBeenCalled();
  });

  it("swallows a write that throws", async () => {
    classifiedAs("stuck");
    recordSignalMock.mockRejectedValueOnce(new Error("deadlock"));

    await expect(noteTurn(db, client, base)).resolves.toBe("none");
  });
});
