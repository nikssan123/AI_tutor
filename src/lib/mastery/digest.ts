import type { Ledger } from "./ledger";

/**
 * §8 screen 11 — the weekly digest, for "weekly re-motivation and honest
 * recalibration".
 *
 * Arithmetic over rows the system already has: hours against the commitment,
 * which skills moved, what was handed in, what is slipping, and how long the
 * rest looks from here. §8 pencilled in a Reflection Agent for this screen and
 * there is nothing here for one to do — every number below is a fact about the
 * learner's own week, and a model asked to narrate facts adds only the risk of
 * saying something the rows do not support. The one place judgement would help
 * is deciding what to change about the plan, and the planner already decides
 * that from these same numbers, on every page load.
 *
 * A rolling seven days rather than a calendar week: the commitment is expressed
 * per week, so the window has to be a week long, and a calendar one would show
 * a learner an empty digest every Monday morning.
 */

export const WINDOW_DAYS = 7;

export function windowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
}

export interface SkillMove {
  name: string;
  /** Summed mastery movement over the window. Ordering only — never displayed. */
  delta: number;
}

export interface RetentionHealth {
  /** Skills with a success behind them, i.e. ones that have something to lose. */
  tracked: number;
  /** How many of those have decayed far enough to be worth practising. */
  slipping: number;
}

export interface DigestInput {
  /** The goal's weekly budget — §16.1's `weeklyHours`. */
  committedHours: number;
  minutesLogged: number;
  sessions: number;
  moved: SkillMove[];
  artefacts: number;
  retention: RetentionHealth;
  /** What the projection still owes, at the learner's current level. */
  remainingHours: number;
}

export interface Digest extends RetentionHealth {
  hoursLogged: number;
  committedHours: number;
  keptCommitment: boolean;
  sessions: number;
  moved: SkillMove[];
  artefacts: number;
  remainingHours: number;
  weeksAtCommitment: number;
  /**
   * The same estimate at the pace actually kept, which is the recalibration
   * half of the screen. Null when nothing was logged: there is no pace to
   * project from a week with no sessions in it, and dividing by zero to print
   * "Infinity weeks" would be a joke at the learner's expense.
   */
  weeksAtActualPace: number | null;
}

/** Rounds to a tenth — the input is estimated hours, not measured to minutes. */
function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summarise(input: DigestInput): Digest {
  const hoursLogged = tenths(input.minutesLogged / 60);

  return {
    hoursLogged,
    committedHours: input.committedHours,
    keptCommitment: hoursLogged >= input.committedHours,
    sessions: input.sessions,
    // Biggest movement first: "what changed this week" is the question, and the
    // skill that moved most is the answer to it.
    moved: [...input.moved].sort(
      (a, b) => b.delta - a.delta || a.name.localeCompare(b.name),
    ),
    artefacts: input.artefacts,
    tracked: input.retention.tracked,
    slipping: input.retention.slipping,
    remainingHours: tenths(input.remainingHours),
    // Rounded up, both of them. A completion estimate that rounds down is
    // flattering in exactly the direction §4.2 law 3 forbids.
    weeksAtCommitment: Math.ceil(input.remainingHours / input.committedHours),
    weeksAtActualPace:
      hoursLogged > 0 ? Math.ceil(input.remainingHours / hoursLogged) : null,
  };
}

/**
 * Retention health, read off the ledger rather than recomputed.
 *
 * This screen offers to show the learner *which* skills are slipping, so the
 * count here and the rows on `/mastery` have to be the same fact. Deriving one
 * from the other is the only way that stays true: a second decay rule living
 * here would eventually send someone to a list of two after promising three.
 *
 * `tracked` counts what has been proved at some point — still held plus lapsed —
 * because a lapsed skill is precisely the thing retention is about.
 */
export function retentionHealth(ledger: Ledger): RetentionHealth {
  const faded = ledger.whatsLeft.filter((e) => e.standing === "faded").length;
  const fading = ledger.canDo.filter((e) => e.standing === "fading").length;

  return {
    tracked: ledger.canDo.length + faded,
    slipping: fading + faded,
  };
}
