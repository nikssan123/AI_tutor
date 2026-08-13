import { daysBetween, effectiveMastery } from "@/lib/engine/bkt";
import { MASTERY_TARGET } from "@/lib/engine/scoring";
import type { MasteryState } from "@/lib/engine";
import type { PackSkill } from "@/lib/packs/types";

/**
 * §8 screen 10 — the Mastery Ledger, which §1 calls the key competitive
 * advantage: "an evidence-backed, per-skill record of what you have demonstrably
 * done, with the artefacts attached."
 *
 * The rule this file exists to enforce is §24 E9's acceptance criterion — *every
 * capability statement links to the artefact that proves it*. So a claim is only
 * made when there is a marked hand-in behind it. A skill can sit above the bar
 * on the strength of answered questions alone and still not be claimed here,
 * because a question answered is not a thing you can show anyone.
 *
 * That is deliberately a stricter bar than the path screen uses. `projectSkills`
 * skips a skill from the plan on any evidence, since the question there is *what
 * should we spend your time on*. The question here is *what can you prove*, and
 * the two answers are allowed to differ — the notes below say which is which so
 * a learner reading both screens is never left guessing.
 *
 * Nothing in this file calls a model. §8 screen 10 expected capability
 * statements to be "generated on mastery-threshold crossing and cached"; the
 * pack already carries one per skill (`canDoStatement`, §14.4), written when the
 * pack was authored and reviewed with it. Generating a second version would cost
 * money to paraphrase a sentence a person already approved.
 */

/**
 * How far ahead the ledger looks before warning that a claim is on its way out.
 *
 * A warning phrased as "you have lost a quarter of this" cannot fire on a claim
 * at all: a claim needs `mastery × (1 − decay) ≥ 0.85`, and with mastery capped
 * at 1 that leaves decay no room above 0.15. So the question is asked forwards
 * instead — *would this still count a week from now* — which is both reachable
 * and the thing a learner would actually want to be told.
 */
export const FADING_HORIZON_DAYS = 7;

/**
 * Whether what the learner holds today would still clear the bar in a week.
 *
 * Asked through `effectiveMastery` rather than by solving the decay curve, so
 * there is one decay implementation in the product and this cannot drift from
 * the one the planner scores on (§16.2).
 */
export function slipping(state: MasteryState, now: string): boolean {
  const horizon = new Date(
    Date.parse(now) + FADING_HORIZON_DAYS * 86_400_000,
  ).toISOString();
  return effectiveMastery(state, horizon) < MASTERY_TARGET;
}

/**
 * Where a skill stands, in the learner's terms.
 *
 * - `shown` · proved with marked work, still fresh
 * - `fading` · proved, but decay has started to eat it
 * - `faded` · was proved, has now decayed below the bar and is back on the path
 * - `unproven` · the answers say yes, no hand-in says so
 * - `started` · some evidence, not enough
 * - `untouched` · nothing has been checked
 */
export type Standing =
  | "shown"
  | "fading"
  | "faded"
  | "unproven"
  | "started"
  | "untouched";

/** A skill's row in the ledger. */
export interface LedgerEntry {
  skillSlug: string;
  name: string;
  /** §14.4's can-do statement, from the pack. Never generated at read time. */
  statement: string;
  standing: Standing;
  /** The hand-in the claim rests on — the link §24 E9 requires. */
  submissionId: string | null;
  /** How many marked hand-ins have moved this skill. */
  artefacts: number;
  /** §7.2 — what the verdict is worth, shown wherever a claim is made. */
  confidence: number;
  /** Days since the last observation that actually succeeded. */
  shownDaysAgo: number | null;
  /** One sentence saying what this rests on, or what is missing. */
  note: string;
}

export interface Ledger {
  /** §8 screen 10's first tab. Every entry carries a `submissionId`. */
  canDo: LedgerEntry[];
  /** The second tab, each row saying why it is not in the first. */
  whatsLeft: LedgerEntry[];
}

/** The marked work behind a skill, from `mastery/store.ts`. */
export interface ArtefactEvidence {
  /** The newest hand-in whose evaluation moved this skill. */
  submissionId: string;
  /** How many marked hand-ins have moved it in total. */
  count: number;
}

export interface LedgerInput {
  skills: PackSkill[];
  mastery: MasteryState[];
  evidence: Map<string, ArtefactEvidence>;
  /** ISO-8601, injected so a ledger is reproducible. */
  now: string;
}

/**
 * When a skill was last shown, in words.
 *
 * "0 days ago" is what the arithmetic says and not what anyone would write, and
 * it is reachable the moment someone hands work in on the day they read this.
 */
function when(days: number): string {
  if (days === 0) return "today";
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function shownNote(count: number): string {
  return count === 1
    ? "Shown in the work you handed in."
    : `Shown in ${count} pieces of work you handed in.`;
}

const NOT_ENOUGH = "Some signal so far — not enough to say you can do it.";

interface Verdict {
  standing: Standing;
  note: string;
}

function verdictFor(
  state: MasteryState | undefined,
  evidence: ArtefactEvidence | undefined,
  now: string,
): Verdict {
  // Nothing has been observed. A pack's priors are a guess about strangers, not
  // a statement about this learner (§14.9.2 step 3), so they claim nothing.
  if (!state || state.evidenceCount === 0) {
    return { standing: "untouched", note: "Nothing checked yet." };
  }

  const claimed = effectiveMastery(state, now) >= MASTERY_TARGET;

  if (evidence === undefined) {
    return claimed
      ? {
          standing: "unproven",
          note: "You've answered questions on this, but nothing you've handed in shows it yet.",
        }
      : { standing: "started", note: NOT_ENOUGH };
  }

  // Decay counts from the last *successful* observation (§16.2), and a null one
  // means the marked work never cleared anything — evidence of an attempt, not
  // of a capability.
  const shown = state.lastSuccessAt;
  if (shown === null) {
    return {
      standing: "started",
      note: "You handed work in, and it didn't show this one yet.",
    };
  }

  const since = Math.round(daysBetween(shown, now));

  if (claimed) {
    return slipping(state, now)
      ? {
          standing: "fading",
          note: `Shown ${when(since)} — without a refresher it stops counting within a week.`,
        }
      : { standing: "shown", note: shownNote(evidence.count) };
  }

  // Above the bar before decay, below it now: the one case where a learner
  // loses a claim without doing anything wrong, so it says so plainly.
  return state.mastery >= MASTERY_TARGET
    ? {
        standing: "faded",
        note: `You showed this ${when(since)}. It has faded since, so it is back on your path.`,
      }
    : { standing: "started", note: NOT_ENOUGH };
}

/**
 * The two standings that license a claim. Both carry a hand-in behind them.
 *
 * Exported because the screen has to make the same distinction: a faded skill
 * still links to the work that once proved it, but no longer gets a verdict
 * shown beside it, and the two lists must not disagree about which is which.
 */
export const CLAIMED: Standing[] = ["shown", "fading"];

export function buildLedger(input: LedgerInput): Ledger {
  const byId = new Map(input.mastery.map((m) => [m.skillId, m]));

  const entries = input.skills.map((skill): LedgerEntry => {
    const state = byId.get(skill.slug);
    const evidence = input.evidence.get(skill.slug);
    const { standing, note } = verdictFor(state, evidence, input.now);
    const shown = state?.lastSuccessAt ?? null;

    return {
      skillSlug: skill.slug,
      name: skill.name,
      statement: skill.canDoStatement,
      standing,
      submissionId: evidence?.submissionId ?? null,
      artefacts: evidence?.count ?? 0,
      confidence: state?.confidence ?? 0,
      shownDaysAgo:
        shown === null ? null : Math.round(daysBetween(shown, input.now)),
      note,
    };
  });

  return {
    // Newest first: this is the tab a learner opens to see what they have
    // earned, and the thing they earned last week is the thing they came for.
    canDo: entries
      .filter((e) => CLAIMED.includes(e.standing))
      // Both claimed standings are reached through a non-null `lastSuccessAt`,
      // so the day count is total here by construction.
      .sort(
        (a, b) =>
          a.shownDaysAgo! - b.shownDaysAgo! ||
          a.skillSlug.localeCompare(b.skillSlug),
      ),
    // Pack order, which is authoring order and roughly dependency order, so the
    // list reads as a path rather than as a ranking of failures.
    whatsLeft: entries.filter((e) => !CLAIMED.includes(e.standing)),
  };
}
