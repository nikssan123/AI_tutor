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
import { subjectInProse } from "@/lib/subject-name";
import { CapturedGoal } from "./analyzer";
import type { Intake } from "./intake-store";

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
 * The subject radio's "not one of these" value, and the box that goes with it.
 *
 * §7.1's Generated tier is the whole reason the conversation accepts anything
 * at all, and the form is the same intake with the model taken out — so it
 * takes anything too. Two underscores because a pack slug cannot contain one:
 * this value shares a field with real slugs, and a sentinel that could also be
 * a pack is one that collides with a pack eventually.
 */
export const CUSTOM_SUBJECT = "__other";

/** What `CapturedGoal.subject` holds, which is where a typed one ends up. */
export const MAX_CUSTOM_SUBJECT = 120;

/**
 * The subject they typed, and nothing at all unless they also chose it.
 *
 * The box is revealed by its own radio in CSS, so it cannot be *filled in* for
 * a subject that is not selected — but a box filled in and then hidden again is
 * still submitted, so somebody who types "Rust", thinks better of it and picks
 * Photography sends both. Reading the field only when the radio names it keeps
 * the list the answer and the box a detail of one row.
 */
export function customSubjectFrom(form: FormData): string {
  if (String(form.get("topic") ?? "") !== CUSTOM_SUBJECT) return "";

  return String(form.get("customSubject") ?? "")
    .trim()
    .slice(0, MAX_CUSTOM_SUBJECT);
}

/**
 * What the learner typed, kept verbatim; the form's own words otherwise.
 *
 * Bounded here rather than left to the schema so that an over-long goal is
 * silently kept as much as we can store, instead of failing the whole form on a
 * field nothing reads yet. The `maxLength` on the input is a courtesy; it is
 * not a control, because nothing sent to a server is.
 */
function rawGoalFor(form: FormData, subject: string): string {
  const typed = String(form.get("rawGoal") ?? "").trim();
  return typed.length > 0
    ? typed.slice(0, 500)
    : `Get good at ${subjectInProse(subject)}`;
}

/**
 * The fields that are the same question whatever the subject turns out to be.
 *
 * Shared by the two parsers below rather than written twice, for the reason
 * `GoalSpec` is shared by the form and the conversation: a subject we have and
 * a subject we are about to write are not two different intakes, and three
 * validation rules kept in two places drift.
 */
type Answers = {
  hours: number;
  level: StatedLevel;
  outcome: OutcomeType;
  deadline: string | null;
  motivation: string;
};

type AnswersResult =
  | { ok: true; answers: Answers }
  | { ok: false; error: string };

function answersFrom(form: FormData): AnswersResult {
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

  return {
    ok: true,
    answers: {
      hours,
      level: level.data,
      outcome: outcome.data,
      deadline: rawDeadline.length > 0 ? rawDeadline : null,
      motivation: String(form.get("motivation") ?? "").trim().slice(0, 500),
    },
  };
}

/**
 * The one field neither parser can check itself: a date input hands back a real
 * ISO date, and a hand-typed one hands back anything.
 */
const BAD_DEADLINE = "That deadline isn't a date we can read.";

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
  const parsed = answersFrom(form);
  if (!parsed.ok) return parsed;
  const { answers } = parsed;

  const spec = GoalSpec.safeParse({
    rawGoal: rawGoalFor(form, pack.name),
    domain: pack.slug,
    targetOutcome: pack.name,
    outcomeType: answers.outcome,
    statedLevel: answers.level,
    weeklyHours: answers.hours,
    deadline: answers.deadline,
    motivation: answers.motivation,
    constraints: [],
    existingAssets: [],
    clarity: STATED_CLARITY,
  });

  if (!spec.success) return { ok: false, error: BAD_DEADLINE };

  return { ok: true, spec: spec.data };
}

export type CustomGoalResult =
  | { ok: true; intake: Intake }
  | { ok: false; error: string };

/**
 * The same form, for a subject we do not have yet.
 *
 * It cannot produce a `GoalSpec`, because a spec names a pack and the pack is
 * about to be written. What it produces instead is the intake the conversation
 * would have left behind — which is what the wait screen adopts from when the
 * build lands, and what `/start` renders if the build is refused or fails. The
 * alternative was a second store for form answers, and then two ways to turn a
 * finished build into a goal.
 *
 * `clarity` is `STATED_CLARITY` for the reason the form's own spec is: nothing
 * here was inferred. Every field was asked for directly and answered directly.
 */
export function parseCustomGoalForm(
  form: FormData,
  subject: string,
): CustomGoalResult {
  const parsed = answersFrom(form);
  if (!parsed.ok) return parsed;
  const { answers } = parsed;

  const captured = CapturedGoal.safeParse({
    subject,
    // Nothing to match: the caller has already looked, and this is what it
    // found nothing for.
    matchedPack: null,
    outcomeType: answers.outcome,
    statedLevel: answers.level,
    weeklyHours: answers.hours,
    deadline: answers.deadline,
    motivation: answers.motivation,
    constraints: [],
    existingAssets: [],
    priorDomain: null,
    // The three `*Said` fields stay empty on purpose. They exist so the
    // sidebar can quote a learner instead of paraphrasing them, and a form
    // has nothing to quote — they picked our wording off our own list.
    levelSaid: null,
    weeklyHoursSaid: null,
    deadlineSaid: null,
  });

  if (!captured.success) return { ok: false, error: BAD_DEADLINE };

  return {
    ok: true,
    intake: {
      /*
       * Their own words as the opening line, because that is where
       * `rawGoalFrom` looks for them — `GoalSpec.rawGoal` promises to store
       * what the learner wrote verbatim, and a form answer thrown away here
       * would come back as "Get good at rust" once the pack is built.
       */
      messages: [{ r: "l", t: rawGoalFor(form, subject) }],
      captured: captured.data,
      chips: [],
      clarity: STATED_CLARITY,
      // There is nothing left to ask. The form asked all of it.
      done: true,
      packSlug: null,
    },
  };
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
