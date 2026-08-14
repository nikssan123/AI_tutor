/**
 * The timezone list, grouped by region, with each zone's current offset on it.
 *
 * This exists because the field it feeds used to be an `<input list>` over a
 * bare `Intl.supportedValuesOf("timeZone")` datalist, and a datalist is the
 * wrong control for this: it only suggests once you have typed, and what it
 * matches against is the raw IANA id. So finding your own timezone required
 * knowing that Sofia is filed under `Europe/` and typing that prefix first —
 * and on the mobile browsers that render a datalist as nothing at all, it
 * required knowing the whole string. A `<select>` is browsable, has type-ahead
 * the platform provides for free, and still ships no JavaScript.
 *
 * The offsets are the other half. "Europe/Kyiv" and "Europe/Sofia" are the same
 * hour today and were not two years ago, and the only way to tell from a list
 * of names is to already know. `(GMT+03:00)` on the row is the fact people are
 * actually checking for.
 */

import { isValidTimezone } from "./profile";

export interface ZoneOption {
  /** The IANA id, exactly as it goes into the column. */
  value: string;
  /** What the option row reads as: `Sofia (GMT+03:00)`. */
  label: string;
}

export interface ZoneGroup {
  area: string;
  zones: readonly ZoneOption[];
}

/**
 * Where the zones with no continent in front of them go.
 *
 * `UTC` is the whole membership in practice, and it has to be *somewhere* — an
 * `<optgroup>`-less stray option at the top of a grouped select renders
 * inconsistently and reads as a mistake.
 */
const UNIVERSAL = "Universal";

/**
 * The current offset, as the platform words it: `GMT+03:00`.
 *
 * Every zone the tz database knows produces this part — including the
 * three-quarter-hour ones like `Australia/Eucla` — so the lookup does not need
 * a fallback. `isValidTimezone` is what guarantees that for the one zone here
 * that did not come from the platform's own list.
 */
function offsetOf(zone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  }).formatToParts(now);

  return parts.find((part) => part.type === "timeZoneName")!.value;
}

/** `America/Argentina/Salta` → `Argentina · Salta (GMT-03:00)`. */
function toOption(value: string, now: Date): ZoneOption {
  const slash = value.indexOf("/");
  const place = (slash === -1 ? value : value.slice(slash + 1))
    .replaceAll("_", " ")
    .replaceAll("/", " · ");

  return { value, label: `${place} (${offsetOf(value, now)})` };
}

/**
 * 418 zones × one `Intl.DateTimeFormat` each is ~40ms, and it is the same 40ms
 * for every visitor to the page within a given hour.
 *
 * Keyed by the hour rather than computed once per process, because offsets are
 * not constant: a server that has been up since March would otherwise still be
 * telling everyone in Sofia they are on GMT+02:00 in July. Every DST transition
 * lands on the hour, so the hour is the granularity at which this can change.
 *
 * One entry, not a `Map` — it is a cache of "now", and yesterday's answer has
 * no reader.
 */
let cached: { hour: string; zones: readonly ZoneOption[] } | null = null;

function canonicalZones(now: Date): readonly ZoneOption[] {
  const hour = now.toISOString().slice(0, 13);
  if (cached?.hour === hour) return cached.zones;

  /*
   * `UTC` is appended because `supportedValuesOf` does not return it — the list
   * is canonical zone *locations*, and UTC is not a place. It is also the value
   * this product writes on a new account, so leaving it out would mean the
   * majority of rows had a timezone their own select could not display.
   */
  const zones = [...Intl.supportedValuesOf("timeZone"), "UTC"].map((zone) =>
    toOption(zone, now),
  );

  cached = { hour, zones };
  return zones;
}

/**
 * Every zone, grouped for a `<select>`, with `current` guaranteed to be in it.
 *
 * That guarantee is the reason this takes an argument at all.
 * `supportedValuesOf` returns canonical ids, and canonical is not the same as
 * current: India's zone is in there as `Asia/Calcutta`, not `Asia/Kolkata`, and
 * `Asia/Kathmandu` is absent entirely. A select built from the bare list would
 * therefore not contain the saved value for a real share of users — and a
 * select whose value is absent falls back to its *first* option, so the next
 * time one of them changed their name, the form would quietly move them to
 * Abidjan and re-plan their calendar around it.
 *
 * An unrecognised `current` is dropped rather than added: it cannot be
 * formatted, and `parseProfileForm` would refuse it on the way back in anyway.
 */
export function zoneGroups(
  current: string,
  now: Date = new Date(),
): readonly ZoneGroup[] {
  const canonical = canonicalZones(now);
  const known =
    canonical.some((zone) => zone.value === current) || !isValidTimezone(current);
  const all = known ? canonical : [...canonical, toOption(current, now)];

  const byArea = new Map<string, ZoneOption[]>();
  for (const zone of all) {
    const slash = zone.value.indexOf("/");
    const area = slash === -1 ? UNIVERSAL : zone.value.slice(0, slash);
    const group = byArea.get(area);
    if (group) group.push(zone);
    else byArea.set(area, [zone]);
  }

  // Universal first — it is one row, and burying UTC between Pacific and a
  // continent makes the one zone with no geography the hardest to find.
  const areas = [
    UNIVERSAL,
    ...[...byArea.keys()].filter((area) => area !== UNIVERSAL).sort(),
  ];

  return areas.map((area) => ({
    area,
    // Alphabetical by label, because that is what the platform's own type-ahead
    // matches on: typing "sof" in an open select should land on Sofia.
    zones: byArea.get(area)!.sort((a, b) => a.label.localeCompare(b.label)),
  }));
}
