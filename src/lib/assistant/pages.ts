/**
 * Where things are, as data.
 *
 * `ASSISTANT-PLAN.md` §5's cheap tool, and the one that will earn its keep
 * fastest: most "how do I…" questions are navigation, and answering one with a
 * real destination beats describing a route through the UI.
 *
 * A table rather than lines in the system prompt, for the reason every other
 * lookup here is a tool: a prompt that lists the product's routes is a second
 * copy of the router that nothing checks, and it goes stale the first time a
 * page moves. `tests/assistant/pages.test.ts` asserts every path here is a route
 * that exists, so a deleted page fails a test rather than sending a learner to a
 * 404.
 *
 * Pure and synchronous. It reads no database and knows nothing about who is
 * asking — every page listed is one any signed-in learner may open, which is
 * what makes it the one tool with no authorization surface.
 */

export interface AppPage {
  /** The route, exactly as `next/link` would take it. */
  path: string;
  /** What the learner calls it — matches the nav where there is one. */
  title: string;
  /** One line on what they will find, written to be said out loud. */
  blurb: string;
  /**
   * Words a learner might use for this page that are not already in its title.
   *
   * The title is always matched, so repeating it here buys nothing. What belongs
   * is the vocabulary the product does *not* use on the page itself — "invoice"
   * for billing, "streak" for progress — because that is what somebody types
   * when they cannot find it.
   */
  keywords: string[];
}

export const PAGES: readonly AppPage[] = [
  {
    path: "/today",
    title: "Today",
    blurb: "The session waiting for you, and what it will cover.",
    keywords: ["session", "study", "start", "next", "lesson", "practice"],
  },
  {
    path: "/path",
    title: "Your path",
    blurb: "The modules you will work through, in order.",
    keywords: ["curriculum", "course", "plan", "modules", "syllabus", "order"],
  },
  {
    path: "/progress",
    title: "Your week",
    blurb:
      "Hours kept against hours planned, the month on a calendar, and what is coming.",
    keywords: [
      "calendar",
      "week",
      "hours",
      "streak",
      "pace",
      "month",
      "dates",
      "deadline",
      "checkpoint",
      "ahead",
      "behind",
    ],
  },
  {
    path: "/mastery",
    title: "What you can do",
    blurb: "Every skill you have shown, and what the evidence for it was.",
    keywords: [
      "skills",
      "evidence",
      "ledger",
      "proof",
      "slipping",
      "forgot",
      "retention",
      "mastered",
    ],
  },
  {
    path: "/subjects",
    title: "Subjects",
    blurb: "The catalogue — everything there is to learn here.",
    keywords: ["catalogue", "catalog", "browse", "topics", "new course"],
  },
  {
    path: "/start",
    title: "Start something new",
    blurb: "Tell us what you are trying to do, and we build the path for it.",
    keywords: ["goal", "begin", "new", "onboarding", "intake", "sign up"],
  },
  {
    path: "/account",
    title: "Account",
    blurb: "Your details, your email, and how to sign out.",
    keywords: ["settings", "profile", "email", "password", "sign out", "delete"],
  },
  {
    path: "/account/billing",
    title: "Billing",
    blurb: "Your plan, what you are charged, and how to change or cancel it.",
    keywords: [
      "pay",
      "payment",
      "invoice",
      "receipt",
      "charge",
      "card",
      "subscription",
      "cancel",
      "refund",
      "upgrade",
      "downgrade",
      "price",
      "cost",
    ],
  },
  {
    path: "/account/referrals",
    title: "Referrals",
    blurb: "Your invite link, and who has joined with it.",
    keywords: ["invite", "refer", "friend", "share", "link"],
  },
];

/** How many destinations one lookup may return. */
export const MAX_MATCHES = 3;

/**
 * Words that carry no signal about *where* something is.
 *
 * Not tidiness — without this the matcher is wrong, and wrong in the direction
 * that matters. "What you can do" is a page title, so **"what" was a
 * full-strength title match**: asking "what is the capital of Peru" returned
 * the mastery page, and "how do I cancel my subscription" returned it too,
 * because "do" outscored the word "cancel". A question word beating a subject
 * word is how a lookup ends up confidently wrong, which is worse here than
 * returning nothing.
 */
const STOP = new Set([
  "the", "an", "and", "or", "but", "not", "no", "if", "so", "as", "at", "by",
  "in", "on", "of", "to", "for", "with", "from", "about", "into", "up", "out",
  "my", "me", "mine", "you", "your", "yours", "it", "its", "this", "that",
  "these", "those", "there", "here", "am", "is", "are", "was", "were", "be",
  "been", "being", "do", "does", "did", "doing", "have", "has", "had", "will",
  "would", "should", "could", "can", "may", "might", "must", "what", "which",
  "who", "whom", "how", "when", "why", "where", "show", "tell", "find", "get",
  "see", "go", "want", "need", "any", "all", "some", "just", "now", "again",
  "please", "help",
]);

/**
 * A word reduced to what it shares with its plural.
 *
 * The whole of the morphology this needs: a learner types "invoices" and the
 * table says "invoice". Anything cleverer would be a stemmer, and a stemmer is
 * a dependency and a class of surprise for a table of nine pages.
 */
export function stem(word: string): string {
  return word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word;
}

/**
 * Lowercased words of two characters or more, stemmed, minus the ones that
 * appear in every other sentence. Punctuation is not a word.
 */
export function words(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem);
}

/**
 * How well one page answers one query.
 *
 * A title word is worth more than a keyword because a learner who types the
 * page's own name means that page, and a keyword overlap is a guess about what
 * they meant. Both beat nothing, and nothing is a real answer — see
 * `findPages`.
 */
export function score(page: AppPage, terms: string[]): number {
  const title = words(page.title);
  const keywords = page.keywords.flatMap((keyword) => words(keyword));

  return terms.reduce((total, term) => {
    if (title.includes(term)) return total + 2;
    if (keywords.includes(term)) return total + 1;
    return total;
  }, 0);
}

/**
 * The best few destinations for a query, or none.
 *
 * Returning nothing is a supported outcome and not a failure: the tool's
 * contract is that the assistant may say "I can't see a page for that", which
 * is the honest answer and a much better one than the third-best route in the
 * product. §9.3 — the fallback has to be reachable, so it has to be producible.
 */
export function findPages(query: string): AppPage[] {
  const terms = words(query);

  return PAGES.map((page) => ({ page, score: score(page, terms) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES)
    .map((row) => row.page);
}
