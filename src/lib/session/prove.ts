import type { DomainPack, PackItem } from "@/lib/packs/types";
import type { SessionBlock } from "@/lib/engine";

/**
 * "Sounds like you already have this — prove it" (PLAN-ADAPTATION step 4).
 *
 * The offer the tutor's `already_knows` signal earns. It is the one place where
 * something a model *thought about a conversation* changes a learner's path, so
 * the shape of it is the whole design:
 *
 * **It triggers an assessment. It never substitutes for one.** Accepting the
 * offer does not skip anything, mark anything, or move mastery by a single
 * point. It appends real questions from the pack's own item bank to the session,
 * and the learner answers them through `answerCheck` — the same grading, the
 * same BKT update, the same audit row, the same retrieval scheduling as every
 * other question in the product. If the answers are good the belief rises and
 * `projectSkills` stops asking for the skill, because that is what mastery
 * above the bar already means. Nothing here is a second route to the ledger.
 *
 * The answers count *both ways*, and the copy says so. An offer that was free
 * to fail would be a lottery ticket rather than a claim, and a learner who
 * discovered the asymmetry would have found a way to farm mastery by guessing.
 */

/** Enough to distinguish knowing it from having seen it; few enough to accept. */
export const PROVE_ITEM_COUNT = 3;

/** A production question takes longer than a recall prompt. */
export const PROVE_MINUTES_PER_ITEM = 4;

/**
 * The questions a claim of prior knowledge has to survive.
 *
 * **Hardest first**, which is the opposite of what the adaptive diagnostic does
 * and is right here for a different reason. The diagnostic picks the item
 * closest to the current estimate because it is trying to *locate* a learner.
 * This is testing a specific claim — "I already know this" — and an easy
 * question cannot separate someone who knows the skill from someone who has
 * merely seen it. Ties break on slug, so the same claim always draws the same
 * questions.
 *
 * Multiple-choice is excluded. A session block renders a textarea and nothing
 * else, so an MCQ served here would show its stem with no options — and a
 * guessable item is weak evidence for a claim the learner volunteered anyway.
 */
export function proveItems(
  pack: DomainPack,
  skillSlug: string,
  count = PROVE_ITEM_COUNT,
): PackItem[] {
  return pack.items
    .filter((item) => item.skill === skillSlug && item.type !== "mcq")
    .sort((a, b) =>
      a.difficulty !== b.difficulty
        ? b.difficulty - a.difficulty
        : a.slug.localeCompare(b.slug),
    )
    .slice(0, count);
}

/**
 * What a right answer has to show, for the grader to mark against.
 *
 * The item bank's `concepts` list is the authored answer to exactly this
 * question — it is what a self-marking learner is shown on the check's "a good
 * answer covers" screen. Falling back to the skill's can-do statement keeps an
 * item with no concepts gradeable rather than dropping it, though the pack
 * validator means that should not happen.
 */
export function expectedFor(item: PackItem, canDoStatement: string): string {
  const key = item.answerKey;
  if (key !== null && typeof key === "object" && "concepts" in key) {
    const concepts = (key as { concepts?: unknown }).concepts;
    if (Array.isArray(concepts) && concepts.length > 0) {
      return concepts.map(String).join("; ");
    }
  }
  return canDoStatement;
}

/**
 * The blocks appended to the session when the offer is accepted.
 *
 * `isRetrieval` is false: this is not spaced practice coming round again, it is
 * a claim being tested, and the session's opening-retrieval accounting should
 * not count it. `itemId` is set, so a right answer schedules the item for real
 * spaced repetition exactly as any other check does.
 */
export function proveBlocks(
  items: PackItem[],
  skillSlug: string,
  canDoStatement: string,
): SessionBlock[] {
  return items.map((item) => ({
    type: "check" as const,
    skillId: skillSlug,
    prompt: item.prompt,
    expected: expectedFor(item, canDoStatement),
    isRetrieval: false,
    itemId: item.slug,
    estMinutes: PROVE_MINUTES_PER_ITEM,
  }));
}

/** A signal, as `recentSignals` returns it. */
export interface SignalRow {
  skillSlug: string;
  signal: string;
}

export interface OfferInput {
  /** Recent signals for this learner, any order. */
  signals: SignalRow[];
  /** The block the learner is looking at. */
  block: SessionBlock | undefined;
  /** Every block in the session, to see whether the offer was already taken. */
  blocks: SessionBlock[];
  pack: DomainPack;
}

/**
 * Whether to offer, and on which skill.
 *
 * Deliberately narrow. The offer only appears on the skill the learner is
 * *currently looking at*, never as a list of everything they once sounded
 * confident about — an offer for a skill three blocks away is an interruption,
 * and the signal was about this moment.
 *
 * Returns undefined when there is nothing to offer, which is almost always.
 */
export function proveOffer(input: OfferInput): { skillSlug: string } | undefined {
  const block = input.block;
  if (!block || block.type === "review" || block.type === "reflect") {
    return undefined;
  }

  const claimed = input.signals.some(
    (s) => s.signal === "already_knows" && s.skillSlug === block.skillId,
  );
  if (!claimed) return undefined;

  // Already taken. The appended blocks are the record that it happened, so
  // there is no second flag to keep in sync — and a learner who answered them
  // badly is not asked to prove the same skill again in the same session.
  const taken = input.blocks.some(
    (b) => b.type === "check" && b.skillId === block.skillId && b.itemId !== null,
  );
  if (taken) return undefined;

  // Nothing to ask with. A pack whose only items for this skill are MCQs
  // cannot support the offer, and promising one we cannot serve is worse than
  // staying quiet.
  if (proveItems(input.pack, block.skillId).length === 0) return undefined;

  return { skillSlug: block.skillId };
}
