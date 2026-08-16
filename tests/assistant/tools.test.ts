import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import type { CalendarView } from "@/lib/calendar/view";

/**
 * The registry.
 *
 * Two things worth asserting beyond the lookups themselves, and both are about
 * §9.1: no tool signature accepts an identity, so there is nothing for a prompt
 * to talk the model into supplying — and every data tool reads the *closure's*
 * user id, not one the model could have named. The third is §2.1: a tool hands
 * the payload to the screen and a summary to the model, and the summary must
 * not contain the figures.
 */

const calendarForMock = vi.fn();

vi.mock("@/lib/calendar/view", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calendar/view")>()),
  calendarFor: (...a: unknown[]) => calendarForMock(...(a as [])),
}));

const { aheadTool, buildTools, calendarTool, findPageTool, stringArg } =
  await import("@/lib/assistant/tools");

type AssistantContext = import("@/lib/assistant/tools").AssistantContext;

const NOW = new Date("2026-09-03T09:00:00.000Z");
const context = {
  db: {} as Db,
  userId: "learner-1",
  now: NOW,
} satisfies AssistantContext;

function view(over: Partial<CalendarView> = {}): CalendarView {
  return {
    label: "September 2026",
    today: "2026-09-03",
    weeks: [
      [
        {
          day: "2026-09-01",
          inMonth: true,
          isToday: false,
          certainties: ["recorded"],
          items: [],
          description: "1 September: you worked",
        },
        {
          day: "2026-09-02",
          inMonth: true,
          isToday: false,
          certainties: [],
          items: [],
          description: null,
        },
      ],
    ],
    hasMarks: true,
    next: undefined,
    ahead: [],
    checkpoints: [],
    hasPath: true,
    deadline: null,
    ...over,
  } as unknown as CalendarView;
}

beforeEach(() => {
  vi.clearAllMocks();
  calendarForMock.mockResolvedValue(view());
});

describe("stringArg", () => {
  it("reads a string argument the model sent", () => {
    expect(stringArg({ topic: "billing" }, "topic")).toBe("billing");
  });

  it("treats anything else as absent", () => {
    for (const input of [null, "topic", 4, {}, { topic: 42 }, { topic: null }]) {
      expect(stringArg(input, "topic")).toBe("");
    }
  });
});

describe("find_page", () => {
  const tool = findPageTool();

  it("answers with the page, its path, and what it is for", async () => {
    const outcome = await tool.run({ topic: "cancel my subscription" });

    expect(outcome.forModel).toContain("/account/billing");
    expect(outcome.forModel).toContain("Billing");
    expect(outcome.forView).toBeNull();
  });

  it("tells the model to say nothing rather than guess", async () => {
    const outcome = await tool.run({ topic: "the offside rule" });
    expect(outcome.forModel).toContain("do not guess");
  });

  it("treats missing or malformed arguments as an empty question", async () => {
    for (const input of [{}, null, "topic", { topic: 42 }]) {
      const outcome = await tool.run(input);
      expect(outcome.forModel).toContain("do not guess");
    }
  });
});

describe("my_calendar", () => {
  it("puts the month on screen and tells the model only that it did", async () => {
    const outcome = await calendarTool(context).run({});

    expect(outcome.forView).toEqual({
      widget: "calendar_month",
      payload: {
        label: "September 2026",
        weeks: view().weeks,
        hasMarks: true,
        next: null,
      },
    });

    // §2.1 — the model gets a count and an instruction, never the dates.
    expect(outcome.forModel).toContain("September 2026");
    expect(outcome.forModel).toContain("1 day has");
    expect(outcome.forModel).toContain("Do not list the dates");
    expect(outcome.forModel).not.toContain("2026-09-01");
  });

  /** §9.1 — the closure's user id, never one the model could have named. */
  it("reads the signed-in learner, whatever the model sends", async () => {
    await calendarTool(context).run({ userId: "someone-else", month: "2026-11" });

    expect(calendarForMock).toHaveBeenCalledWith({}, "learner-1", NOW, {
      month: "2026-11",
    });
  });

  it("asks for the month they are in when none is given", async () => {
    await calendarTool(context).run({});
    expect(calendarForMock).toHaveBeenCalledWith({}, "learner-1", NOW, {
      month: undefined,
    });
  });

  it("says there is no calendar rather than showing an empty one", async () => {
    calendarForMock.mockResolvedValue(undefined);

    const outcome = await calendarTool(context).run({});

    expect(outcome.forView).toBeNull();
    expect(outcome.forModel).toContain("no course running");
  });

  it("counts a month with nothing on it honestly", async () => {
    calendarForMock.mockResolvedValue(
      view({
        weeks: [
          [
            {
              day: "2026-09-01",
              inMonth: true,
              isToday: false,
              certainties: [],
              items: [],
              description: null,
            },
          ],
        ],
        hasMarks: false,
      } as Partial<CalendarView>),
    );

    const outcome = await calendarTool(context).run({});
    expect(outcome.forModel).toContain("0 days have");
  });
});

describe("whats_next", () => {
  const entry = {
    day: "2026-09-05",
    kind: "retrieval" as const,
    certainty: "due" as const,
    title: "Window functions",
    detail: "Coming back round",
  };

  it("puts what is coming on screen and counts it for the model", async () => {
    calendarForMock.mockResolvedValue(view({ ahead: [entry] }));

    const outcome = await aheadTool(context).run({});

    expect(outcome.forView).toEqual({
      widget: "ahead_list",
      payload: {
        today: "2026-09-03",
        entries: [entry],
        hasCheckpoints: false,
      },
    });
    expect(outcome.forModel).toContain("1 thing is");
    expect(outcome.forModel).toContain("Do not list them");
    expect(outcome.forModel).not.toContain("Window functions");
  });

  it("counts what is overdue separately, because that is the actionable part", async () => {
    calendarForMock.mockResolvedValue(
      view({ ahead: [{ ...entry, day: "2026-09-01" }, entry] }),
    );

    const outcome = await aheadTool(context).run({});
    expect(outcome.forModel).toContain("1 overdue");
  });

  it("says nothing is due, and lets the view say why", async () => {
    calendarForMock.mockResolvedValue(view({ ahead: [] }));

    const outcome = await aheadTool(context).run({});
    expect(outcome.forModel).toContain("Nothing is due");
  });

  it("passes on whether there are checkpoints, so the empty state can differ", async () => {
    calendarForMock.mockResolvedValue(
      view({
        ahead: [],
        checkpoints: [
          {
            title: "Hand-in",
            day: "2026-10-01",
            dayAtActualPace: null,
            hoursAway: 6,
            graded: true,
          },
        ],
      }),
    );

    const outcome = await aheadTool(context).run({});
    expect(outcome.forView).toMatchObject({
      payload: { hasCheckpoints: true },
    });
  });

  it("says there is nothing ahead when no course is running", async () => {
    calendarForMock.mockResolvedValue(undefined);

    const outcome = await aheadTool(context).run({});
    expect(outcome.forView).toBeNull();
    expect(outcome.forModel).toContain("no course running");
  });
});

describe("buildTools", () => {
  it("registers every lookup, each with a name the model can call", () => {
    const tools = buildTools(context);

    expect(tools.map((tool) => tool.name)).toEqual([
      "find_page",
      "my_calendar",
      "whats_next",
    ]);
    for (const tool of tools) {
      expect(tool.description).not.toBe("");
      expect(tool.label).not.toBe("");
      expect(tool.inputSchema).toHaveProperty("type", "object");
    }
  });

  /** §9.1 — the model picks which tool, never whose data. */
  it("gives no tool an argument that names a learner", () => {
    for (const tool of buildTools(context)) {
      const schema = tool.inputSchema as {
        properties: Record<string, unknown>;
        additionalProperties: boolean;
      };

      expect(Object.keys(schema.properties)).not.toContain("userId");
      expect(Object.keys(schema.properties)).not.toContain("user");
      // Anything the model invents beyond the declared arguments is rejected
      // at the schema rather than reaching a query.
      expect(schema.additionalProperties).toBe(false);
    }
  });

  /** The list renders ahead of the cached prefix, so its shape must not vary. */
  it("builds the same list for every learner", () => {
    expect(buildTools(context).map((tool) => tool.name)).toEqual(
      buildTools({ ...context, userId: "someone-else" }).map((tool) => tool.name),
    );
  });
});
