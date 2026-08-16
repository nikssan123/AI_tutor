import {
  MIN_GENERATED_ITEMS,
  MIN_ITEMS_PER_SKILL,
  type DraftItem,
  type DraftSkill,
  type PackGraphDraft,
  type RubricsDraft,
} from "@/lib/contracts/pack";
import { MIN_PRODUCTION_TO_MCQ_RATIO, validatePack } from "../validate";
import { PRODUCTION_ITEM_TYPES, type DomainPack } from "../types";
import { DomainPackSchema } from "../types";
import type { CheckedResource } from "../resources";
import {
  PRIORS_BY_LEVEL,
  nameResolver,
  normaliseWeights,
  numberedSlug,
  skillRef,
  slugify,
  tierFor,
  uniqueSlugs,
} from "./derive";
import type { ValidationReport } from "../validate";

/**
 * The three drafts, turned into a `DomainPack` that passes `validatePack`.
 *
 * Pure and model-free, which is the point: every rule the validator enforces is
 * either satisfied by construction here or the offending piece is dropped, so a
 * generation does not fail on arithmetic a function could have done. What is
 * left for the validator to catch is the thing code cannot fix — a subject the
 * model did not have enough to say about.
 *
 * Everything dropped is reported rather than silently discarded. §14.6 wants
 * drops shown, and a pack that quietly lost half its item bank should look
 * different from one that never had it.
 */

export interface AssembleInput {
  slug: string;
  graph: PackGraphDraft;
  items: DraftItem[];
  rubrics: RubricsDraft;
  /** Already link-checked (`checkDrafts`); empty when the research call failed. */
  resources: CheckedResource[];
}

export interface AssembleResult {
  /** Null when the assembled pack does not satisfy `DomainPackSchema`. */
  pack: DomainPack | null;
  /** Null exactly when `pack` is. */
  report: ValidationReport | null;
  /** What was dropped and why, in the order it happened. */
  dropped: string[];
  /** Why nothing could be assembled. Empty whenever `pack` is set. */
  reasons: string[];
}

/**
 * How many schema complaints are worth reporting.
 *
 * One bad slug produces one issue per item that used it — the run this was
 * written for had twenty-two identical "too big" messages. The first few say
 * everything the next twenty do.
 */
export const MAX_REPORTED_ISSUES = 5;

/** §7.2 — what a generated pack is allowed to say about itself. */
export const GENERATED_QUALITY = {
  status: "unreviewed",
  reviewedBy: null,
  // A model wrote it; a model reviewing it would not be a second opinion. Null
  // until the admin promotion gate records a person.
  reviewKind: null,
  reviewedAt: null,
  score: null,
} as const;

/**
 * Edges from each skill's `prerequisites`, keeping only backward references.
 *
 * The prompt asks for skills in dependency order and for prerequisites named
 * from earlier in the list. Enforcing it here rather than trusting it is what
 * makes the graph acyclic *by construction*: an edge can only ever point at a
 * skill with a lower index, and a graph whose edges all point one way cannot
 * contain a cycle. `detectCycle` still runs in the validator; it has nothing
 * left to find.
 */
function dependenciesFrom(
  skills: DraftSkill[],
  slugOf: Map<string, string>,
  dropped: string[],
): DomainPack["dependencies"] {
  const indexOf = new Map(skills.map((s, i) => [s.name, i]));
  // Same tidied-punctuation problem as the item bank: a prerequisite naming
  // "Ownership and `Copy`" for a skill listed as "Ownership and Copy" is the
  // same edge, not a missing one.
  const looseIndex = new Map<string, number>();
  for (const [name, i] of indexOf) {
    if (!looseIndex.has(slugify(name))) looseIndex.set(slugify(name), i);
  }

  const edges: DomainPack["dependencies"] = [];
  const seen = new Set<string>();

  skills.forEach((skill, i) => {
    for (const prerequisite of skill.prerequisites) {
      const at = indexOf.get(prerequisite) ?? looseIndex.get(slugify(prerequisite));

      if (at === undefined) {
        dropped.push(
          `prerequisite "${prerequisite}" of "${skill.name}" names no skill in the pack`,
        );
        continue;
      }
      if (at >= i) {
        dropped.push(
          `prerequisite "${prerequisite}" of "${skill.name}" is not earlier in the graph`,
        );
        continue;
      }

      const from = slugOf.get(skills[at]!.name)!;
      const to = slugOf.get(skill.name)!;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;

      seen.add(key);
      edges.push({ from, to, type: "hard", strength: 1 });
    }
  });

  return edges;
}

/**
 * The item bank, with everything the validator would block on removed.
 *
 * The 2:1 production-to-recognition ratio (§16.4) is held by dropping surplus
 * multiple-choice rather than by asking the model to count. Dropping is safe in
 * a way that keeping is not: a pack with too few MCQs is fine, a pack with too
 * many fails outright, and the production items are the ones worth keeping.
 */
function itemsFrom(
  items: DraftItem[],
  resolve: (name: string) => string | undefined,
  dropped: string[],
): DomainPack["items"] {
  const kept: DomainPack["items"] = [];
  const perSkill = new Map<string, number>();
  // Held across the whole bank, because two skills whose slugs share their
  // first sixty characters produce the same trimmed stem.
  const itemSlugs = new Set<string>();

  for (const item of items) {
    const skill = resolve(item.skill);
    if (!skill) {
      dropped.push(`item for unknown skill "${item.skill}"`);
      continue;
    }

    if (item.type === "mcq" && (item.options?.length ?? 0) < 2) {
      dropped.push(`multiple-choice item with fewer than two options`);
      continue;
    }

    const n = (perSkill.get(skill) ?? 0) + 1;
    perSkill.set(skill, n);

    /*
     * `numberedSlug` rather than a template, and the difference is 297¢.
     *
     * This was `${skill}-${n}`, under a comment arguing that it could not
     * repeat — which was true, and beside the point. Skill slugs are capped at
     * exactly `MAX_SLUG_LENGTH`, so appending `-1` to a long one produces a
     * slug the schema refuses, and the pack built from four model calls was
     * thrown away. Uniqueness was reasoned about; length was not.
     */
    const slug = numberedSlug(skill, n, itemSlugs);

    const answerKey =
      item.type === "mcq"
        ? { correct: item.correct ?? 0 }
        : { concepts: item.concepts ?? [] };

    kept.push({
      slug,
      skill,
      type: item.type,
      difficulty: item.difficulty,
      discrimination: 1,
      prompt: item.prompt,
      // What the author said the answer is typed as. A model that omitted it
      // has already been defaulted to prose by the draft schema, which is the
      // safe direction: a prose box for code is the old behaviour, a code box
      // for a paragraph is a new annoyance.
      answerFormat: item.answerFormat,
      // The validator warns when a non-MCQ carries options, so they are only
      // ever attached to the type that uses them.
      ...(item.type === "mcq" ? { options: item.options } : {}),
      answerKey,
    });
  }

  // After the ratio, never before it: `enforceRatio` drops multiple-choice
  // items, and dropping changes the very distribution this is balancing.
  return balanceAnswerPositions(enforceRatio(kept, dropped));
}

/**
 * Options whose text names where they sit, and so cannot be moved.
 *
 * "None of the above" is the whole family: reorder it and the item stops making
 * sense, or worse, quietly starts being wrong. Deliberately a little greedy —
 * over-matching costs one item its shuffle, which the balancer works around,
 * while under-matching corrupts an item nobody would catch reading the diff.
 */
const POSITIONAL_OPTION = /\b(?:above|below)\b|^\s*(?:all|none|both|neither)\b/i;

/**
 * Spreads the correct answers across the option positions.
 *
 * **This is the repair `meetsQualityFloor` already assumes exists.** Its comment
 * says assembly "builds a pack that satisfies every blocking rule ... so this
 * should never fire" — and that was true of every rule but one.
 * `mcq_answer_position` had no repair, so a bank the model happened to write
 * with its answers bunched was thrown away *after* every model call had been
 * paid for. A measured build died exactly that way: 3 of 5 answers in option 2,
 * 149¢ spent, no pack.
 *
 * It was not the model's fault either, and that is the part worth keeping in
 * mind if this is ever revisited. Nothing in `PACK_ITEMS_PROMPT` asked for
 * variety until now, and items are authored in independent parallel batches, so
 * no single call can see the distribution it is contributing to. Asking nicely
 * cannot guarantee an aggregate property that no one participant can observe —
 * which is why the guarantee lives here, where the whole bank is in hand, and
 * the prompt only has to make the raw output better rather than perfect.
 *
 * The move is a swap, and a swap is safe: `correct` is an index into `options`,
 * so exchanging two entries and pointing the index at the new one preserves
 * exactly which text is the right answer. Nothing is rewritten, nothing is
 * dropped, and no model call is made — a validator failure worth £1 becomes
 * arithmetic.
 *
 * Least-loaded rather than round-robin: option counts vary from two to five, so
 * a fixed rotation would pile onto the low positions every time a short item
 * appeared. Ties break toward the lower index, so the result is deterministic —
 * the same bank always assembles the same way.
 */
export function balanceAnswerPositions(
  items: DomainPack["items"],
): DomainPack["items"] {
  const load = new Map<number, number>();
  const bump = (at: number) => load.set(at, (load.get(at) ?? 0) + 1);

  const movable: { index: number; options: string[]; correct: number }[] = [];

  items.forEach((item, index) => {
    const correct = (item.answerKey as { correct?: number } | undefined)?.correct;
    const options = item.options;
    if (item.type !== "mcq" || !options || typeof correct !== "number") return;

    /*
     * Pinned, not skipped, and the difference matters: an answer that cannot
     * move still occupies a position, and the validator counts it. Balancing
     * the movable ones *around* it is what makes the result even rather than
     * merely different. An out-of-range index is pinned for the same reason —
     * it is a broken item for another check to fail, and moving it would only
     * disguise that.
     */
    if (
      correct < 0 ||
      correct >= options.length ||
      options.some((option) => POSITIONAL_OPTION.test(option))
    ) {
      bump(correct);
      return;
    }

    movable.push({ index, options, correct });
  });

  const balanced = [...items];

  for (const { index, options, correct } of movable) {
    let target = 0;
    for (let at = 1; at < options.length; at += 1) {
      if ((load.get(at) ?? 0) < (load.get(target) ?? 0)) target = at;
    }
    bump(target);
    if (target === correct) continue;

    const swapped = [...options];
    swapped[target] = options[correct]!;
    swapped[correct] = options[target]!;

    balanced[index] = {
      ...balanced[index]!,
      options: swapped,
      answerKey: { correct: target },
    };
  }

  return balanced;
}

/**
 * Drops multiple-choice items until production items outnumber them 2:1.
 *
 * Hardest MCQs go first among those dropped only in the sense of stability —
 * the order is the bank's own, so the same draft always yields the same bank.
 */
export function enforceRatio(
  items: DomainPack["items"],
  dropped: string[],
): DomainPack["items"] {
  const production = items.filter((i) => PRODUCTION_ITEM_TYPES.includes(i.type));
  const mcq = items.filter((i) => !PRODUCTION_ITEM_TYPES.includes(i.type));

  const allowed = Math.floor(production.length / MIN_PRODUCTION_TO_MCQ_RATIO);
  if (mcq.length <= allowed) return items;

  const surplus = mcq.length - allowed;
  dropped.push(
    `${surplus} multiple-choice item(s) dropped to hold §16.4's ${MIN_PRODUCTION_TO_MCQ_RATIO}:1 production ratio`,
  );

  const keep = new Set(mcq.slice(0, allowed).map((i) => i.slug));
  return items.filter(
    (i) => PRODUCTION_ITEM_TYPES.includes(i.type) || keep.has(i.slug),
  );
}

/**
 * The resource index, with everything we cannot stand behind removed.
 *
 * Three drops, and the order matters only in what gets reported. A dead link is
 * dropped because the whole point of researching rather than recalling was to
 * cite something that exists — keeping it would leave the pack making the exact
 * claim the checker just disproved. A duplicate URL is dropped because a list
 * that recommends one page twice reads as padding. A resource whose skills all
 * fall outside the pack is dropped for the same reason an item is: it points at
 * something this pack does not teach.
 *
 * Unresolvable skills are pruned rather than fatal — a resource that covers
 * three skills and names a fourth we do not have is still a good resource for
 * the three.
 */
function resourcesFrom(
  checked: CheckedResource[],
  resolve: (name: string) => string | undefined,
  dropped: string[],
): DomainPack["resources"] {
  const slugs = uniqueSlugs(checked.map((r) => r.title));
  const seen = new Set<string>();
  const kept: DomainPack["resources"] = [];

  for (const resource of checked) {
    if (!resource.reachable) {
      dropped.push(`resource "${resource.title}" — ${resource.url} did not resolve`);
      continue;
    }
    if (seen.has(resource.url)) {
      dropped.push(`resource "${resource.title}" repeats ${resource.url}`);
      continue;
    }

    const skills = resource.skills.flatMap((ref) => {
      const slug = resolve(ref);
      return slug ? [slug] : [];
    });

    if (skills.length === 0) {
      dropped.push(
        `resource "${resource.title}" covers no skill this pack contains`,
      );
      continue;
    }

    seen.add(resource.url);
    kept.push({
      slug: slugs.get(resource.title)!,
      url: resource.url,
      title: resource.title,
      publisher: resource.publisher,
      kind: resource.kind,
      skills: [...new Set(skills)],
      assessment: resource.assessment,
      publishedAt: resource.publishedAt,
      checkedAt: resource.checkedAt,
      reachable: true,
    });
  }

  return kept;
}

export function assemblePack(input: AssembleInput): AssembleResult {
  const dropped: string[] = [];
  const { graph } = input;

  const slugOf = uniqueSlugs(graph.skills.map((s) => s.name));
  // References are assigned by position over the whole graph, exactly as the
  // item and rubric calls were shown them.
  const refs = new Map(
    graph.skills.map((s, i) => [skillRef(i), slugOf.get(s.name)!]),
  );
  const resolveSkill = nameResolver(slugOf, refs);

  const skills: DomainPack["skills"] = graph.skills.map((s) => ({
    slug: slugOf.get(s.name)!,
    name: s.name,
    description: s.description,
    level: s.level,
    area: s.area,
    evalTier: tierFor(graph.workspace, s.selfReportOnly),
    estimatedHours: s.estimatedHours,
    canDoStatement: s.canDoStatement,
    observableEvidence: s.observableEvidence,
    bktPriors: PRIORS_BY_LEVEL[s.level],
  }));

  const dependencies = dependenciesFrom(graph.skills, slugOf, dropped);
  const items = itemsFrom(input.items, resolveSkill, dropped);

  /* ── Rubrics ────────────────────────────────────────────────────────────── */

  const rubricSlugs = uniqueSlugs(input.rubrics.rubrics.map((r) => r.name));
  const resolveRubric = nameResolver(rubricSlugs);
  const rubrics: DomainPack["rubrics"] = input.rubrics.rubrics.map((r) => {
    const weights = normaliseWeights(r.criteria);
    const criterionSlugs = uniqueSlugs(r.criteria.map((c) => c.name));

    return {
      slug: rubricSlugs.get(r.name)!,
      version: 1,
      isPublic: true,
      criteria: r.criteria.map((c, i) => ({
        id: criterionSlugs.get(c.name)!,
        name: c.name,
        description: c.description,
        weight: weights[i]!,
        bands: c.bands,
      })),
    };
  });

  const projectSlugs = uniqueSlugs(input.rubrics.projects.map((p) => p.title));
  const projects: DomainPack["projects"] = input.rubrics.projects.flatMap(
    (p) => {
      const rubric = resolveRubric(p.rubric);
      if (!rubric) {
        dropped.push(
          `project "${p.title}" names rubric "${p.rubric}", which was not written`,
        );
        return [];
      }

      const targetSkills = p.targetSkills.flatMap((name) => {
        const slug = resolveSkill(name);
        if (!slug) {
          dropped.push(
            `project "${p.title}" targets unknown skill "${name}"`,
          );
          return [];
        }
        return [slug];
      });

      if (targetSkills.length === 0) {
        dropped.push(
          `project "${p.title}" targets no skill this pack contains`,
        );
        return [];
      }

      return [
        {
          slug: projectSlugs.get(p.title)!,
          title: p.title,
          brief: p.brief,
          rubric,
          evidenceType: p.evidenceType,
          difficulty: p.difficulty,
          estimatedMinutes: p.estimatedMinutes,
          // §12.1 — a generated pack is never an SEO surface, so its briefs are
          // not public. `isTopicIndexable` says the same thing at the other end.
          isPublic: false,
          targetSkills,
          acceptanceCriteria: p.acceptanceCriteria,
        },
      ];
    },
  );

  /* ── The pack ───────────────────────────────────────────────────────────── */

  const candidate = {
    slug: input.slug,
    name: graph.name,
    taxonomyParent: slugify(graph.taxonomyParent),
    maturity: "generated" as const,
    // The pack's own tier is the weakest claim any of its skills makes, so the
    // badge cannot promise more than the least verifiable thing in it.
    evalTier: Math.max(...skills.map((s) => s.evalTier)) as DomainPack["evalTier"],
    workspace: graph.workspace,
    version: 1,
    evaluatorConfig: {},
    quality: { ...GENERATED_QUALITY },
    skills,
    dependencies,
    items,
    rubrics,
    projects,
    resources: resourcesFrom(input.resources, resolveSkill, dropped),
  };

  /*
   * `safeParse`, and this is the other half of the 297¢ bug.
   *
   * A `parse` here *throws*, and the throw goes straight past everything built
   * to handle a bad generation: the quality floor never runs, `dropped` is
   * never returned, and `generatePack`'s two-attempt loop never sees it. It
   * surfaces instead as an Inngest **step** failure — which the queue is
   * entitled to read as transient, so it retried the whole pipeline. A
   * deterministic schema error was charged for three times, and would have been
   * five with the default retry count.
   *
   * A model producing something the schema refuses is an expected outcome of
   * asking a model for structured data, not an exception — the same argument
   * `call.ts` makes about an unparseable tool call. So it is reported, and the
   * caller decides.
   */
  const parsed = DomainPackSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      pack: null,
      report: null,
      dropped,
      reasons: parsed.error.issues
        .slice(0, MAX_REPORTED_ISSUES)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return {
    pack: parsed.data,
    report: validatePack(parsed.data),
    dropped,
    reasons: [],
  };
}

/**
 * Whether an assembled pack is good enough to put in front of a learner.
 *
 * Separate from `validatePack` on purpose. The validator answers "is this a
 * well-formed pack", and for a Generated pack it deliberately answers yes to
 * thin ones — §7.1's whole argument is that depth is declared rather than
 * faked. This answers the different question of whether there is enough here to
 * be worth a learner's time, and it is the generator's own floor: a diagnostic
 * that can place someone on three of eleven skills is not a diagnostic.
 */
export interface QualityFloor {
  passed: boolean;
  reasons: string[];
}

/** A pack must be able to place a learner on at least this share of its skills. */
export const MIN_SKILL_COVERAGE = 0.8;

export function meetsQualityFloor(
  pack: DomainPack,
  report: ValidationReport,
): QualityFloor {
  const reasons: string[] = [];

  /*
   * The validator's verdict is folded in here rather than checked separately.
   * `assemblePack` builds a pack that satisfies every blocking rule — cycles,
   * weights, duplicate slugs and the item ratio are all handled by construction
   * or by dropping — so this should never fire. It is kept as one gate rather
   * than an unreachable branch of its own so that if assembly ever regresses,
   * the pack is rejected instead of reaching a learner.
   */
  for (const issue of report.issues) {
    if (issue.severity === "blocking") reasons.push(issue.message);
  }

  const perSkill = new Map<string, number>();
  for (const item of pack.items) {
    perSkill.set(item.skill, (perSkill.get(item.skill) ?? 0) + 1);
  }

  // Self-report skills are excluded: §7.2 tier 5 says they cannot be assessed
  // at all, so having no items for them is correct rather than a gap.
  const assessable = pack.skills.filter((s) => s.evalTier !== 5);
  const covered = assessable.filter(
    (s) => (perSkill.get(s.slug) ?? 0) >= MIN_ITEMS_PER_SKILL,
  );

  if (pack.items.length < MIN_GENERATED_ITEMS) {
    reasons.push(
      `${pack.items.length} items; a diagnostic needs at least ${MIN_GENERATED_ITEMS}`,
    );
  }

  const coverage =
    assessable.length === 0 ? 0 : covered.length / assessable.length;
  if (coverage < MIN_SKILL_COVERAGE) {
    reasons.push(
      `only ${covered.length} of ${assessable.length} assessable skills have ${MIN_ITEMS_PER_SKILL} items`,
    );
  }

  if (pack.projects.length === 0) {
    reasons.push("no project survived assembly, so nothing can be graded");
  }

  return { passed: reasons.length === 0, reasons };
}
