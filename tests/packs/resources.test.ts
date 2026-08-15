import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  DEAD_STATUSES,
  LINK_CHECK_CONCURRENCY,
  LINK_CHECK_TIMEOUT_MS,
  checkDrafts,
  checkLink,
  citedResources,
  type LinkFetcher,
} from "@/lib/packs/resources";
import {
  MAX_SEARCHES,
  PACK_RESOURCES_PROMPT,
  RESOURCE_BUDGET_MS,
  WEB_SEARCH_TOOL,
  buildResourcesContext,
  generateResources,
} from "@/lib/packs/generate/resources";
import { MAX_PACK_ATTEMPTS, withRefs } from "@/lib/packs/generate";
import { BUILD_TIMEOUT_MINUTES } from "@/lib/packs/build";
import type { DraftResource, DraftSkill, PackGraphDraft } from "@/lib/contracts/pack";
import { DomainPackSchema } from "@/lib/packs/types";

/**
 * §7.1's Resource Researcher, in two halves that are tested apart because they
 * fail apart: a model that finds pages, and a checker that decides whether the
 * pages it found are there.
 */

const skill = (i: number): DraftSkill => ({
  name: `Skill ${i}`,
  description: `A description for skill ${i} that is long enough.`,
  level: "core",
  area: `area-${i % 3}`,
  estimatedHours: 5,
  canDoStatement: `Do thing ${i} and produce something you can look at.`,
  observableEvidence: ["an artefact"],
  prerequisites: [],
  selfReportOnly: false,
});

const GRAPH: PackGraphDraft = {
  name: "Probe Subject",
  taxonomyParent: "technology",
  workspace: "code",
  skills: Array.from({ length: 8 }, (_, i) => skill(i)),
  rationale: "because",
};

const draft = (over: Partial<DraftResource> = {}): DraftResource => ({
  url: "https://example.test/a",
  title: "A Guide",
  publisher: "Example",
  kind: "tutorial",
  skills: ["s0"],
  assessment: "Good on the basics; stops before anything advanced.",
  publishedAt: "2025-01-15",
  ...over,
});

/** A fetcher that answers with a fixed status and records what it was asked. */
const fetcherFor = (status: number) => {
  const calls: string[] = [];
  const fetch: LinkFetcher = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    return { status };
  };
  return { fetch, calls };
};

describe("checkLink", () => {
  it("asks with HEAD, because we want the status line and not the page", async () => {
    const { fetch, calls } = fetcherFor(200);
    expect(await checkLink("https://example.test/a", { fetch })).toBe(true);
    expect(calls).toEqual(["HEAD https://example.test/a"]);
  });

  it.each([...DEAD_STATUSES])("treats %i as gone", async (status) => {
    const { fetch } = fetcherFor(status);
    expect(await checkLink("https://example.test/a", { fetch })).toBe(false);
  });

  it.each([403, 405, 429, 500])(
    "leaves a resource alone when the server only refused us (%i)",
    async (status) => {
      /*
       * The expensive mistake is the other way round. A bot filter, a rate
       * limiter and a bad afternoon are not evidence that a page stopped
       * existing, and dropping a good citation over someone else's 403 is a
       * silent loss nobody would go looking for.
       */
      const { fetch } = fetcherFor(status);
      expect(await checkLink("https://example.test/a", { fetch })).toBe(true);
    },
  );

  it("gives up on a host that never answers", async () => {
    /*
     * A link check has no deadline of its own, so without the timer one
     * unresponsive host would hold the whole authoring run open. The abort is
     * what turns "still waiting" into an answer.
     */
    vi.useFakeTimers();
    try {
      const fetch: LinkFetcher = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });

      const pending = checkLink("https://slow.test/a", { fetch });
      await vi.advanceTimersByTimeAsync(LINK_CHECK_TIMEOUT_MS);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a thrown request as unreachable", async () => {
    // DNS gone, connection refused, our own timeout. It is the one case where
    // "could not tell" and "is gone" get the same answer, and it is the right
    // way round: a name that no longer resolves is how citations usually die.
    const fetch: LinkFetcher = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    expect(await checkLink("https://gone.test/a", { fetch })).toBe(false);
  });

  it("falls back to the platform fetch when none is injected", async () => {
    const real = globalThis.fetch;
    const spy = vi.fn(async () => ({ status: 200 }) as unknown as Response);
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    try {
      expect(await checkLink("https://example.test/a")).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("checkDrafts", () => {
  it("stamps every draft with the finding and when it was made", async () => {
    const { fetch } = fetcherFor(200);
    const checked = await checkDrafts([draft(), draft({ url: "https://b.test" })], {
      fetch,
      now: () => new Date("2026-08-15T09:00:00.000Z"),
    });

    expect(checked.map((r) => r.reachable)).toEqual([true, true]);
    expect(checked.every((r) => r.checkedAt === "2026-08-15T09:00:00.000Z")).toBe(
      true,
    );
  });

  it("returns the dead ones too, rather than quietly losing them", async () => {
    // Assembly does the dropping and reports it. A checker that filtered here
    // would leave §14.6's "show the drops" with nothing to show.
    const fetch: LinkFetcher = async (url) => ({
      status: url.includes("gone") ? 404 : 200,
    });
    const checked = await checkDrafts(
      [draft(), draft({ url: "https://example.test/gone" })],
      { fetch },
    );

    expect(checked).toHaveLength(2);
    expect(checked.map((r) => r.reachable)).toEqual([true, false]);
  });

  it("checks in bounded batches rather than all at once", async () => {
    // Nothing is waiting on this, and a burst looks like a scraper to a host we
    // are trying to cite politely.
    let inFlight = 0;
    let peak = 0;
    const fetch: LinkFetcher = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { status: 200 };
    };

    await checkDrafts(
      Array.from({ length: 10 }, (_, i) => draft({ url: `https://x.test/${i}` })),
      { fetch },
    );
    expect(peak).toBeLessThanOrEqual(LINK_CHECK_CONCURRENCY);
  });

  it("does nothing at all when the research call found nothing", async () => {
    const { fetch, calls } = fetcherFor(200);
    expect(await checkDrafts([], { fetch })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("citedResources", () => {
  it("hands the validator the three fields it judges and nothing else", () => {
    // §14.6 asks whether the citations have rotted. Passing titles and
    // assessments would invite a check that judged the writing instead.
    const pack = DomainPackSchema.parse({
      slug: "probe",
      name: "Probe",
      maturity: "generated",
      evalTier: 2,
      workspace: "code",
      skills: [
        {
          slug: "a-skill",
          name: "A skill",
          description: "d",
          level: "core",
          area: "a",
          evalTier: 2,
          estimatedHours: 1,
          canDoStatement: "Do the thing",
          observableEvidence: ["e"],
          bktPriors: { pInit: 0.1, pLearn: 0.1, pSlip: 0.1, pGuess: 0.1 },
        },
      ],
      resources: [
        {
          slug: "a-guide",
          url: "https://example.test/a",
          title: "A Guide",
          publisher: "Example",
          kind: "tutorial",
          skills: ["a-skill"],
          assessment: "Fine.",
          publishedAt: "2025-01-15",
          checkedAt: "2026-08-15T00:00:00.000Z",
          reachable: false,
        },
      ],
    });

    expect(citedResources(pack)).toEqual([
      {
        url: "https://example.test/a",
        publishedAt: "2025-01-15",
        reachable: false,
      },
    ]);
  });

  it("is empty for a pack nobody has researched", () => {
    // The honest input for the seven curated packs until the backfill runs:
    // the check reports "not researched", not "all citations fresh".
    const pack = DomainPackSchema.parse({
      slug: "probe",
      name: "Probe",
      maturity: "curated",
      evalTier: 2,
      workspace: "code",
      skills: [
        {
          slug: "a-skill",
          name: "A skill",
          description: "d",
          level: "core",
          area: "a",
          evalTier: 2,
          estimatedHours: 1,
          canDoStatement: "Do the thing",
          observableEvidence: ["e"],
          bktPriors: { pInit: 0.1, pLearn: 0.1, pSlip: 0.1, pGuess: 0.1 },
        },
      ],
    });
    expect(citedResources(pack)).toEqual([]);
  });
});

describe("the researcher's prompt", () => {
  it("is a versioned file an AgentRun row can name (§14.9.6)", () => {
    expect(PACK_RESOURCES_PROMPT.name).toMatch(/^[a-z_]+$/);
    expect(PACK_RESOURCES_PROMPT.version).toBeGreaterThanOrEqual(1);
  });

  it("forbids recommending a URL from memory", () => {
    // The whole reason this call costs money. A model asked for "the canonical
    // tutorial" writes a confident URL that resolves to something else.
    expect(PACK_RESOURCES_PROMPT.text).toContain("Search first");
    expect(PACK_RESOURCES_PROMPT.text).toContain("not seen in a search result");
  });

  it("refuses a guessed publication date", () => {
    // `publishedAt` is the field §14.6 ages material out on. A date inferred
    // from how current the page feels turns the one rot signal into noise.
    expect(PACK_RESOURCES_PROMPT.text).toContain("Null if the page does not");
  });

  it("caps the searches in the tool rather than asking for restraint", () => {
    // A cap in the prompt is a request; a cap in the tool definition is a
    // budget. At 1c a search this is the larger half of the call's cost.
    expect(WEB_SEARCH_TOOL).toMatchObject({
      type: "web_search_20260209",
      max_uses: MAX_SEARCHES,
    });
  });

  it("keeps a whole build's worth of research inside the wait screen's cut-off", () => {
    /*
     * The constraint the two constants exist to satisfy, asserted as a
     * relationship rather than as their values — because the values are only
     * ever wrong relative to this.
     *
     * A build gets `MAX_PACK_ATTEMPTS` goes and each one may buy a reading
     * list, while `/start/building` calls a run past `BUILD_TIMEOUT_MINUTES`
     * stopped. At eight searches and no ceiling a measured run spent 4m45s here
     * *per attempt*, and two of those plus a graph, a bank and a rubric could
     * not fit — the learner would have been shown "this one stopped partway"
     * while the run was still going and still spending.
     *
     * Carrying the list across attempts (see `retargetResources`) means the
     * second attempt usually pays none of this. The margin below is what
     * happens when it does.
     */
    expect(MAX_PACK_ATTEMPTS * RESOURCE_BUDGET_MS).toBeLessThan(
      BUILD_TIMEOUT_MINUTES * 60_000,
    );
  });
});

describe("buildResourcesContext", () => {
  it("puts the reference where the model will quote it back", () => {
    const context = buildResourcesContext({
      subject: "Rust",
      skills: withRefs(GRAPH).slice(0, 2),
    });
    expect(context).toContain("s0:");
    expect(context).toContain("s1:");
    expect(context).toContain("Subject: Rust");
  });

  it("keeps self-report skills, unlike the rubric author's list", () => {
    /*
     * A rubric drops them because a project cannot be graded against taste.
     * That is not a constraint on a reading list — taste is exactly the thing
     * people go looking for material about.
     */
    const graph: PackGraphDraft = {
      ...GRAPH,
      skills: [{ ...skill(0), name: "Judgement", selfReportOnly: true }],
    };
    expect(
      buildResourcesContext({ subject: "Rust", skills: withRefs(graph) }),
    ).toContain("Judgement");
  });
});

/** A model that returns one tool input, with the usage a search would report. */
function modelReturning(input: unknown, webSearchRequests = 0) {
  const create = vi.fn(
    async (body: Anthropic.MessageCreateParamsNonStreaming) => ({
      id: "msg",
      type: "message",
      role: "assistant",
      model: body.model,
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        server_tool_use: { web_search_requests: webSearchRequests, web_fetch_requests: 0 },
      },
      content: [{ type: "tool_use", id: "t", name: "submit_resources", input }],
    }),
  );
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const FOUR = [
  draft({ url: "https://a.test", title: "Guide A" }),
  draft({ url: "https://b.test", title: "Guide B" }),
  draft({ url: "https://c.test", title: "Guide C" }),
  draft({ url: "https://d.test", title: "Guide D" }),
];

describe("generateResources", () => {
  it("returns a parsed draft", async () => {
    const { client } = modelReturning({ resources: FOUR });
    const result = await generateResources(client, {
      subject: "Rust",
      skills: withRefs(GRAPH),
    });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.value.resources).toHaveLength(4);
  });

  it("declares the search tool and does not force the submit tool", async () => {
    /*
     * The two halves of the same fact: a forced `tool_choice` means the model
     * must call that tool first, so it could never search. Asking for both
     * silently returns the schema with none of the research in it.
     */
    const { client, create } = modelReturning({ resources: FOUR });
    await generateResources(client, {
      subject: "Rust",
      skills: withRefs(GRAPH),
    });

    const body = create.mock.calls[0]![0];
    expect((body.tools as Array<{ type?: string }>)[0]!.type).toBe(
      "web_search_20260209",
    );
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("bills the searches it made", async () => {
    // §14.9.7's cap reads this number. A search recorded as free is the
    // under-counting the ledger exists to prevent.
    const { client } = modelReturning({ resources: FOUR }, 6);
    const result = await generateResources(client, {
      subject: "Rust",
      skills: withRefs(GRAPH),
    });

    expect(result.usage.webSearchRequests).toBe(6);
    expect(result.costCents).toBeGreaterThan(6);
  });

  it("reports a list too thin to be a reading list", async () => {
    const { client } = modelReturning({ resources: [draft()] });
    const result = await generateResources(client, {
      subject: "Rust",
      skills: withRefs(GRAPH),
    });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.detail).toContain("resources");
  });

  it("refuses a made-up date shaped wrong", async () => {
    const { client } = modelReturning({
      resources: FOUR.map((r) => ({ ...r, publishedAt: "sometime in 2024" })),
    });
    const result = await generateResources(client, {
      subject: "Rust",
      skills: withRefs(GRAPH),
    });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.detail).toContain("YYYY-MM-DD");
  });

  it("degrades with the rest of generation when the learner is over the cap", async () => {
    const { client, create } = modelReturning({ resources: FOUR });
    await generateResources(
      client,
      { subject: "Rust", skills: withRefs(GRAPH) },
      { degraded: true },
    );
    // Already the standard tier, so degrading changes nothing — which is the
    // point: the researcher is not a call worth paying Opus rates for.
    expect(create.mock.calls[0]![0].model).toBe("claude-sonnet-5");
  });
});
