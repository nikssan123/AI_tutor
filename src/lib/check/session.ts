import {
  gradingModeFor,
  recordResponse,
  startDiagnostic,
  type DiagnosticItem,
  type DiagnosticSkill,
  type DiagnosticState,
} from "@/lib/engine/diagnostic";
import type { DomainPack } from "@/lib/packs/types";

/**
 * Where a running Skill Check lives between requests.
 *
 * In a cookie, not the database, and deliberately: the check is anonymous and
 * free (§10 A — "no signup to start"), so a server-side session would mean
 * minting an identifier for someone who has not asked to be identified, plus a
 * row to expire. The cookie holds only which items were answered and whether
 * each was right — no prose, no personal data.
 *
 * Mastery is never stored. It is **replayed** through the engine on each
 * request, which is sound precisely because `selectNextItem` is deterministic:
 * the same answers always reconstruct the same state. That also means a
 * tampered cookie cannot invent a mastery score, only a different (still
 * honest) sequence of answers to itself.
 */

export interface Answer {
  /** Item slug. */
  i: string;
  /** 1 correct, 0 not. */
  c: 0 | 1;
  /**
   * 1 when §14.2's Assessment Agent marked this open answer; absent when the
   * learner marked it themselves.
   *
   * Recorded rather than re-derived, because the same item can go either way in
   * the same product — the model marks it when it is reachable and inside the
   * day's budget, and the learner marks it when it is not. Without this flag a
   * replay would reconstruct a *different* mastery than the one the learner was
   * shown, in the direction nobody would check.
   */
  g?: 1;
}

/** An open answer the model has marked, waiting to be read. */
export interface Marked {
  /** Item slug. */
  i: string;
  /** 1 correct, 0 not. */
  c: 0 | 1;
  /** The grader's feedback, addressed to the learner. */
  f: string;
  /** What they wrote, shown back beside the marking as the self-mark screen does. */
  r: string;
}

export interface CheckCookie {
  /** Set once the learner has pressed Start, so an empty check is not an intro. */
  s?: 1;
  a: Answer[];
  /** An item answered but not yet self-marked, awaiting the revealed key. */
  p?: { i: string; r: string };
  /** An item the model has marked, awaiting the learner reading the marking. */
  m?: Marked;
}

export const COOKIE_PREFIX = "check_";
/** Cookies cap around 4KB; nine answers is nowhere near it, but bound it anyway. */
export const MAX_ANSWERS = 40;
/** One or two sentences is what the grader is asked for; this is the ceiling. */
export const MAX_FEEDBACK = 600;
/**
 * How much of a written answer is kept, and enforced on the textarea too.
 *
 * A cookie is capped at about 4KB by every browser, and one that exceeds it is
 * dropped **silently** — which on this surface means the check resets itself
 * mid-run for the one learner who wrote at length. The bound was 4,000
 * characters, which is over the limit on its own once base64 has added a third.
 * 1,200 is generous for a two-minute recall answer and leaves room for the
 * marking beside it.
 */
export const MAX_ANSWER = 1_200;

export function cookieName(topic: string): string {
  return `${COOKIE_PREFIX}${topic.replace(/[^a-z0-9-]/gi, "")}`;
}

export function encode(state: CheckCookie): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

/**
 * Never throws. A malformed or truncated cookie yields a fresh check rather
 * than a 500 — the failure mode of a free tool must be "start again", not an
 * error page.
 */
export function decode(raw: string | undefined): CheckCookie {
  if (!raw) return { a: [] };

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return { a: [] };

    const answers = (parsed as { a?: unknown }).a;
    if (!Array.isArray(answers)) return { a: [] };

    const a: Answer[] = [];
    for (const entry of answers.slice(0, MAX_ANSWERS)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { i, c, g } = entry as { i?: unknown; c?: unknown; g?: unknown };
      if (typeof i === "string" && (c === 0 || c === 1)) {
        a.push(g === 1 ? { i, c, g: 1 } : { i, c });
      }
    }

    const started = (parsed as { s?: unknown }).s === 1 ? ({ s: 1 } as const) : {};

    const pending = (parsed as { p?: unknown }).p;
    if (typeof pending === "object" && pending !== null) {
      const { i, r } = pending as { i?: unknown; r?: unknown };
      if (typeof i === "string" && typeof r === "string") {
        return { ...started, a, p: { i, r: r.slice(0, MAX_ANSWER) } };
      }
    }

    const marked = (parsed as { m?: unknown }).m;
    if (typeof marked === "object" && marked !== null) {
      const { i, c, f, r } = marked as {
        i?: unknown;
        c?: unknown;
        f?: unknown;
        r?: unknown;
      };
      if (
        typeof i === "string" &&
        (c === 0 || c === 1) &&
        typeof f === "string" &&
        typeof r === "string"
      ) {
        return {
          ...started,
          a,
          m: { i, c, f: f.slice(0, MAX_FEEDBACK), r: r.slice(0, MAX_ANSWER) },
        };
      }
    }

    return { ...started, a };
  } catch {
    return { a: [] };
  }
}

/**
 * Which of these subjects the visitor has already answered a check in.
 *
 * Extracted because three screens now ask the same question — the goal form,
 * the catalogue, and the no-goal `/today` — and each of them makes a promise
 * about it ("your check comes with you"). Two of those computing "already
 * answered" slightly differently would mean the promise appearing on one screen
 * and not another for the same visitor, which is worse than not making it.
 *
 * The jar is passed as a read function rather than as `cookies()`, so this stays
 * a pure function testable without a request.
 */
export function answeredTopics(
  slugs: readonly string[],
  read: (name: string) => string | undefined,
): Set<string> {
  return new Set(
    slugs.filter((slug) => decode(read(cookieName(slug))).a.length > 0),
  );
}

/**
 * A pack as the diagnostic engine wants it.
 *
 * Shared rather than inlined per caller: the check screen and goal intake both
 * replay the same cookie, and if they built their inputs differently the answers
 * a visitor gave before signing up would reconstruct into a *different* mastery
 * state afterwards — silently, and in the direction nobody would check.
 */
export function toDiagnostic(pack: DomainPack): {
  skills: DiagnosticSkill[];
  items: DiagnosticItem[];
} {
  return {
    skills: pack.skills.map((s) => ({
      slug: s.slug,
      name: s.name,
      priors: s.bktPriors,
      evalTier: s.evalTier,
    })),
    items: pack.items.map((i) => ({
      slug: i.slug,
      skill: i.skill,
      type: i.type,
      difficulty: i.difficulty,
      discrimination: i.discrimination,
      prompt: i.prompt,
      options: i.options,
      answerKey: i.answerKey,
    })),
  };
}

/**
 * Rebuilds engine state by replaying the answers. Unknown item slugs are
 * skipped, so a cookie written before a pack was edited degrades to a shorter
 * check instead of crashing.
 */
export function replay(
  cookie: CheckCookie,
  skills: DiagnosticSkill[],
  items: DiagnosticItem[],
  nowIso: string,
): DiagnosticState {
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  const bySkill = new Map(skills.map((s) => [s.slug, s]));

  let state = startDiagnostic(skills);
  for (const answer of cookie.a) {
    const item = bySlug.get(answer.i);
    const skill = item ? bySkill.get(item.skill) : undefined;
    if (!item || !skill) continue;
    state = recordResponse(
      state,
      item,
      answer.c === 1,
      skill.priors,
      nowIso,
      // The flag decides, not the item type: an open item is graded when the
      // model was there to grade it and self-marked when it was not, and only
      // the cookie knows which happened.
      answer.g === 1 ? { skillTier: skill.evalTier } : undefined,
    );
  }
  return state;
}

/** Whether answering this item needs the reveal-and-self-mark second step. */
export function needsSelfMark(item: DiagnosticItem): boolean {
  return gradingModeFor(item.type) === "self";
}

/**
 * The answer key, rendered for a human to mark themselves against. Packs store
 * either a correct option index or a list of concepts the answer should contain.
 */
export function readableAnswerKey(item: DiagnosticItem): string[] {
  const key = item.answerKey;
  if (typeof key !== "object" || key === null) return [];

  const concepts = (key as { concepts?: unknown }).concepts;
  if (Array.isArray(concepts)) {
    return concepts.filter((c): c is string => typeof c === "string");
  }

  const correct = (key as { correct?: unknown }).correct;
  if (typeof correct === "number" && item.options?.[correct]) {
    return [item.options[correct]];
  }

  return [];
}
