import { describe, expect, it } from "vitest";
import { dueSkills, readRange } from "@/lib/calendar/view";
import type { RetrievalCandidate } from "@/lib/engine";

/**
 * The one translation `/calendar` does on its own: queue rows, in the pack's
 * words. Everything else the view does is assembly, and is covered against a
 * real database in tests/calendar/store.test.ts.
 */

const TODAY = "2026-08-14";

describe("readRange", () => {
  const range = (month: string) => {
    const { from, to } = readRange(month, TODAY);
    return [from.toISOString(), to.toISOString()];
  };

  it("covers the year of weeks the streak counts over", () => {
    // The month on screen sits inside that year, so it adds nothing to the
    // start — and the end runs to the end of the month rather than to today,
    // because the rest of August is where the projections land.
    expect(range("2026-08")).toEqual([
      "2025-08-15T00:00:00.000Z",
      "2026-08-31T23:59:59.999Z",
    ]);
  });

  it("reaches back for a month older than the streak window", () => {
    expect(range("2024-01")).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2026-08-14T23:59:59.999Z",
    ]);
  });

  it("reaches forward for a month that has not happened yet", () => {
    expect(range("2026-11")).toEqual([
      "2025-08-15T00:00:00.000Z",
      "2026-11-30T23:59:59.999Z",
    ]);
  });

  it("stops at today for a month already gone", () => {
    expect(range("2026-05")).toEqual([
      "2025-08-15T00:00:00.000Z",
      "2026-08-14T23:59:59.999Z",
    ]);
  });
});

const queued = (skillId: string, dueAt: string): RetrievalCandidate => ({
  skillId,
  itemId: "triangle-equivalent",
  dueAt,
  estMinutes: 2,
});

describe("dueSkills", () => {
  it("dates a queued item by the day it comes due", () => {
    expect(
      dueSkills(
        [queued("metering", "2026-08-18T09:30:00.000Z")],
        new Map([["metering", "Metering and histogram"]]),
      ),
    ).toEqual([{ day: "2026-08-18", skillName: "Metering and histogram" }]);
  });

  it("drops a skill the pack no longer names", () => {
    // A pack edit leaves queue rows behind. `masteryFor` makes the same call
    // and for the same reason: a removed skill must not come back as a mystery
    // entry in someone's month.
    expect(
      dueSkills([queued("deleted", "2026-08-18T09:30:00.000Z")], new Map()),
    ).toEqual([]);
  });
});
