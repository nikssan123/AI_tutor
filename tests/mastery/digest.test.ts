import { describe, expect, it } from "vitest";
import {
  retentionHealth,
  summarise,
  windowStart,
  WINDOW_DAYS,
  type DigestInput,
} from "@/lib/mastery/digest";
import type { Ledger, LedgerEntry, Standing } from "@/lib/mastery/ledger";

/**
 * §8 screen 11 — "weekly re-motivation and honest recalibration".
 *
 * The recalibration is the part worth defending: the same remaining work priced
 * at the pace the learner actually kept, rounded in the unflattering direction,
 * and withheld entirely when there is no pace to project from.
 */

const NOW = new Date("2026-08-13T12:00:00.000Z");

const input = (overrides: Partial<DigestInput> = {}): DigestInput => ({
  committedHours: 3,
  minutesLogged: 180,
  sessions: 4,
  moved: [],
  artefacts: 1,
  retention: { tracked: 0, slipping: 0 },
  remainingHours: 30,
  ...overrides,
});

const entry = (standing: Standing, name: string): LedgerEntry => ({
  skillSlug: name,
  name,
  statement: "do the thing",
  standing,
  submissionId: null,
  artefacts: 0,
  confidence: 0,
  shownDaysAgo: null,
  note: "",
});

const ledger = (canDo: Standing[], whatsLeft: Standing[]): Ledger => ({
  canDo: canDo.map((s, i) => entry(s, `${s}-${i}`)),
  whatsLeft: whatsLeft.map((s, i) => entry(s, `${s}-${i}`)),
});

describe("the window", () => {
  it("is a rolling seven days, not a calendar week", () => {
    // A calendar week would show an empty digest every Monday morning, and the
    // commitment it is compared against is expressed per week either way.
    expect(WINDOW_DAYS).toBe(7);
    expect(windowStart(NOW).toISOString()).toBe("2026-08-06T12:00:00.000Z");
  });
});

describe("hours against the commitment", () => {
  it("reports logged time in hours, to a tenth", () => {
    expect(summarise(input({ minutesLogged: 155 })).hoursLogged).toBe(2.6);
  });

  it("says the commitment was kept when it was met exactly", () => {
    expect(summarise(input({ minutesLogged: 180 })).keptCommitment).toBe(true);
    expect(summarise(input({ minutesLogged: 150 })).keptCommitment).toBe(false);
  });

  it("judges the hours it displays, not the ones underneath them", () => {
    // 179 minutes shows as "3 hours". Telling someone they came up short
    // beneath a line that reads "3 hours of the 3 you set aside" would look
    // like a bug, and arguing about the last minute is not what this screen
    // is for.
    const digest = summarise(input({ minutesLogged: 179 }));
    expect(digest.hoursLogged).toBe(3);
    expect(digest.keptCommitment).toBe(true);
  });

  it("passes the session count through untouched", () => {
    expect(summarise(input({ sessions: 2 })).sessions).toBe(2);
  });
});

describe("what moved", () => {
  it("orders by how far a skill moved, biggest first", () => {
    const digest = summarise(
      input({
        moved: [
          { name: "Metering", delta: 0.02 },
          { name: "Composition", delta: 0.3 },
        ],
      }),
    );

    expect(digest.moved.map((m) => m.name)).toEqual(["Composition", "Metering"]);
  });

  it("breaks a tie on name so the list never wobbles", () => {
    const digest = summarise(
      input({
        moved: [
          { name: "Metering", delta: 0.1 },
          { name: "Composition", delta: 0.1 },
        ],
      }),
    );

    expect(digest.moved.map((m) => m.name)).toEqual(["Composition", "Metering"]);
  });

  it("does not reorder the caller's array in place", () => {
    const moved = [
      { name: "Metering", delta: 0.02 },
      { name: "Composition", delta: 0.3 },
    ];
    summarise(input({ moved }));
    expect(moved[0]!.name).toBe("Metering");
  });
});

describe("the revised estimate", () => {
  it("rounds up, at the pace that was planned", () => {
    // 30 hours at 3 a week is 10; 31 is 11, not 10.3. A completion estimate
    // that rounds down is flattering in the one direction §4.2 law 3 forbids.
    expect(summarise(input({ remainingHours: 30 })).weeksAtCommitment).toBe(10);
    expect(summarise(input({ remainingHours: 31 })).weeksAtCommitment).toBe(11);
  });

  it("prices the same work at the pace actually kept", () => {
    const digest = summarise(input({ minutesLogged: 60, remainingHours: 30 }));
    expect(digest.hoursLogged).toBe(1);
    expect(digest.weeksAtCommitment).toBe(10);
    expect(digest.weeksAtActualPace).toBe(30);
  });

  it("gives no second estimate for a week with nothing in it", () => {
    // Dividing by zero to print "Infinity weeks" would be a joke at the
    // learner's expense.
    expect(summarise(input({ minutesLogged: 0 })).weeksAtActualPace).toBeNull();
  });

  it("reports remaining hours to a tenth", () => {
    expect(summarise(input({ remainingHours: 12.34 })).remainingHours).toBe(12.3);
  });
});

describe("retention health, read off the ledger", () => {
  it("counts what has been proved, held or lapsed", () => {
    const health = retentionHealth(
      ledger(["shown", "shown", "fading"], ["faded", "unproven", "untouched"]),
    );

    expect(health.tracked).toBe(4);
    // The two that need practice: one on its way out, one already out.
    expect(health.slipping).toBe(2);
  });

  it("reports nothing to hold on to before anything is proved", () => {
    expect(retentionHealth(ledger([], ["started", "untouched"]))).toEqual({
      tracked: 0,
      slipping: 0,
    });
  });

  it("reaches the digest as given", () => {
    const digest = summarise(input({ retention: { tracked: 5, slipping: 2 } }));
    expect(digest.tracked).toBe(5);
    expect(digest.slipping).toBe(2);
    expect(digest.artefacts).toBe(1);
    expect(digest.committedHours).toBe(3);
  });
});
