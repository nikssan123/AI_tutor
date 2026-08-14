import { allProjects, allTopics } from "@/lib/content";

/**
 * The own-data vocabulary — §12.2 dimension 7, made mechanical.
 *
 * That dimension asks for "≥1 data point only you have", and after month 3 it
 * stops being scored and becomes a gate. Scoring it by looking for numbers in
 * prose would be theatre: a number typed into a paragraph is a number that goes
 * stale the first time a pack is edited, and a page confidently stating a
 * figure the product no longer agrees with is worse than a page with no figure
 * at all.
 *
 * So a guide never types a number. It writes `{{topic:sql-data-analysis.skills}}`
 * and the build substitutes what the pack actually says. Three consequences,
 * all of them the point:
 *
 *   - the count of references *is* the originality measure, and it cannot be
 *     gamed by writing more adjectives;
 *   - a reference to something that does not exist fails the build, so a guide
 *     cannot describe a subject we do not teach (the same rule `content/index.ts`
 *     states for the pack-derived pages);
 *   - editing a pack updates every sentence about it, everywhere.
 *
 * The vocabulary is closed on purpose. An open expression language here would
 * be a template engine, and a template engine over prose is the machine that
 * writes the pages §12 exists to stop us writing.
 */

export class GuideDataError extends Error {
  constructor(reference: string, detail: string) {
    super(`Unresolvable data reference ${reference}: ${detail}`);
    this.name = "GuideDataError";
  }
}

/** `{{catalogue.subjects}}` · `{{topic:sql-data-analysis.hours}}`. */
const REFERENCE = /\{\{([a-z]+)(?::([a-z0-9-]+))?\.([a-z]+)\}\}/g;

/** Every own-data reference in a piece of prose, in order, with duplicates. */
export function dataReferences(text: string): string[] {
  return [...text.matchAll(REFERENCE)].map((m) => m[0]);
}

function topicValue(name: string, field: string, reference: string): string {
  const topic = allTopics().find((t) => t.slug === name);
  if (!topic) throw new GuideDataError(reference, `no subject "${name}"`);

  switch (field) {
    case "name":
      return topic.name;
    case "skills":
      return String(topic.skillCount);
    case "hours":
      return String(topic.totalHours);
    case "projects":
      return String(topic.projectCount);
    case "areas":
      return String(topic.areas.length);
    default:
      throw new GuideDataError(reference, `no subject field "${field}"`);
  }
}

function projectValue(name: string, field: string, reference: string): string {
  const project = allProjects().find((p) => p.slug === name);
  if (!project) throw new GuideDataError(reference, `no project "${name}"`);

  switch (field) {
    case "title":
      return project.title;
    case "minutes":
      return String(project.estimatedMinutes);
    case "criteria":
      return String(project.rubricDetail.criteria.length);
    case "skills":
      return String(project.skills.length);
    default:
      throw new GuideDataError(reference, `no project field "${field}"`);
  }
}

function catalogueValue(field: string, reference: string): string {
  const topics = allTopics();

  switch (field) {
    case "subjects":
      return String(topics.length);
    case "skills":
      return String(topics.reduce((n, t) => n + t.skillCount, 0));
    case "hours":
      return String(topics.reduce((n, t) => n + t.totalHours, 0));
    case "projects":
      return String(allProjects().length);
    default:
      throw new GuideDataError(reference, `no catalogue field "${field}"`);
  }
}

/**
 * Substitutes every reference, or throws on the first one that does not
 * resolve. Throwing is deliberate: this runs at build and in the validator, and
 * a guide quoting a subject that has been removed should stop a deploy rather
 * than render the literal braces to a reader.
 */
export function resolveData(text: string): string {
  return text.replace(REFERENCE, (reference, kind, name, field) => {
    switch (kind) {
      case "topic":
      case "project": {
        if (name === undefined) {
          throw new GuideDataError(reference, `${kind} needs a slug`);
        }
        return kind === "topic"
          ? topicValue(name, field, reference)
          : projectValue(name, field, reference);
      }
      case "catalogue": {
        if (name !== undefined) {
          throw new GuideDataError(reference, "catalogue takes no slug");
        }
        return catalogueValue(field, reference);
      }
      default:
        throw new GuideDataError(reference, `unknown source "${kind}"`);
    }
  });
}
