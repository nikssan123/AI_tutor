import { evalTierClaim, maturityClaim, type Claim } from "@/lib/claims";
import type { ProjectDetail, TopicSummary } from "@/lib/content";

/**
 * §13.3 — "Dynamic `opengraph-image.tsx` per type."
 *
 * This module is what each card *says*. The drawing is in `og-card.tsx`, and
 * the split is deliberate: the sentence on a share card is a claim about the
 * product made in the one place where nobody can click through to check it
 * first, so it is worth being able to test the words without rendering a PNG.
 *
 * Three types, because there are three kinds of link a person actually pastes:
 * the site, a subject, a piece of work.
 */

/** The size every social network crops from. 1.91:1. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

export interface OgCard {
  /**
   * What kind of thing this is. Small, above the title, and `null` where there
   * is no useful answer — never the product's own name, which every card
   * already signs itself with.
   */
  eyebrow: string | null;
  title: string;
  /** One sentence, and never a stronger one than the page makes. */
  lead: string;
  /** Short factual chips. Countable things only — no adjectives. */
  facts: string[];
  /** §7.1/§7.2's declared depth, where the thing has one. */
  badge: Claim | null;
}

/**
 * Longer titles get smaller type rather than an ellipsis.
 *
 * Satori wraps, so an over-long title does not overflow horizontally — it grows
 * downwards and pushes the facts row off the bottom of a fixed 630px box, which
 * is invisible until someone shares that one subject. The steps are set so that
 * the longest title in each band still lands on two lines at ~25 characters per
 * line for the display weight.
 */
export function titleFontSize(title: string): number {
  if (title.length <= 28) return 76;
  return title.length <= 52 ? 60 : 48;
}

/**
 * A hard stop for the pathological case. Word-boundary rather than mid-word,
 * because a card is read at a glance and a severed word reads as a bug.
 */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The default card: the site, and any page without a more specific one.
 *
 * The words are the landing page's own — §13.3's rule that markup must not
 * describe something the page does not say applies at least as hard to an
 * image, which is the one artefact that travels away from the page entirely.
 */
export function brandCard(): OgCard {
  return {
    // No eyebrow: this card's subject *is* the product, and the wordmark in the
    // corner already says so. Naming it twice looked like a bug on the render.
    eyebrow: null,
    title: "Learn anything — and prove you actually learned it",
    lead: "Name a subject. If nobody has written it, we write it — then your work is marked against a checklist you read first.",
    facts: [],
    badge: null,
  };
}

/** `/learn/{topic}`. */
export function subjectCard(topic: TopicSummary): OgCard {
  const graded = topic.projectCount > 0;

  return {
    eyebrow: "Subject",
    title: clamp(topic.name, 90),
    // A pack with no projects has nothing to mark, so it does not get the
    // sentence about marking. This is reachable: a Generated pack whose rubric
    // author failed still has a skill graph and still gets a page.
    lead: graded
      ? "Every project is marked against a checklist you can read before you start."
      : "The skills, in the order you need to learn them.",
    facts: [
      `${topic.skillCount} skills`,
      ...(graded ? [`${topic.projectCount} graded projects`] : []),
      `~${topic.totalHours} hours`,
    ],
    badge: maturityClaim(topic.maturity, topic.reviewKind),
  };
}

/**
 * `/learn/{topic}-for-{audience}` — §10 C.
 *
 * The card a person pastes into the channel where their colleagues already
 * work, which is the whole distribution story for this page type, so it says
 * the one thing that page is *for*: how much of a subject somebody arriving
 * from a particular job does not have to start from scratch on.
 *
 * The badge is the page's review state rather than the pack's maturity. Both
 * are true and only one is a claim about the page being shared: a reader has no
 * way to check who read the sentences from inside a feed.
 */
export function audienceCard(input: {
  h1: string;
  topicName: string;
  known: number;
  transfers: number;
  low: number;
  high: number;
  badge: Claim;
}): OgCard {
  return {
    eyebrow: clamp(input.topicName, 40),
    title: clamp(input.h1, 90),
    // A page that credits the reader with nothing still has something to say,
    // and it is the more interesting half of what this page type does. Saying
    // "0 skipped" in a lead would read as a broken template.
    lead:
      input.known > 0
        ? "What we would skip for you, what transfers under another name, and what is genuinely new."
        : "Nothing here is skippable — but you have done most of it already, under other names.",
    facts: [
      ...(input.known > 0 ? [`${input.known} skipped`] : []),
      `${input.transfers} already yours`,
      `${input.low}–${input.high} hours`,
    ],
    badge: input.badge,
  };
}

/** `/projects/{slug}`. */
export function projectCard(project: ProjectDetail): OgCard {
  return {
    eyebrow: clamp(project.topicName, 40),
    title: clamp(project.title, 90),
    lead: "You hand it in, and every score quotes the part of your work it rests on.",
    facts: [
      `${project.rubricDetail.criteria.length} criteria`,
      `~${project.estimatedMinutes} min`,
      `${project.skills.length} skills`,
    ],
    // The tier, not the maturity: the question a person asks about a *brief* is
    // what "marked" is going to mean, and at tier 5 the honest answer is that it
    // will not count as proof. That belongs on the card too.
    badge: evalTierClaim(project.evalTier),
  };
}
