import type { Db } from "@/db";
import { allTopics } from "@/lib/content";
import { resolvePack } from "@/lib/content/resolve";
import { GoalSpec, STATED_CLARITY } from "@/lib/contracts/goal";
import { slugify } from "@/lib/packs/generate/derive";
import type { DomainPack } from "@/lib/packs/types";
import type { CapturedGoal, Message } from "./analyzer";

/**
 * Turning a finished conversation into something the product can act on.
 *
 * Two jobs, both of which exist because a model said something and nobody
 * should take its word for it: deciding whether the subject is one we already
 * have, and completing a `GoalSpec` from fields the learner was allowed to skip.
 */

/** What the catalogue offers the analyzer to match against. */
export function catalogueFor(): Array<{ slug: string; name: string }> {
  return allTopics().map((t) => ({ slug: t.slug, name: t.name }));
}

export type SubjectMatch =
  | { kind: "covered"; pack: DomainPack }
  | { kind: "gap"; subject: string; slug: string };

/**
 * Resolves what the analyzer claimed against what actually exists.
 *
 * The analyzer is handed the catalogue and asked to name a slug, and it is
 * checked rather than believed: a model naming `python-fundamentals` does not
 * make that pack exist, and a goal pointing at a pack that is not there would
 * fail much later, on `/today`, looking like a bug in the planner.
 *
 * The fallback is deliberately loose in one direction only. If the claimed slug
 * is not real but the *subject* slugifies onto a pack we have, that is the same
 * subject under a tidier name and it matches. Anything else is a gap, which is
 * not a failure — it is the case §7.1's Generated tier exists for.
 */
export async function matchSubject(
  db: Db,
  captured: CapturedGoal,
): Promise<SubjectMatch> {
  const claimed = captured.matchedPack?.trim();
  if (claimed) {
    const pack = await resolvePack(db, claimed);
    if (pack) return { kind: "covered", pack };
  }

  const subject = captured.subject?.trim();
  if (!subject) {
    // Nothing usable came back at all. Treated as a gap under a slug that
    // cannot collide, so the caller's next move is "we could not do this"
    // rather than a pack built for an empty string.
    return { kind: "gap", subject: "", slug: "" };
  }

  const bySubject = await resolvePack(db, slugify(subject));
  if (bySubject) return { kind: "covered", pack: bySubject };

  return { kind: "gap", subject, slug: slugify(subject) };
}

/**
 * The learner's own words, which `GoalSpec.rawGoal` promises to store verbatim.
 *
 * Their first message, because that is the one they wrote before we started
 * asking questions — the closest thing to what they actually came for.
 */
export function rawGoalFrom(messages: Message[], fallback: string): string {
  const first = messages.find((m) => m.r === "l")?.t.trim();
  return (first && first.length > 0 ? first : fallback).slice(0, 500);
}

/** §16.1's `timeFit` reads this, so a missing budget needs a defensible number. */
export const DEFAULT_WEEKLY_HOURS = 3;

/**
 * Completes a `GoalSpec` from a conversation that was allowed to skip things.
 *
 * Every field the learner declined gets a default rather than blocking the
 * plan, because "I don't know" is a valid answer and a product that stops on it
 * is a form with extra steps. The defaults are the cautious ones: an unknown
 * level starts at the bottom so the diagnostic can raise it, and an unknown
 * budget is small so the first week is achievable rather than abandoned.
 *
 * `clarity` carries the analyzer's own number rather than `STATED_CLARITY`,
 * which is what the form uses precisely because a form infers nothing. Recording
 * 1 here would erase the difference between a spec we were told and one we
 * worked out.
 */
export function specFrom(
  captured: CapturedGoal,
  messages: Message[],
  domain: string,
  targetOutcome: string,
  clarity: number,
): GoalSpec | undefined {
  const result = GoalSpec.safeParse({
    rawGoal: rawGoalFrom(messages, `Get good at ${targetOutcome.toLowerCase()}`),
    domain,
    targetOutcome,
    outcomeType: captured.outcomeType ?? "personal",
    statedLevel: captured.statedLevel ?? "none",
    weeklyHours: captured.weeklyHours ?? DEFAULT_WEEKLY_HOURS,
    deadline: captured.deadline,
    motivation: captured.motivation ?? "",
    constraints: captured.constraints,
    existingAssets: captured.existingAssets,
    clarity: Math.min(clarity, STATED_CLARITY),
  });

  return result.success ? result.data : undefined;
}
