import type { TopicSummary } from "@/lib/content";

/**
 * §7.1's `taxonomy_parent`, given one vocabulary and a display name.
 *
 * There were two vocabularies before this, and they had never met. The packs on
 * disk used `technical-entry` and `professional-business`; the pack *generator*
 * asks the model for "one-word branch, lowercase — e.g. technology, business,
 * creative, science, language, craft". So every generated pack landed outside
 * the icon map and drew the neutral grid, and no screen could group subjects
 * because no two sources agreed on what a group was.
 *
 * The generator's vocabulary wins, for two reasons: it is the open-ended side —
 * a subject nobody has written can arrive under any branch, and the fixed side
 * has four packs — and its words are the ones a person would use. `technical-entry`
 * is a difficulty band wearing a category's clothes.
 *
 * **Order is the display order**, and it is deliberate rather than alphabetical:
 * §5's primary user is a career-switcher, so the branch most of them come for
 * goes first. Nothing else about the list is load-bearing.
 */
export interface Category {
  slug: string;
  name: string;
  /** One line, shown under the heading. Says what belongs here, not why it is good. */
  blurb: string;
}

export const CATEGORIES: Category[] = [
  {
    slug: "technology",
    name: "Software & data",
    blurb: "Writing code, querying data, and knowing whether the answer is right.",
  },
  {
    slug: "business",
    name: "Business & money",
    blurb: "Being understood at work, and deciding what to do with money.",
  },
  {
    slug: "creative",
    name: "Creative",
    blurb: "Making things people look at, where the craft can be checked even when taste cannot.",
  },
  {
    slug: "craft",
    name: "Craft & making",
    blurb: "Skills whose result is a physical thing, judged from a photograph of it and your account of how you got there.",
  },
  {
    slug: "language",
    name: "Languages",
    blurb: "Reading and writing another language. Speaking is not assessed here yet, and every subject in this branch says so.",
  },
];

/**
 * The bucket for a branch no category claims.
 *
 * Generated packs can arrive under `science`, `language`, `craft` or anything
 * else a model reasonably produces, and a subject the learner asked for is the
 * last thing that should vanish from a list because our taxonomy did not
 * anticipate it. It is never dropped and never silently relabelled.
 */
export const OTHER: Category = {
  slug: "other",
  name: "Everything else",
  blurb: "Subjects written on request that do not sit under the branches above.",
};

export function categoryFor(taxonomyParent: string | null): Category {
  return CATEGORIES.find((c) => c.slug === taxonomyParent) ?? OTHER;
}

export interface CategorisedTopics {
  category: Category;
  topics: TopicSummary[];
}

/**
 * Groups topics for display, dropping empty categories and putting `OTHER`
 * last however many things land in it.
 *
 * Preserves the order it was given inside each group, so a caller that sorted
 * by name keeps that, and a caller that did not gets pack order.
 */
export function groupByCategory(topics: TopicSummary[]): CategorisedTopics[] {
  const groups = new Map<string, TopicSummary[]>();
  for (const topic of topics) {
    const { slug } = categoryFor(topic.taxonomyParent);
    groups.set(slug, [...(groups.get(slug) ?? []), topic]);
  }

  const ordered = [...CATEGORIES, OTHER]
    .map((category) => ({ category, topics: groups.get(category.slug) ?? [] }))
    .filter((group) => group.topics.length > 0);

  return ordered;
}
