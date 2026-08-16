import { describe, expect, it } from "vitest";
import { buildTools, findPageTool } from "@/lib/assistant/tools";

/**
 * The registry.
 *
 * Two things worth asserting beyond the lookup itself, and both are about
 * §9.1: no tool signature accepts an identity, so there is nothing for a prompt
 * to talk the model into supplying — and a tool handed rubbish instead of
 * arguments answers rather than throws, because the loop is mid-sentence when
 * it happens.
 */

describe("find_page", () => {
  const tool = findPageTool();

  it("answers with the page, its path, and what it is for", async () => {
    const outcome = await tool.run({ topic: "cancel my subscription" });

    expect(outcome.forModel).toContain("/account/billing");
    expect(outcome.forModel).toContain("Billing");
    // Phase 1 is text only — the widget layer arrives with the data tools.
    expect(outcome.forView).toBeNull();
  });

  it("tells the model to say nothing rather than guess", async () => {
    const outcome = await tool.run({ topic: "the offside rule" });
    expect(outcome.forModel).toContain("do not guess");
  });

  it("treats missing or malformed arguments as an empty question", async () => {
    for (const input of [{}, null, "topic", { topic: undefined }]) {
      const outcome = await tool.run(input);
      expect(outcome.forModel).toContain("do not guess");
    }
  });

  it("reads a topic the model sent as something other than a string", async () => {
    const outcome = await tool.run({ topic: 42 });
    expect(outcome.forModel).toContain("do not guess");
  });

  /** §9.1 — the model picks which tool, never whose data. */
  it("takes no identity argument", () => {
    const schema = tool.inputSchema as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };

    expect(Object.keys(schema.properties)).toEqual(["topic"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("says what it is doing in its own words", () => {
    expect(tool.label).not.toBe("");
  });
});

describe("buildTools", () => {
  it("registers the lookups, each with a name the model can call", () => {
    const tools = buildTools();

    expect(tools.map((tool) => tool.name)).toEqual(["find_page"]);
    for (const tool of tools) {
      expect(tool.description).not.toBe("");
      expect(tool.inputSchema).toHaveProperty("type", "object");
    }
  });

  /** The list renders ahead of the cached prefix, so it must not vary. */
  it("builds the same list every time", () => {
    expect(buildTools().map((tool) => tool.name)).toEqual(
      buildTools().map((tool) => tool.name),
    );
  });
});
