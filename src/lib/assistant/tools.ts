import type { Db } from "@/db";
import type { AgentTool, ToolOutcome } from "@/lib/ai/agent";
import { calendarFor } from "@/lib/calendar/view";
import { findPages } from "./pages";
import {
  aheadListPayload,
  calendarMonthPayload,
  summarise,
  type WidgetView,
} from "./widgets";

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
 * **Every tool that reads a learner's data is a closure over the authenticated
 * context** (§4.3). The model picks *which* tool; it never supplies *whose* —
 * no tool signature accepts a user id, so there is nothing for a prompt to talk
 * it into. `find_page` is the one tool that needs no context at all: every page
 * it knows about is one any signed-in learner may open.
 */

export interface AssistantContext {
  db: Db;
  /** From the session, never from the model. */
  userId: string;
  now: Date;
}

/** The `topic`-shaped argument every lookup takes, read defensively. */
export function stringArg(input: unknown, name: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

/** A view plus the thin sentence the model is given about it (§2.1). */
export function showing(view: WidgetView): ToolOutcome {
  return { forModel: summarise(view), forView: view };
}

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
      const topic = stringArg(input, "topic");
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
 * The learner's own month, drawn by the same component `/progress` draws.
 *
 * `month` is the one argument, and it is not an identity: the worst a wrong one
 * does is show a month the learner did not ask for, and `calendarFor` already
 * falls back to the current month for anything it cannot read.
 */
export function calendarTool(context: AssistantContext): AgentTool {
  return {
    name: "my_calendar",
    description:
      "Show the learner their own calendar for a month: what they worked, what is due, and what is projected. Use it for any question about dates, this month, a named month, deadlines or what is coming up.",
    label: "Checking your calendar…",
    inputSchema: {
      type: "object",
      properties: {
        month: {
          type: "string",
          description:
            "The month to show, as YYYY-MM. Leave it out for the month they are in.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    run: async (input) => {
      const month = stringArg(input, "month");
      const view = await calendarFor(context.db, context.userId, context.now, {
        month: month === "" ? undefined : month,
      });

      if (!view) {
        return {
          forModel:
            "They have no course running, so there is no calendar to show. Say that, and offer to point them at the subjects page.",
          forView: null,
        };
      }

      return showing({
        widget: "calendar_month",
        payload: calendarMonthPayload(view),
      });
    },
  };
}

export function aheadTool(context: AssistantContext): AgentTool {
  return {
    name: "whats_next",
    description:
      "Show what the learner has coming: overdue work first, then soonest. Use it for 'what should I do next', 'what am I behind on', 'anything due'.",
    label: "Checking what's ahead…",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const view = await calendarFor(context.db, context.userId, context.now);

      if (!view) {
        return {
          forModel:
            "They have no course running, so nothing is ahead of them. Say that, and offer to point them at the subjects page.",
          forView: null,
        };
      }

      return showing({
        widget: "ahead_list",
        payload: aheadListPayload(view),
      });
    },
  };
}

/**
 * The registry, in the order the model reads it.
 *
 * Built per request because the data tools close over *this* learner — but its
 * shape never varies, so what renders ahead of the cached system prompt is the
 * same list every time and §14.9.4's breakpoint survives. The only thing that
 * differs between two learners' requests is what the closures can see, which is
 * exactly the property §9.1 wants.
 */
export function buildTools(context: AssistantContext): AgentTool[] {
  return [findPageTool(), calendarTool(context), aheadTool(context)];
}
