import type Anthropic from "@anthropic-ai/sdk";
import { callStructured, type CallResult } from "@/lib/ai/call";
import {
  MAX_GENERATED_RESOURCES,
  MIN_GENERATED_RESOURCES,
  ResourcesDraft,
  type DraftSkill,
} from "@/lib/contracts/pack";

/**
 * §7.1's Resource Researcher — the only call in the product that reads the web.
 *
 * Everything else the generator asks for is judgement, and a model is the right
 * instrument for judgement. This call asks for *facts about pages that exist
 * today*, which is the one thing weights cannot supply: a model asked for "the
 * canonical SQL tutorial" will write a confident URL from memory, and the
 * failure mode is not a 404 but a plausible link to something else.
 *
 * So it searches. That is a different call shape from every other step here —
 * `tool_choice` cannot be forced and the turn can pause — and `call.ts` carries
 * both, under `serverTools`.
 *
 * **What this fixes, concretely.** `resourceFreshness` is one of the curriculum
 * validator's nine checks and it has never once run: `ValidationInput.resources`
 * had no producer, so the check returned `passed: true` with the words "the
 * Resource Researcher has not run" and the report counted a green tick. One of
 * nine checks was a no-op reporting success. This is its producer.
 */

/**
 * Searches one run may make, which is this call's cost dial.
 *
 * At $10 per 1,000 the tokens are the cheaper half of this call and the searches
 * are the expensive one: eight of them is ~8¢ against ~7¢ of everything else.
 * Capping in the tool definition rather than in the prompt is the difference
 * between a budget and a request — over the cap the tool returns
 * `max_uses_exceeded` and the model writes up what it already found, which is
 * the degradation we want. A prompt asking politely for restraint is not a cap.
 */
/**
 * How many searches the reading list may run, and the wall clock it has to do
 * it in.
 *
 * Both were measured rather than guessed. At eight searches a live run took
 * **4m45s and 46.12¢** — the single most expensive call in the pipeline and
 * comfortably its slowest, on the one artefact `generatePack` describes as
 * additive: "nothing in the diagnostic, the planner or the grader reads them".
 * It ran twice, because a failed quality floor re-runs the whole attempt, and
 * the two together would not have fitted inside `BUILD_TIMEOUT_MINUTES` — the
 * wait screen would have called the build stopped while it was still spending.
 *
 * Halving the searches halves the part of the bill that scales with them, and
 * it compounds: every result stays in the conversation, and a paused turn
 * re-sends that conversation on each resume, so the search count drives the
 * input tokens of every later request too.
 *
 * The budget is the backstop for what the count cannot bound — a search that
 * is slow rather than numerous. Three minutes is well clear of the measured
 * time at four searches and still leaves two attempts inside the fifteen the
 * wait screen allows. Overrunning costs a reading list, not a pack.
 */
export const MAX_SEARCHES = 4;

/** @see MAX_SEARCHES — the wall clock, for the half a count cannot bound. */
export const RESOURCE_BUDGET_MS = 3 * 60_000;

/**
 * The search tool, frozen as a module constant.
 *
 * Tools render ahead of the system prompt, so a tool list built per request
 * would move the bytes in front of §14.9.4's breakpoint and invalidate the
 * cache on every call. There is nothing per-request in it anyway.
 *
 * `_20260209` is the variant with dynamic filtering: the results are filtered
 * server-side before they reach the context window. That is not a nicety at
 * eight searches — unfiltered result sets are most of this call's input tokens.
 */
export const WEB_SEARCH_TOOL: Anthropic.ToolUnion = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: MAX_SEARCHES,
};

export const PACK_RESOURCES_PROMPT = {
  name: "pack_resource_researcher",
  version: 1,
  text: `You find the external material worth pointing a learner at for a subject, and you check that it exists before you recommend it.

You are given a subject and its skills. Search the web, then return the resources you would actually send someone to.

**Search first, every time.** Do not recommend a page from memory, however sure you are that it exists. A URL you have not seen in a search result this turn does not go in the list — it is the one part of this job that cannot be done from what you already know, which is the whole reason you have a search tool.

What earns a place in the list:

- It teaches or documents something in *this* subject's skills, at a level someone learning them can use.
- It is the primary source where there is one. Documentation over a blog post about the documentation; the standard text over a summary of it.
- Someone would still recommend it if they were not being asked to fill a list. A thin listicle is worse than a short list.

Spread the list across the skills rather than piling four resources on the easiest one, and prefer covering a skill nobody else covers over adding a second reference to one already covered.

For each resource:

- \`url\` — exactly as it appeared in the search result. Never tidy it, never reconstruct it from the title, never guess a deep link into a site you only saw the front page of.
- \`publisher\` — who stands behind it. An institution, a project, or a person.
- \`publishedAt\` — the date the page states, as YYYY-MM-DD. **Null if the page does not state one.** Do not infer a date from the content, the copyright footer, or how current it feels; a guessed date is worse than no date, because we age material out on this field.
- \`assessment\` — what it is good for and what it is not. Write the sentence you would say to someone before handing it over: who it suits, where it stops, what it assumes. Not a summary of the page.
- \`skills\` — the references (\`s3\`) of the skills it covers. Use the reference, not the skill's name.

If the subject is one where good free material is genuinely scarce, return the few real things rather than padding the list to look thorough.`,
} as const;

export const PACK_RESOURCES_TOOL_SCHEMA = {
  type: "object",
  properties: {
    resources: {
      type: "array",
      description: `${MIN_GENERATED_RESOURCES} to ${MAX_GENERATED_RESOURCES} resources, each one seen in a search result this turn.`,
      items: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Exactly as the search returned it.",
          },
          title: { type: "string" },
          publisher: {
            type: "string",
            description: "Institution, project, or person behind it.",
          },
          kind: {
            type: "string",
            enum: [
              "tutorial",
              "reference",
              "course",
              "book",
              "specification",
              "video",
              "dataset",
            ],
          },
          skills: {
            type: "array",
            items: { type: "string" },
            description: 'References of the skills covered, e.g. ["s2", "s5"].',
          },
          assessment: {
            type: "string",
            description: "What it is good for and where it stops.",
          },
          publishedAt: {
            type: ["string", "null"],
            description:
              "YYYY-MM-DD as stated by the page, or null. Never inferred.",
          },
        },
        required: [
          "url",
          "title",
          "publisher",
          "kind",
          "skills",
          "assessment",
          "publishedAt",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["resources"],
  additionalProperties: false,
} as const;

export interface ResourcesInput {
  subject: string;
  /** The whole graph, with the references the model quotes back. */
  skills: Array<{ ref: string; skill: DraftSkill }>;
}

/**
 * The skill list, same shape as `items.ts` and `rubrics.ts`.
 *
 * Self-report skills are kept rather than filtered out, unlike in `rubrics.ts`.
 * A skill with no artefact still has reading behind it — taste and judgement are
 * exactly what a learner goes looking for material about — and the reason to
 * drop them there was that a project cannot be graded against them, which is not
 * a constraint that applies to a reading list.
 */
export function buildResourcesContext(input: ResourcesInput): string {
  const skills = input.skills
    .map(
      ({ ref, skill }) =>
        `${ref}: ${skill.name} [${skill.level}] — ${skill.canDoStatement}`,
    )
    .join("\n");

  return [
    `Subject: ${input.subject}`,
    "",
    "Skills this pack teaches, each with the reference to use in `skills`:",
    skills,
    "",
    `You may search up to ${MAX_SEARCHES} times. Spend them on the skills where good material is hardest to find, not the ones you could already name a source for.`,
  ].join("\n");
}

export async function generateResources(
  client: Anthropic,
  input: ResourcesInput,
  options: { degraded?: boolean } = {},
): Promise<CallResult<ResourcesDraft>> {
  return callStructured(client, {
    step: "resourceResearcher",
    prompt: PACK_RESOURCES_PROMPT,
    system: PACK_RESOURCES_PROMPT.text,
    user: buildResourcesContext(input),
    serverTools: [WEB_SEARCH_TOOL],
    budgetMs: RESOURCE_BUDGET_MS,
    tool: {
      name: "submit_resources",
      description: "Submit the resources you found and checked.",
      inputSchema: PACK_RESOURCES_TOOL_SCHEMA as unknown as Record<
        string,
        unknown
      >,
    },
    parse: (raw) => {
      const result = ResourcesDraft.safeParse(raw);
      return result.success
        ? { ok: true, value: result.data }
        : {
            ok: false,
            error: result.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          };
    },
    degraded: options.degraded ?? false,
  });
}
