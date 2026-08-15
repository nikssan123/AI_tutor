import { AudienceContentError, type AudiencePath } from "./path";

/**
 * The own-data vocabulary for §10 C, and the reason the schema forbids a digit
 * anywhere in the prose.
 *
 * `guides/data.ts` makes this argument once already: a number typed into a
 * paragraph is a number that goes stale the first time a pack is edited, and a
 * page confidently stating a figure the product no longer agrees with is worse
 * than a page with no figure at all. On an audience page it is worse still,
 * because every figure here is *arithmetic over a claim the same file makes* —
 * "four of twenty-six skills" is wrong the moment a fifth claim is added three
 * lines further down, and nothing about the edit would remind anyone.
 *
 * So the vocabulary is smaller than the guides' and it is closed over one page:
 * a reference can only ask about the page it is written on. There is no way to
 * quote another subject's numbers here, which is deliberate — that is what a
 * guide is for, and a page type that could do both would be two page types.
 */

/** `{{known}}` · `{{hours.low}}`. */
const REFERENCE = /\{\{([a-z]+)(?:\.([a-z]+))?\}\}/g;

/** Every reference in a piece of prose, in order, with duplicates. */
export function pathReferences(text: string): string[] {
  return [...text.matchAll(REFERENCE)].map((m) => m[0]);
}

function hoursValue(
  path: AudiencePath,
  field: string | undefined,
  reference: string,
): string {
  const { hours } = path;
  switch (field) {
    case "total":
      return String(hours.total);
    case "known":
      return String(hours.known);
    case "low":
      return String(hours.low);
    case "high":
      return String(hours.high);
    default:
      throw new AudienceContentError(
        path.audience.slug,
        `no hours field "${field ?? "(none)"}" in ${reference}`,
      );
  }
}

/**
 * Substitutes every reference, or throws on the first that does not resolve.
 *
 * Throwing rather than leaving the braces is `resolveData`'s choice and it is
 * the right one for the same reason: this runs at build, and a page that has
 * outgrown its own vocabulary should stop a deploy rather than print `{{known}}`
 * to a reader.
 */
export function resolveReferences(path: AudiencePath, text: string): string {
  return text.replace(REFERENCE, (reference, name: string, field?: string) => {
    if (name === "hours") return hoursValue(path, field, reference);
    if (field !== undefined) {
      throw new AudienceContentError(
        path.audience.slug,
        `"${name}" takes no field in ${reference}`,
      );
    }

    switch (name) {
      case "subject":
        return path.topic.name;
      case "audience":
        return path.audience.audience;
      case "skills":
        return String(path.skills.length);
      case "known":
        return String(path.known.length);
      case "transfers":
        return String(path.transfers.length);
      case "new":
        return String(path.fresh.length);
      case "frontier":
        return String(path.frontier.length);
      case "projects":
        return String(path.projects.length);
      default:
        throw new AudienceContentError(
          path.audience.slug,
          `unknown reference ${reference}`,
        );
    }
  });
}

/** Every authored string on the page, resolved in place. */
export function resolveAudience(path: AudiencePath): AudiencePath {
  const say = (text: string) => resolveReferences(path, text);

  return {
    ...path,
    audience: {
      ...path.audience,
      // `title` and `description` are absent by design: the schema forbids a
      // digit in either, so there is nothing in them to resolve.
      h1: say(path.audience.h1),
      answer: say(path.audience.answer),
      ifYou: path.audience.ifYou.map(say),
      claims: path.audience.claims.map((claim) =>
        claim.verdict === "transfers"
          ? { ...claim, claim: say(claim.claim), note: say(claim.note) }
          : { ...claim, claim: say(claim.claim) },
      ),
      faqs: path.audience.faqs.map((faq) => ({
        question: say(faq.question),
        answer: say(faq.answer),
      })),
    },
  };
}
