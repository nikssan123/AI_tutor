import type { AgentTool } from "@/lib/ai/agent";
import { findPages } from "./pages";

/**
 * What the Assistant may do — `ASSISTANT-PLAN.md` §5.
 *
 * Every tool here is **read-only**, and that is a hard line rather than a
 * phasing decision (§9.2). Learner-authored text already reaches model context
 * across this product; with lookups the worst an injection buys is a wrong
 * sentence about data the learner can already see. A tool that could cancel a
 * subscription would turn the same nuisance into an action, so anything that
 * spends, cancels or submits ends at a link instead.
 *
 * When the first tool that reads a learner's own data lands, this takes a
 * context argument and every tool becomes a closure over the authenticated user
 * id (§4.3). The model picks *which* tool; it never supplies *whose* — no tool
 * signature accepts an identity, so there is nothing for a prompt to talk it
 * into. `find_page` is the one tool that will never need it: every page it
 * knows about is one any signed-in learner may open.
 */

export function findPageTool(): AgentTool {
  return {
    name: "find_page",
    description:
      "Find the page in this product that answers a question, by topic. Use it whenever the learner asks where something is, how to do something, or where to change a setting.",
    label: "Looking that up…",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "What the learner is looking for, in their own words — 'cancel my subscription', 'my calendar', 'what I've learned'.",
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
    run: async (input) => {
      const topic =
        typeof input === "object" && input !== null && "topic" in input
          ? String((input as { topic: unknown }).topic)
          : "";

      const matches = findPages(topic);

      if (matches.length === 0) {
        // A real answer, not a failure. §9.3 — "I can't see a page for that"
        // has to be reachable, so the tool has to be able to produce it.
        return {
          forModel: `No page in the product covers "${topic}". Say so, and do not guess at one.`,
          forView: null,
        };
      }

      return {
        forModel: matches
          .map((page) => `${page.title} (${page.path}) — ${page.blurb}`)
          .join("\n"),
        forView: null,
      };
    },
  };
}

/**
 * The registry, in the order the model reads it.
 *
 * A module-level list rather than one assembled per request: it renders ahead
 * of the cached system prompt, so a tool list that varied by learner would
 * invalidate §14.9.4's breakpoint on every call.
 */
export function buildTools(): AgentTool[] {
  return [findPageTool()];
}
