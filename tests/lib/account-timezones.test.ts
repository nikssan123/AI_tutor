import { describe, expect, it } from "vitest";
import { zoneGroups, type ZoneGroup } from "@/lib/account/timezones";

/**
 * A fixed instant, so the offsets asserted below do not change with the season
 * the suite happens to run in. July: northern-hemisphere DST is in effect.
 */
const JULY = new Date("2026-07-01T12:00:00Z");
const JANUARY = new Date("2026-01-01T12:00:00Z");

const find = (groups: readonly ZoneGroup[], area: string) =>
  groups.find((group) => group.area === area);

const values = (groups: readonly ZoneGroup[]) =>
  groups.flatMap((group) => group.zones.map((zone) => zone.value));

const labelOf = (groups: readonly ZoneGroup[], value: string) =>
  values(groups).includes(value)
    ? groups.flatMap((g) => g.zones).find((z) => z.value === value)!.label
    : undefined;

describe("zoneGroups", () => {
  it("covers the platform's whole tz database", () => {
    const all = values(zoneGroups("UTC", JULY));
    expect(all.length).toBeGreaterThan(400);
    expect(all).toContain("Europe/Sofia");
    expect(all).toContain("Pacific/Auckland");
  });

  it("includes UTC, which the platform's own list leaves out", () => {
    // `supportedValuesOf` returns canonical zone *locations*, and UTC is not a
    // place. It is also the value a new account is created with, so leaving it
    // out would mean most rows had a timezone their own select could not show.
    expect(Intl.supportedValuesOf("timeZone")).not.toContain("UTC");

    const groups = zoneGroups("UTC", JULY);
    expect(values(groups)).toContain("UTC");
    expect(find(groups, "Universal")?.zones).toEqual([
      { value: "UTC", label: "UTC (GMT+00:00)" },
    ]);
  });

  it("keeps the saved zone selectable even when it is not a canonical id", () => {
    /*
     * The bug this exists to prevent. `Asia/Kolkata` is a real, valid zone that
     * `supportedValuesOf` does not return — it lists India as `Asia/Calcutta`.
     * A select built from the bare list would not contain the saved value, and
     * a select whose value is absent falls back to its first option: the next
     * time this user changed their name, the form would move them to Abidjan.
     */
    expect(Intl.supportedValuesOf("timeZone")).not.toContain("Asia/Kolkata");

    const groups = zoneGroups("Asia/Kolkata", JULY);
    expect(values(groups)).toContain("Asia/Kolkata");
    expect(labelOf(groups, "Asia/Kolkata")).toBe("Kolkata (GMT+05:30)");
  });

  it("does not add a zone that is already there under that name", () => {
    const groups = zoneGroups("Europe/Sofia", JULY);
    const sofia = values(groups).filter((zone) => zone === "Europe/Sofia");
    expect(sofia).toHaveLength(1);
  });

  it("drops a zone the platform cannot format at all", () => {
    // It could not be given an offset, and `parseProfileForm` would refuse it
    // on the way back in anyway.
    const groups = zoneGroups("Mars/Olympus", JULY);
    expect(values(groups)).not.toContain("Mars/Olympus");
    expect(values(groups)).toContain("UTC");
  });

  it("puts the current offset on every row", () => {
    const groups = zoneGroups("UTC", JULY);
    expect(labelOf(groups, "Europe/Sofia")).toBe("Sofia (GMT+03:00)");
    expect(labelOf(groups, "Europe/London")).toBe("London (GMT+01:00)");
  });

  it("re-reads the offsets when the season changes", () => {
    // The cache is keyed by the hour rather than computed once per process:
    // a server up since March must not still be telling London it is on BST.
    expect(labelOf(zoneGroups("UTC", JULY), "Europe/London")).toBe(
      "London (GMT+01:00)",
    );
    expect(labelOf(zoneGroups("UTC", JANUARY), "Europe/London")).toBe(
      "London (GMT+00:00)",
    );
  });

  it("serves a second call in the same hour from the cache", () => {
    const first = zoneGroups("UTC", JULY);
    const second = zoneGroups("UTC", new Date("2026-07-01T12:59:59Z"));
    expect(values(second)).toEqual(values(first));
  });

  it("reads a nested zone as a place, not a path", () => {
    expect(
      labelOf(zoneGroups("UTC", JULY), "America/Argentina/Salta"),
    ).toBe("Argentina · Salta (GMT-03:00)");
  });

  it("groups by continent, with Universal first", () => {
    const groups = zoneGroups("UTC", JULY);
    expect(groups[0]!.area).toBe("Universal");
    expect(groups.map((group) => group.area).slice(1)).toEqual([
      "Africa",
      "America",
      "Antarctica",
      "Arctic",
      "Asia",
      "Atlantic",
      "Australia",
      "Europe",
      "Indian",
      "Pacific",
    ]);
  });

  it("sorts each group by label, which is what type-ahead matches on", () => {
    // Typing "sof" into an open select should land on Sofia, and the platform
    // matches against the option's text rather than its value.
    const europe = find(zoneGroups("UTC", JULY), "Europe")!;
    const labels = europe.zones.map((zone) => zone.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("defaults to now, so a caller does not have to supply a clock", () => {
    expect(values(zoneGroups("UTC"))).toContain("Europe/Sofia");
  });
});
