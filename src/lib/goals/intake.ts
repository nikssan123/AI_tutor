import {
  GoalSpec,
  MAX_WEEKLY_HOURS,
  MIN_WEEKLY_HOURS,
  OutcomeType,
  StatedLevel,
  STATED_CLARITY,
} from "@/lib/contracts/goal";
import { decode, replay, toDiagnostic } from "@/lib/check/session";
import type { DomainPack } from "@/lib/packs/types";
import type { MasteryState } from "@/lib/engine";

/**
 * §24 E3 — goal intake, deterministically.
 *
 * The plan's intake is a six-turn conversation driven by the Goal Analyzer
 * (§8 screen 3), and that is still what it should be. This is the half of it
 * that does not need a model: when the learner picks a subject from the
 * catalogue, every field of the `GoalSpec` is *stated* rather than inferred, so
 * there is nothing to analyse. The LLM's job was always to turn "I want to get
 * into data" into these fields — not to invent them.
 *
 * Writing it this way now means the conversation, when it arrives, plugs into a
 * contract that already has a working consumer, instead of being the first
 * thing that ever produced one.
 */

/**
 * What the learner typed, kept verbatim; the form's own words otherwise.
 *
 * Bounded here rather than left to the schema so that an over-long goal is
 * silently kept as much as we can store, instead of failing the whole form on a
 * field nothing reads yet. The `maxLength` on the input is a courtesy; it is
 * not a control, because nothing sent to a server is.
 */
function rawGoalFor(form: FormData, pack: DomainPack): string {
  const typed = String(form.get("rawGoal") ?? "").trim();
  return typed.length > 0
    ? typed.slice(0, 500)
    : `Get good at ${pack.name.toLowerCase()}`;
}

export type GoalFormResult =
  | { ok: true; spec: GoalSpec }
  | { ok: false; error: string };

/**
 * Parses the intake form into a `GoalSpec`.
 *
 * Returns an error rather than throwing, because every one of these is a person
 * mistyping a number into a form — not an exceptional condition — and a form
 * that 500s on "40 hours a week" is worse than one that says what it wanted.
 */
export function parseGoalForm(
  form: FormData,
  pack: DomainPack,
): GoalFormResult {
  const hours = Number(form.get("weeklyHours"));
  if (!Number.isFinite(hours) || hours < MIN_WEEKLY_HOURS || hours > MAX_WEEKLY_HOURS) {
    return {
      ok: false,
      error: `Weekly hours must be a number between ${MIN_WEEKLY_HOURS} and ${MAX_WEEKLY_HOURS}.`,
    };
  }

  const level = StatedLevel.safeParse(form.get("statedLevel"));
  if (!level.success) return { ok: false, error: "Pick where you're starting from." };

  const outcome = OutcomeType.safeParse(form.get("outcomeType"));
  if (!outcome.success) return { ok: false, error: "Pick what this is for." };

  const rawDeadline = String(form.get("deadline") ?? "").trim();
  const deadline = rawDeadline.length > 0 ? rawDeadline : null;

  const spec = GoalSpec.safeParse({
    rawGoal: rawGoalFor(form, pack),
    domain: pack.slug,
    targetOutcome: pack.name,
    outcomeType: outcome.data,
    statedLevel: level.data,
    weeklyHours: hours,
    deadline,
    motivation: String(form.get("motivation") ?? "").trim().slice(0, 500),
    constraints: [],
    existingAssets: [],
    clarity: STATED_CLARITY,
  });

  if (!spec.success) {
    // The only field left that can fail is the deadline, which arrives from a
    // date input and so is either a real ISO date or something hand-typed.
    return { ok: false, error: "That deadline isn't a date we can read." };
  }

  return { ok: true, spec: spec.data };
}

/**
 * §24 E11 — "the anonymous check result is preserved through signup".
 *
 * The check stores answers, not mastery (see `check/session.ts`), so carrying it
 * across is a replay through the same engine rather than a copy of a number.
 * That is what makes it safe: a cookie forged before signup cannot inject a
 * mastery score, because the only thing it can claim is *which answers were
 * given*, and self-marked answers are Tier 5 — which the BKT refuses to let
 * raise mastery no matter who is asking.
 *
 * Returns only the skills the check actually observed. Seeding a row for every
 * skill in the pack would write the pack's priors into the learner's record as
 * though they were evidence about them, and the projection reads
 * `evidenceCount` precisely to tell those apart.
 */
export function masteryFromCheck(
  pack: DomainPack,
  rawCookie: string | undefined,
  now: string,
): MasteryState[] {
  const cookie = decode(rawCookie);
  if (cookie.a.length === 0) return [];

  const { skills, items } = toDiagnostic(pack);
  const state = replay(cookie, skills, items, now);
  const observed = new Set(state.asked.map((a) => a.skillSlug));

  return skills
    .filter((s) => observed.has(s.slug))
    .map((s) => state.mastery[s.slug]!)
    .sort((a, b) => a.skillId.localeCompare(b.skillId));
}
