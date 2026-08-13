import { describe, expect, it } from "vitest";
import { findPack } from "@/lib/content";
import {
  buildLedger,
  CLAIMED,
  FADING_HORIZON_DAYS,
  slipping,
  type ArtefactEvidence,
} from "@/lib/mastery/ledger";
import { MASTERY_TARGET } from "@/lib/engine/scoring";
import type { MasteryState } from "@/lib/engine";

/**
 * §24 E9's acceptance criterion, as a test: *every capability statement links
 * to the artefact that proves it*.
 *
 * Which is really a test of the opposite — that a skill the numbers like, with
 * nothing handed in behind it, is kept out of the claim list however good the
 * numbers are. That rule is the product (§4.2 law 1); the rest of this file is
 * the wording a learner sees when it applies to them.
 */

const pack = findPack("photography")!;
const [first, second, third] = pack.skills;
const NOW = "2026-08-13T12:00:00.000Z";

const state = (
  slug: string,
  overrides: Partial<MasteryState> = {},
): MasteryState => ({
  skillId: slug,
  mastery: 0.95,
  confidence: 0.8,
  evidenceCount: 2,
  lastSuccessAt: "2026-08-12T12:00:00.000Z",
  lastPracticedAt: "2026-08-12T12:00:00.000Z",
  decayHalfLifeDays: 180,
  ...overrides,
});

const evidence = (
  entries: Array<[string, ArtefactEvidence]> = [],
): Map<string, ArtefactEvidence> => new Map(entries);

const marked = (submissionId = "sub-1", count = 1): ArtefactEvidence => ({
  submissionId,
  count,
});

function ledgerOf(
  mastery: MasteryState[],
  known: Array<[string, ArtefactEvidence]> = [],
  now = NOW,
) {
  return buildLedger({
    skills: pack.skills,
    mastery,
    evidence: evidence(known),
    now,
  });
}

describe("what counts as something you can do", () => {
  it("claims a skill only when marked work sits behind it", () => {
    const ledger = ledgerOf(
      [state(first!.slug)],
      [[first!.slug, marked("sub-9")]],
    );

    expect(ledger.canDo.map((e) => e.skillSlug)).toEqual([first!.slug]);
    expect(ledger.canDo[0]!.standing).toBe("shown");
    // The link is the criterion. A claim you cannot open is the claim every
    // competitor already makes.
    expect(ledger.canDo[0]!.submissionId).toBe("sub-9");
    expect(ledger.canDo[0]!.statement).toBe(first!.canDoStatement);
  });

  it("refuses to claim a skill the learner only answered questions on", () => {
    // Mastery of 0.95 off the back of checks alone. The planner will happily
    // skip this skill; this screen still will not say you can do it.
    const ledger = ledgerOf([state(first!.slug)]);

    expect(ledger.canDo).toHaveLength(0);
    expect(ledger.whatsLeft[0]!.standing).toBe("unproven");
    expect(ledger.whatsLeft[0]!.note).toBe(
      "You've answered questions on this, but nothing you've handed in shows it yet.",
    );
    expect(ledger.whatsLeft[0]!.submissionId).toBeNull();
  });

  it("counts how many pieces of work a claim rests on", () => {
    const one = ledgerOf([state(first!.slug)], [[first!.slug, marked("s", 1)]]);
    const many = ledgerOf([state(first!.slug)], [[first!.slug, marked("s", 3)]]);

    expect(one.canDo[0]!.note).toBe("Shown in the work you handed in.");
    expect(many.canDo[0]!.artefacts).toBe(3);
    expect(many.canDo[0]!.note).toBe(
      "Shown in 3 pieces of work you handed in.",
    );
  });

  it("says nothing about a skill that has never been checked", () => {
    const ledger = ledgerOf([]);

    expect(ledger.canDo).toHaveLength(0);
    expect(ledger.whatsLeft).toHaveLength(pack.skills.length);
    expect(ledger.whatsLeft[0]!.standing).toBe("untouched");
    expect(ledger.whatsLeft[0]!.note).toBe("Nothing checked yet.");
    // A pack's priors are a guess about strangers, so a row with no
    // observations behind it carries no confidence either.
    expect(ledger.whatsLeft[0]!.confidence).toBe(0);
  });

  it("treats a row with no observations as untouched, priors notwithstanding", () => {
    const ledger = ledgerOf([state(first!.slug, { evidenceCount: 0 })]);
    expect(ledger.whatsLeft[0]!.standing).toBe("untouched");
  });

  it("is honest about a skill still on its way up", () => {
    const ledger = ledgerOf([state(first!.slug, { mastery: 0.4 })]);

    expect(ledger.whatsLeft[0]!.standing).toBe("started");
    expect(ledger.whatsLeft[0]!.note).toBe(
      "Some signal so far — not enough to say you can do it.",
    );
  });

  it("separates work handed in from work that showed anything", () => {
    // A marked hand-in that failed is evidence of an attempt, not of a skill —
    // and `lastSuccessAt` staying null is exactly how the engine records that.
    const ledger = ledgerOf(
      [state(first!.slug, { mastery: 0.3, lastSuccessAt: null })],
      [[first!.slug, marked()]],
    );

    expect(ledger.whatsLeft[0]!.standing).toBe("started");
    expect(ledger.whatsLeft[0]!.note).toBe(
      "You handed work in, and it didn't show this one yet.",
    );
    // The work is still linked: it is theirs, and it is worth re-reading.
    expect(ledger.whatsLeft[0]!.submissionId).toBe("sub-1");
  });

  it("falls back to 'not enough' when marked work leaves a skill short", () => {
    const ledger = ledgerOf(
      [state(first!.slug, { mastery: 0.4 })],
      [[first!.slug, marked()]],
    );

    expect(ledger.whatsLeft[0]!.standing).toBe("started");
    expect(ledger.whatsLeft[0]!.note).toBe(
      "Some signal so far — not enough to say you can do it.",
    );
  });
});

describe("decay, made visible (§24 E9)", () => {
  it("warns while a claim still stands but would not stand next week", () => {
    // Held at the bar today, under it in seven days: the only warning worth
    // giving is the one that arrives before the thing is lost.
    const ledger = ledgerOf(
      [
        state(first!.slug, {
          mastery: 0.9,
          decayHalfLifeDays: 7,
          lastSuccessAt: "2026-08-13T00:00:00.000Z",
        }),
      ],
      [[first!.slug, marked()]],
    );

    expect(ledger.canDo[0]!.standing).toBe("fading");
    expect(ledger.canDo[0]!.note).toBe(
      "Shown 1 day ago — without a refresher it stops counting within a week.",
    );
  });

  it("moves a lapsed claim back onto the path and says so", () => {
    const ledger = ledgerOf(
      [
        state(first!.slug, {
          mastery: 0.95,
          decayHalfLifeDays: 7,
          lastSuccessAt: "2026-07-14T12:00:00.000Z",
        }),
      ],
      [[first!.slug, marked()]],
    );

    expect(ledger.canDo).toHaveLength(0);
    expect(ledger.whatsLeft[0]!.standing).toBe("faded");
    expect(ledger.whatsLeft[0]!.note).toBe(
      "You showed this 30 days ago. It has faded since, so it is back on your path.",
    );
    // Still linked. The evidence did not stop existing; the claim did.
    expect(ledger.whatsLeft[0]!.submissionId).toBe("sub-1");
  });

  it("keeps a fresh claim quiet", () => {
    const ledger = ledgerOf(
      [state(first!.slug)],
      [[first!.slug, marked()]],
    );
    expect(ledger.canDo[0]!.standing).toBe("shown");
  });

  it("asks whether a skill would still clear the bar in a week", () => {
    const fresh = state(first!.slug, {
      mastery: 1,
      decayHalfLifeDays: 180,
      lastSuccessAt: NOW,
    });
    const brittle = state(first!.slug, {
      mastery: 0.9,
      decayHalfLifeDays: 7,
      lastSuccessAt: NOW,
    });

    expect(slipping(fresh, NOW)).toBe(false);
    expect(slipping(brittle, NOW)).toBe(true);
    expect(FADING_HORIZON_DAYS).toBe(7);
  });

  it("counts days in the plural only when there are several", () => {
    const note = (lastSuccessAt: string) =>
      ledgerOf(
        [
          state(first!.slug, {
            mastery: 0.95,
            decayHalfLifeDays: 7,
            lastSuccessAt,
          }),
        ],
        [[first!.slug, marked()]],
      ).whatsLeft[0]!.note;

    expect(note("2026-07-14T12:00:00.000Z")).toMatch(/30 days ago/);
    expect(note("2026-08-01T12:00:00.000Z")).toMatch(/12 days ago/);
  });

  it("says 'today' rather than '0 days ago'", () => {
    // What the arithmetic says is not what anyone would write, and this is
    // reachable the moment someone hands work in on the day they read the page.
    const ledger = ledgerOf(
      [
        state(first!.slug, {
          mastery: 0.9,
          decayHalfLifeDays: 7,
          lastSuccessAt: NOW,
        }),
      ],
      [[first!.slug, marked()]],
    );

    expect(ledger.canDo[0]!.note).toBe(
      "Shown today — without a refresher it stops counting within a week.",
    );
  });
});

describe("the shape of the two lists", () => {
  it("puts the most recently shown skill at the top of the claim list", () => {
    const ledger = ledgerOf(
      [
        state(first!.slug, { lastSuccessAt: "2026-08-01T12:00:00.000Z" }),
        state(second!.slug, { lastSuccessAt: "2026-08-12T12:00:00.000Z" }),
      ],
      [
        [first!.slug, marked("older")],
        [second!.slug, marked("newer")],
      ],
    );

    expect(ledger.canDo.map((e) => e.skillSlug)).toEqual([
      second!.slug,
      first!.slug,
    ]);
    expect(ledger.canDo.map((e) => e.shownDaysAgo)).toEqual([1, 12]);
  });

  it("breaks a tie on slug so the order never wobbles", () => {
    const ledger = ledgerOf(
      [state(second!.slug), state(third!.slug)],
      [
        [second!.slug, marked("b")],
        [third!.slug, marked("c")],
      ],
    );

    const slugs = ledger.canDo.map((e) => e.skillSlug);
    expect(slugs).toEqual([...slugs].sort());
  });

  it("leaves what's left in pack order, which is roughly path order", () => {
    const ledger = ledgerOf([]);
    expect(ledger.whatsLeft.map((e) => e.skillSlug)).toEqual(
      pack.skills.map((s) => s.slug),
    );
  });

  it("puts every skill in exactly one list", () => {
    const ledger = ledgerOf(
      [state(first!.slug), state(second!.slug, { mastery: 0.2 })],
      [[first!.slug, marked()]],
    );

    expect(ledger.canDo.length + ledger.whatsLeft.length).toBe(
      pack.skills.length,
    );
    expect(CLAIMED).toEqual(["shown", "fading"]);
  });

  it("claims nothing below the bar the path screen uses", () => {
    // One bar for "you have this", shared with `projectSkills`, so the two
    // screens cannot disagree about where the line is.
    const just = state(first!.slug, {
      mastery: MASTERY_TARGET,
      lastSuccessAt: NOW,
    });
    const under = state(first!.slug, {
      mastery: MASTERY_TARGET - 0.01,
      lastSuccessAt: NOW,
    });

    expect(
      ledgerOf([just], [[first!.slug, marked()]]).canDo,
    ).toHaveLength(1);
    expect(
      ledgerOf([under], [[first!.slug, marked()]]).canDo,
    ).toHaveLength(0);
  });
});
