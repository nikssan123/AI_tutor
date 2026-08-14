import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadPack } from "@/lib/packs/loader";
import { findPack } from "@/lib/content";
import { MASTERY_TARGET } from "@/lib/engine/scoring";
import { CURRICULUM_MASTERED_THRESHOLD } from "@/lib/curriculum/validate";
import type { MasteryState } from "@/lib/engine";
import {
  buildRoadmap,
  DEFAULT_WEEKLY_HOURS,
  defaultSubject,
  groupByWeek,
  weeklyHoursFrom,
} from "@/lib/roadmap/plan";

/**
 * §19.1's Roadmap Generator, which generates nothing.
 *
 * These are the tests that hold that claim up: the same inputs produce the same
 * plan, the plan is the pack's own order, and the only thing that shortens it is
 * evidence. No model is mocked here because none is called.
 */

const sql = () => findPack("sql-data-analysis")!;
const now = "2026-08-14T09:00:00.000Z";

/** A skill the learner has demonstrably cleared — evidence, not a claim. */
const proved = (skillId: string): MasteryState => ({
  skillId,
  mastery: 0.97,
  confidence: 0.9,
  evidenceCount: 3,
  lastSuccessAt: now,
  lastPracticedAt: now,
  decayHalfLifeDays: 30,
});

describe("weeklyHoursFrom", () => {
  it("defaults when nothing was asked for", () => {
    expect(weeklyHoursFrom(undefined)).toBe(DEFAULT_WEEKLY_HOURS);
  });

  it("takes a real number off the URL", () => {
    expect(weeklyHoursFrom("6.5")).toBe(6.5);
  });

  /**
   * This is a URL a stranger can edit, so every one of these is reachable from
   * the address bar. A free tool answers anyway; §19.1's whole point is that
   * the check and the plan are useful before anyone has committed to anything,
   * and a validation message is not useful.
   */
  it.each([
    ["nonsense", DEFAULT_WEEKLY_HOURS],
    ["", DEFAULT_WEEKLY_HOURS],
    ["0", DEFAULT_WEEKLY_HOURS],
    ["-4", DEFAULT_WEEKLY_HOURS],
    ["Infinity", DEFAULT_WEEKLY_HOURS],
    // Clamped to the bounds `contracts/goal` already enforces on a real goal,
    // so a number this tool accepts is one the product can record.
    ["0.1", 0.5],
    ["900", 40],
  ])("turns %o into %d", (raw, expected) => {
    expect(weeklyHoursFrom(raw)).toBe(expected);
  });
});

describe("buildRoadmap", () => {
  it("plans the pack's own path, in dependency order", () => {
    const roadmap = buildRoadmap({
      pack: sql(),
      mastery: [],
      weeklyHours: 4,
      now,
    })!;

    expect(roadmap.entries.length).toBeGreaterThan(10);
    // Weeks never go backwards: the order is the topological one, and the week
    // is a running total over it.
    const weeks = roadmap.entries.map((e) => e.week);
    expect(weeks).toEqual([...weeks].sort((a, b) => a - b));
    expect(roadmap.entries[0]!.week).toBe(1);
  });

  it("is deterministic — the same question twice is the same plan", () => {
    const once = buildRoadmap({ pack: sql(), mastery: [], weeklyHours: 4, now });
    const twice = buildRoadmap({ pack: sql(), mastery: [], weeklyHours: 4, now });
    expect(once).toEqual(twice);
  });

  it("puts the hours where the pace puts them", () => {
    const slow = buildRoadmap({ pack: sql(), mastery: [], weeklyHours: 1, now })!;
    const fast = buildRoadmap({ pack: sql(), mastery: [], weeklyHours: 8, now })!;

    // Same work, different calendar. The hours are a property of the subject;
    // only the weeks answer to the learner.
    expect(slow.totalHours).toBe(fast.totalHours);
    expect(slow.weeks).toBeGreaterThan(fast.weeks);
    expect(slow.weeks).toBe(Math.ceil(slow.totalHours / 1));
  });

  it("says when a piece of work runs past the week it starts in", () => {
    // At half an hour a week almost everything spans, which is the honest
    // rendering — a single week number for a fortnight's work is the flattering
    // rounding §4.2 law 3 rules out.
    const roadmap = buildRoadmap({
      pack: sql(),
      mastery: [],
      weeklyHours: 0.5,
      now,
    })!;
    expect(roadmap.entries.some((e) => e.through > e.week)).toBe(true);
    for (const entry of roadmap.entries) {
      expect(entry.through, entry.title).toBeGreaterThanOrEqual(entry.week);
    }
  });

  /**
   * §4.2 law 1, which is the reason this tool has no level field: the plan is
   * the subject's until something is *proved*. This is what "proved" means to
   * the builder, asserted directly — the page passes no mastery at all, because
   * a Skill Check cannot currently reach this bar (see `plan.ts`).
   */
  it("drops a skill from the plan on evidence, and only on evidence", () => {
    const pack = sql();
    const first = pack.skills[0]!;

    const blind = buildRoadmap({ pack, mastery: [], weeklyHours: 4, now })!;
    const proven = buildRoadmap({
      pack,
      mastery: [proved(first.slug)],
      weeklyHours: 4,
      now,
    })!;

    expect(blind.entries.map((e) => e.title)).toContain(first.name);
    expect(proven.entries.map((e) => e.title)).not.toContain(first.name);
    expect(proven.totalHours).toBeLessThan(blind.totalHours);
  });

  /**
   * The tool's claim is that this is the plan the product itself would teach
   * from, so it has to obey the product's two bars rather than a third of its
   * own — and there genuinely are two. `MASTERY_TARGET` (0.85) answers "is this
   * skill finished?"; `CURRICULUM_MASTERED_THRESHOLD` (0.8) answers "is putting
   * this on a curriculum going to waste someone's time?", and a module is hours
   * of work rather than one session, which is why the second bar is lower.
   *
   * A skill between them is still owed hours by the estimate and is still left
   * off the plan. That is the composition working, and it is worth pinning:
   * anyone who "fixes" it by passing one bar to both places changes what a
   * learner is shown on `/goals/{id}/path` too.
   */
  it("keeps the product's own two bars rather than inventing a third", () => {
    const pack = sql();
    const first = pack.skills[0]!;
    const between: MasteryState = { ...proved(first.slug), mastery: 0.82 };

    expect(between.mastery).toBeLessThan(MASTERY_TARGET);
    expect(between.mastery).toBeGreaterThan(CURRICULUM_MASTERED_THRESHOLD);

    const roadmap = buildRoadmap({
      pack,
      mastery: [between],
      weeklyHours: 4,
      now,
    })!;
    expect(roadmap.entries.map((e) => e.title)).not.toContain(first.name);
  });

  it("links each marked piece of work to the checklist it is marked against", () => {
    const roadmap = buildRoadmap({
      pack: sql(),
      mastery: [],
      weeklyHours: 4,
      now,
    })!;
    const graded = roadmap.entries.filter((e) => e.graded);

    expect(graded.length).toBe(roadmap.gradedCount);
    expect(graded.length).toBeGreaterThan(0);
    for (const entry of graded) {
      const project = sql().projects.find((p) => p.slug === entry.brief);
      expect(project, entry.title).toBeDefined();
      expect(project!.title).toBe(entry.title);
    }
    // A skill carries no brief — there is nothing published to link to.
    for (const entry of roadmap.entries.filter((e) => !e.graded)) {
      expect(entry.brief, entry.title).toBeNull();
    }
  });

  /**
   * §11 item 3 — "an explicit range with stated assumptions". The range is the
   * specialist tail the pack itself declares, which `projectSkills` leaves out
   * of the estimate on purpose, rather than a margin of error nobody measured.
   */
  it("quotes the specialist tail separately from the core path", () => {
    const roadmap = buildRoadmap({
      pack: sql(),
      mastery: [],
      weeklyHours: 4,
      now,
    })!;

    expect(roadmap.optionalHours).toBeGreaterThan(0);
    expect(roadmap.weeksWithOptional).toBeGreaterThan(roadmap.weeks);
    // And the tail is genuinely not in the plan.
    const specialist = sql().skills.filter((s) => s.level === "specialist");
    for (const skill of specialist) {
      expect(roadmap.entries.map((e) => e.title)).not.toContain(skill.name);
    }
  });

  it("has no tail to quote when the pack declares none", () => {
    // The fixture has no specialist skills, which no real pack currently does —
    // this is the shape the catalogue never produces.
    const roadmap = buildRoadmap({
      pack: loadPack(join("tests/fixtures/packs", "valid-minimal")),
      mastery: [],
      weeklyHours: 1,
      now,
    })!;

    expect(roadmap.optionalHours).toBe(0);
    expect(roadmap.weeksWithOptional).toBe(roadmap.weeks);
  });

  it("returns nothing rather than padding a plan out to a respectable length", () => {
    // Every skill proved: there is no plan left, and saying so is the answer.
    const pack = sql();
    const everything = pack.skills.map((s) => proved(s.slug));

    expect(buildRoadmap({ pack, mastery: everything, weeklyHours: 4, now })).toBeNull();
  });
});

describe("groupByWeek", () => {
  const entry = (week: number, hours: number, title: string) => ({
    week,
    through: week,
    title,
    hours,
    graded: false,
    canDo: "",
    brief: null,
  });

  it("gathers what starts in the same week and totals it", () => {
    expect(
      groupByWeek([entry(1, 1, "a"), entry(1, 1.5, "b"), entry(3, 2, "c")]),
    ).toEqual([
      { week: 1, hours: 2.5, entries: [entry(1, 1, "a"), entry(1, 1.5, "b")] },
      { week: 3, hours: 2, entries: [entry(3, 2, "c")] },
    ]);
  });

  it("emits no week in which nothing starts", () => {
    // Week 2 is missing above and that is deliberate: an empty row headed
    // "Week 2" reads as a week off, when what it means is that week 1's work is
    // still running.
    expect(groupByWeek([entry(1, 1, "a"), entry(3, 2, "c")]).map((g) => g.week))
      .toEqual([1, 3]);
  });

  it("handles a plan with nothing in it", () => {
    expect(groupByWeek([])).toEqual([]);
  });
});

describe("defaultSubject", () => {
  const topic = (slug: string, skillCount: number, indexable: boolean) => ({
    slug,
    skillCount,
    indexable,
  });

  it("picks the deepest subject we publicly stand behind", () => {
    expect(
      defaultSubject([
        topic("small-reviewed", 4, true),
        topic("big-unreviewed", 90, false),
        topic("bigger-reviewed", 9, true),
      ]),
    ).toEqual(topic("bigger-reviewed", 9, true));
  });

  it("breaks a tie on the slug, so it cannot move between deploys", () => {
    expect(
      defaultSubject([topic("b", 5, true), topic("a", 5, true)])!.slug,
    ).toBe("a");
  });

  it("falls back to the catalogue when nothing has been reviewed yet", () => {
    // Every environment before a pack is signed off, and every environment at
    // all until three passes ago.
    expect(
      defaultSubject([topic("a", 2, false), topic("b", 7, false)])!.slug,
    ).toBe("b");
  });

  it("has no answer for an empty catalogue", () => {
    expect(defaultSubject([])).toBeUndefined();
  });
});
