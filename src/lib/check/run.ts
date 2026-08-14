import {
  DEFAULT_BUDGET,
  gradingModeFor,
  MAX_PER_SKILL,
  type CheckScope,
  type DiagnosticItem,
  type DiagnosticSkill,
} from "@/lib/engine/diagnostic";
import { toDiagnostic } from "./session";
import type { DomainPack } from "@/lib/packs/types";

/**
 * Which check is running, and what that means.
 *
 * There are two, and the difference between them is the answer to §24 E4's
 * remaining half. The broad check spends nine questions across a whole subject:
 * it *locates* a learner and cannot prove anything, because no skill gets the
 * three-to-five observations the BKT needs to clear the bar. The deep check
 * spends its whole budget on one skill, so it can.
 *
 * Both run the same engine, the same grader and the same screens. Everything
 * that differs between them is in this file, so that a third caller cannot
 * invent a third set of rules.
 */
export interface CheckRef {
  topic: string;
  /** Present for the deep check on a single skill; absent for the broad one. */
  skill?: string | undefined;
}

/**
 * The cookie a check stores its answers in.
 *
 * Separate per skill, and separate from the subject's own, because they are
 * different checks with different budgets — sharing one would mean a deep check
 * on shutter speed silently consuming the questions a later broad check was
 * going to ask.
 */
export function cookieFor(ref: CheckRef): string {
  const clean = (part: string) => part.replace(/[^a-z0-9-]/gi, "");
  return ref.skill === undefined
    ? `check_${clean(ref.topic)}`
    : `check_${clean(ref.topic)}--${clean(ref.skill)}`;
}

/** Where a check returns to after every action. */
export function pathFor(ref: CheckRef): string {
  return ref.skill === undefined
    ? `/check/${ref.topic}`
    : `/check/${ref.topic}/${ref.skill}`;
}

/**
 * Whether a skill's work can be handed in here at all.
 *
 * A photograph can: it uploads, a multimodal model marks it against the
 * technical criteria (§7.2 tier 3), and nothing is kept. A spreadsheet, a query
 * or a repository cannot — those are §7.3's other workspaces, and until they
 * exist a check that asked for one would be asking for a *description* of the
 * work, which is a different and much weaker thing.
 *
 * So the gate is the skill's own declared evidence, from the pack.
 */
export function takesPhotos(pack: DomainPack, skillSlug: string): boolean {
  const skill = pack.skills.find((s) => s.slug === skillSlug);
  return skill?.observableEvidence.includes("image") === true;
}

/**
 * §7.3's artefacts: on for a deep check about a skill whose work is a photo,
 * off everywhere else.
 *
 * A `micro_artifact` asks for a piece of work — "photograph a scene that
 * exceeds your sensor's range", "cook a dish from what is in your kitchen". In
 * a ten-minute check across fifteen skills that is an absurd thing to ask, and
 * the broad check still excludes them. On a page somebody opened to prove one
 * particular skill it is the *best* thing to ask, and it is the only question
 * type in the product that produces tier-3 evidence rather than talk about it.
 */
export function scopeFor(pack: DomainPack, ref: CheckRef): CheckScope {
  return {
    artefacts: ref.skill !== undefined && takesPhotos(pack, ref.skill),
  };
}

/**
 * How many questions this check will ask.
 *
 * The deep check's budget is `MAX_PER_SKILL`, which is the same number
 * `settled` stops at — so it ends when the skill is decided or when the bank
 * runs out, whichever comes first, and never asks a question that cannot change
 * the answer.
 */
export function budgetFor(ref: CheckRef, items: DiagnosticItem[]): number {
  return ref.skill === undefined
    ? DEFAULT_BUDGET
    : Math.min(MAX_PER_SKILL, items.length);
}

/**
 * The engine's inputs, narrowed to what this check is about.
 *
 * A deep check starts a diagnostic over *one* skill, so the whole posterior is
 * about that skill and every item is informative about it. That is what makes
 * the concentration real rather than a preference the selector might lose.
 */
export function narrow(
  pack: DomainPack,
  ref: CheckRef,
): { skills: DiagnosticSkill[]; items: DiagnosticItem[] } {
  const all = toDiagnostic(pack);
  const scope = scopeFor(pack, ref);

  // Filtered here as well as in `selectNextItem`, because the *count* is what
  // decides the budget and what the page promises — "up to four questions" has
  // to mean four questions this check could actually ask.
  const answerable = all.items.filter(
    (i) => gradingModeFor(i.type) !== "excluded" || scope.artefacts === true,
  );

  if (ref.skill === undefined) return { skills: all.skills, items: answerable };

  return {
    skills: all.skills.filter((s) => s.slug === ref.skill),
    items: answerable.filter((i) => i.skill === ref.skill),
  };
}
