import type { GoalSpec } from "@/lib/contracts/goal";
import type {
  EngineSkill,
  MasteryState,
  SessionOutcome,
} from "@/lib/engine";
import { daysBetween } from "@/lib/engine/bkt";

/**
 * §14.3 tier 1 — the Learner Context Block.
 *
 * "A compact, deterministic ~1,200-token render of: goal spec, profile, top-15
 * skill mastery states, last 3 session outcomes, active misconceptions,
 * constraints. Regenerated only on state change, placed at the top of every
 * prompt behind a `cache_control` breakpoint. This is the single biggest cost
 * lever in the system."
 *
 * Cache hygiene is the whole design here, because every rule §14.9.4 lists is a
 * silent failure — a prefix that varies costs full input price on every turn and
 * reports nothing:
 *
 * - **No timestamps.** Recency is rendered in coarse day-scale bands, so the
 *   text is identical across the minutes a session lasts. A rendered
 *   `lastSuccessAt`, or a decayed mastery computed against `now`, would change
 *   on every keystroke and cache nothing.
 * - **No UUIDs.** Slugs only. Goal and session ids never appear.
 * - **Fixed order.** Sections in a fixed sequence, skills sorted by an explicit
 *   key, so two renders of the same state are byte-identical.
 *
 * The consequence worth stating: this block is deliberately *stale within the
 * day*. That is correct for a tutor's background knowledge and wrong for a
 * grader's verdict, which is why grading reads mastery directly rather than
 * reading this.
 */

/** ~1,200 tokens, at roughly four characters per token. */
export const CONTEXT_CHAR_BUDGET = 5_000;

/** §14.3 — "top-15 skill mastery states". */
export const CONTEXT_SKILL_LIMIT = 15;

export interface LearnerContextInput {
  goal: GoalSpec;
  packName: string;
  skills: EngineSkill[];
  mastery: MasteryState[];
  /** Newest first. Only the last three are rendered (§14.3). */
  history: SessionOutcome[];
  /** Open misconceptions, newest first. */
  misconceptions: string[];
  /** Skills today's session is about — they lead the list whatever their evidence. */
  focusSkillIds: string[];
  /** ISO date, YYYY-MM-DD. Day granularity is what keeps the prefix stable. */
  today: string;
}

/**
 * How long ago, in words. Bands rather than numbers so the text only changes
 * when the learner's situation actually changes.
 */
export function recencyBand(
  lastSuccessAt: string | null,
  today: string,
): string {
  if (lastSuccessAt === null) return "never demonstrated";
  const days = Math.floor(daysBetween(lastSuccessAt, `${today}T00:00:00.000Z`));
  if (days <= 1) return "demonstrated in the last day";
  if (days <= 7) return "demonstrated this week";
  if (days <= 30) return "demonstrated this month";
  return "not demonstrated in over a month";
}

/**
 * Mastery in words, from the *stored* belief rather than the decayed one.
 *
 * §7.2 — "a Tier 3 skill at 0.8 renders as 'Likely capable — based on 3
 * reviewed images', not '80% mastered'." A number in a tutor prompt gets quoted
 * back at the learner as a score, and the tutor is not the surface that is
 * allowed to make that claim.
 */
export function masteryBand(state: MasteryState): string {
  if (state.evidenceCount === 0) return "no evidence yet";
  if (state.mastery >= 0.85) return "solid";
  if (state.mastery >= 0.6) return "getting there";
  if (state.mastery >= 0.3) return "shaky";
  return "not yet";
}

/**
 * Which fifteen skills. Today's focus first — a tutor asked about the block on
 * screen must not have to guess which skill it belongs to — then whatever the
 * learner has the most evidence on, then alphabetical so the tie is not decided
 * by row order.
 */
export function selectContextSkills(
  input: LearnerContextInput,
  limit = CONTEXT_SKILL_LIMIT,
): MasteryState[] {
  const focus = new Set(input.focusSkillIds);

  return [...input.mastery]
    .sort((a, b) => {
      const focusDelta = Number(focus.has(b.skillId)) - Number(focus.has(a.skillId));
      if (focusDelta !== 0) return focusDelta;
      if (b.evidenceCount !== a.evidenceCount) {
        return b.evidenceCount - a.evidenceCount;
      }
      return a.skillId.localeCompare(b.skillId);
    })
    .slice(0, limit);
}

export function buildLearnerContext(input: LearnerContextInput): string {
  const names = new Map(input.skills.map((s) => [s.id, s]));

  const skillLines = selectContextSkills(input).map((state) => {
    const skill = names.get(state.skillId);
    const label = skill?.name ?? state.skillId;
    return `- ${label}: ${masteryBand(state)}, ${recencyBand(state.lastSuccessAt, input.today)}`;
  });

  const historyLines = input.history.slice(0, 3).map((outcome, i) => {
    const labels = outcome.skillIds.map((id) => names.get(id)?.name ?? id);
    return `- ${i === 0 ? "Last session" : `${i + 1} sessions ago`}: ${
      labels.length > 0 ? labels.join(", ") : "no skill targeted"
    }${outcome.producedArtifact ? " (produced work)" : ""}`;
  });

  const constraints = [
    `- About ${input.goal.weeklyHours} hours a week`,
    input.goal.deadline === null
      ? "- No deadline"
      : `- Deadline: ${input.goal.deadline}`,
    ...input.goal.constraints.map((c) => `- ${c}`),
  ];

  const sections = [
    "## Learner",
    `Subject: ${input.packName}`,
    `In their words: ${input.goal.rawGoal}`,
    `What they want to be able to do: ${input.goal.targetOutcome}`,
    `Why: ${input.goal.motivation || "not said"}`,
    "",
    "## Constraints",
    ...constraints,
    "",
    "## Where they are",
    ...(skillLines.length > 0 ? skillLines : ["- Nothing assessed yet"]),
    "",
    "## Recent sessions",
    ...(historyLines.length > 0 ? historyLines : ["- None yet"]),
  ];

  if (input.misconceptions.length > 0) {
    sections.push(
      "",
      "## Things they have got wrong before",
      ...input.misconceptions.slice(0, 5).map((m) => `- ${m}`),
    );
  }

  return trim(sections.join("\n"));
}

/**
 * Truncation is disclosed, never silent (§14.9.5). A block that quietly lost its
 * last section would give the tutor a confident but partial picture, which is
 * worse than a shorter one that says what is missing.
 */
export function trim(text: string, budget = CONTEXT_CHAR_BUDGET): string {
  if (text.length <= budget) return text;
  const marker = "\n\n(Context truncated.)";
  return `${text.slice(0, budget - marker.length)}${marker}`;
}
