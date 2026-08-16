// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WidgetView } from "@/lib/assistant/widgets";

const pathnameMock = vi.fn(() => "/today");

vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

const {
  appendText,
  applyFrame,
  AssistantPanel,
  hiddenOn,
  parseFrame,
  readWidget,
  takeLines,
} = await import("@/components/assistant-panel");

type Segment = import("@/components/assistant-panel").Segment;

/**
 * The panel.
 *
 * Two thirds of this file is about the wire, because that is where the bugs
 * are. The tutor's panel could append every chunk it received; this one has to
 * reassemble objects out of a byte stream that splits wherever it likes, and a
 * thread that fills with `{"t":"te` is the failure nobody catches in review.
 */

afterEach(cleanup);

describe("takeLines", () => {
  it("keeps a half-arrived object back until the rest of it lands", () => {
    const first = takeLines('{"t":"text","v":"one"}\n{"t":"te');
    expect(first.lines).toEqual(['{"t":"text","v":"one"}']);
    expect(first.rest).toBe('{"t":"te');

    const second = takeLines(`${first.rest}xt","v":"two"}\n`);
    expect(second.lines).toEqual(['{"t":"text","v":"two"}']);
    expect(second.rest).toBe("");
  });

  it("returns nothing complete from a chunk with no newline in it", () => {
    expect(takeLines('{"t":').lines).toEqual([]);
  });
});

describe("parseFrame", () => {
  it("reads each kind of frame", () => {
    expect(parseFrame('{"t":"text","v":"hi"}')).toEqual({ t: "text", v: "hi" });
    expect(parseFrame('{"t":"tool","label":"Checking…"}')).toEqual({
      t: "tool",
      label: "Checking…",
    });
    expect(parseFrame('{"t":"done"}')).toEqual({ t: "done" });
    expect(parseFrame('{"t":"error","message":"broke"}')).toEqual({
      t: "error",
      message: "broke",
    });
  });

  /**
   * Three ways to be unreadable, all meaning the same thing to a reader. The
   * last is the deliberate one: a later route may send frames this panel
   * predates, and dropping them keeps a deploy skew a missing view rather than
   * a crashed thread.
   */
  it("drops anything it cannot read, including a frame it has never heard of", () => {
    expect(parseFrame("")).toBeNull();
    expect(parseFrame("   ")).toBeNull();
    expect(parseFrame("{not json")).toBeNull();
    expect(parseFrame("null")).toBeNull();
    expect(parseFrame('"a string"')).toBeNull();
    expect(parseFrame('{"t":"widget","name":"calendar_month"}')).toBeNull();
    expect(parseFrame('{"t":"text"}')).toBeNull();
    expect(parseFrame('{"t":"tool"}')).toBeNull();
    expect(parseFrame('{"t":"error"}')).toBeNull();
  });
});

const CALENDAR: WidgetView = {
  widget: "calendar_month",
  payload: {
    label: "September 2026",
    weeks: [
      Array.from({ length: 7 }, (_, i) => ({
        day: `2026-09-0${i + 1}`,
        inMonth: true,
        isToday: false,
        certainties: i === 2 ? (["recorded"] as const).slice() : [],
        items: [],
        description: i === 2 ? "3 September: you worked" : null,
      })),
    ],
    hasMarks: true,
    next: null,
  },
};

const AHEAD: WidgetView = {
  widget: "ahead_list",
  payload: {
    today: "2026-09-03",
    entries: [
      {
        day: "2026-09-05",
        kind: "retrieval",
        certainty: "due",
        title: "Window functions",
        detail: "Coming back round",
      },
    ],
    hasCheckpoints: false,
  },
};

const DIGEST_PAYLOAD = {
  digest: {
    hoursLogged: 3.5,
    committedHours: 4,
    keptCommitment: false,
    sessions: 2,
    moved: [{ name: "Window functions", delta: 0.2 }],
    artefacts: 1,
    remainingHours: 20,
    weeksAtCommitment: 5,
    weeksAtActualPace: 6,
    tracked: 4,
    slipping: 1,
  },
};

/** The prose/view text of one turn, in order, for readable assertions. */
function shape(turn: { segments: Segment[] }): string[] {
  return turn.segments.map((segment) =>
    segment.kind === "text" ? segment.text : `[${segment.view.widget}]`,
  );
}

describe("appendText", () => {
  it("extends the passage in flight", () => {
    expect(appendText([{ kind: "text", text: "Bil" }], "ling.")).toEqual([
      { kind: "text", text: "Billing." },
    ]);
  });

  it("opens a new passage after a view", () => {
    expect(appendText([{ kind: "view", view: CALENDAR }], "There it is.")).toEqual(
      [{ kind: "view", view: CALENDAR }, { kind: "text", text: "There it is." }],
    );
  });

  it("opens the first passage of a turn", () => {
    expect(appendText([], "hi")).toEqual([{ kind: "text", text: "hi" }]);
  });
});

describe("applyFrame", () => {
  const thread = [
    { role: "user" as const, segments: [{ kind: "text" as const, text: "where?" }] },
    { role: "assistant" as const, segments: [] },
  ];

  it("appends prose to the turn in flight", () => {
    const after = applyFrame(applyFrame(thread, { t: "text", v: "Bil" }), {
      t: "text",
      v: "ling.",
    });
    expect(shape(after[1]!)).toEqual(["Billing."]);
  });

  it("shows what a tool is doing, then clears it when prose resumes", () => {
    const running = applyFrame(thread, { t: "tool", label: "Checking…" });
    expect(running[1]!.note).toBe("Checking…");

    // Leaving it up would report work that has already happened.
    const answered = applyFrame(running, { t: "text", v: "Billing." });
    expect(answered[1]!.note).toBeUndefined();
  });

  it("clears the label when the turn finishes without more prose", () => {
    const running = applyFrame(thread, { t: "tool", label: "Checking…" });
    expect(applyFrame(running, { t: "done" })[1]!.note).toBeUndefined();
  });

  /**
   * Arrival order, which is the whole reason a turn is segments. The tool runs
   * *before* the sentence that introduces its result, so appending views would
   * put every calendar underneath the words explaining it.
   */
  it("keeps prose and views in the order they arrived", () => {
    let turns = applyFrame(thread, { t: "text", v: "Let me look." });
    turns = applyFrame(turns, { t: "tool", label: "Checking…" });
    turns = applyFrame(turns, { t: "widget", view: CALENDAR });
    turns = applyFrame(turns, { t: "text", v: "The 3rd is done." });

    expect(shape(turns[1]!)).toEqual([
      "Let me look.",
      "[calendar_month]",
      "The 3rd is done.",
    ]);
    expect(turns[1]!.note).toBeUndefined();
  });

  it("puts an error where the answer would have been", () => {
    const broken = applyFrame(thread, { t: "error", message: "It broke." });
    expect(shape(broken[1]!)).toEqual(["It broke."]);
  });

  it("keeps the half-answer it already gave, and separates it", () => {
    const partial = applyFrame(thread, { t: "text", v: "Half a sen" });
    const broken = applyFrame(partial, { t: "error", message: "It broke." });
    expect(shape(broken[1]!)).toEqual(["Half a sen\n\nIt broke."]);
  });

  it("has nothing to append to before a turn is opened", () => {
    expect(applyFrame([], { t: "text", v: "hi" })).toEqual([]);
  });
});

describe("readWidget", () => {
  it("accepts the payloads its components can render", () => {
    expect(readWidget("calendar_month", CALENDAR.payload)).toEqual(CALENDAR);
    expect(readWidget("ahead_list", AHEAD.payload)).toEqual(AHEAD);
  });

  /**
   * A route a deploy ahead can send a widget this build has no component for,
   * or the same widget missing a field this build's component indexes into.
   * Both must be a missing view rather than a crashed thread.
   */
  it("drops a widget this build cannot render", () => {
    // `path_outline` is a real widget this build simply does not have yet —
    // which is exactly the deploy-skew case: a route one release ahead sends a
    // view whose component has not shipped here.
    expect(readWidget("path_outline", { sections: [] })).toBeNull();
    expect(readWidget("charges", { rows: [] })).toBeNull();
    expect(readWidget("calendar_month", null)).toBeNull();
    expect(readWidget("calendar_month", "september")).toBeNull();
  });

  it("accepts the three later widgets too", () => {
    expect(readWidget("week_digest", DIGEST_PAYLOAD)).toEqual({
      widget: "week_digest",
      payload: DIGEST_PAYLOAD,
    });
    expect(readWidget("course_list", { courses: [] })).toEqual({
      widget: "course_list",
      payload: { courses: [] },
    });
    expect(readWidget("plan_card", { planId: "pro", renewsOn: null })).toEqual({
      widget: "plan_card",
      payload: { planId: "pro", renewsOn: null },
    });
  });

  /**
   * A plan id is checked against the catalogue rather than for "a string": an
   * unknown one indexes `PLAN_COPY` to undefined and takes the thread down at
   * the first property read, which is the crash this guard exists to prevent.
   */
  it("drops a plan the catalogue does not have", () => {
    expect(readWidget("plan_card", { planId: "enterprise" })).toBeNull();
    expect(readWidget("plan_card", { planId: 4 })).toBeNull();
    expect(readWidget("plan_card", {})).toBeNull();
  });

  it("drops a payload missing what its component reads", () => {
    expect(readWidget("week_digest", { digest: null })).toBeNull();
    expect(readWidget("week_digest", { digest: "a good week" })).toBeNull();
    expect(readWidget("week_digest", { digest: {} })).toBeNull();
    expect(readWidget("week_digest", {})).toBeNull();
    expect(readWidget("course_list", { courses: "none" })).toBeNull();
    expect(readWidget("course_list", {})).toBeNull();
    expect(readWidget("calendar_month", { weeks: [], hasMarks: true })).toBeNull();
    expect(
      readWidget("calendar_month", { label: "Sep", hasMarks: true }),
    ).toBeNull();
    expect(readWidget("calendar_month", { label: "Sep", weeks: [] })).toBeNull();
    expect(readWidget("ahead_list", { entries: [], hasCheckpoints: false })).toBeNull();
    expect(readWidget("ahead_list", { today: "2026-09-03", hasCheckpoints: false })).toBeNull();
    expect(readWidget("ahead_list", { today: "2026-09-03", entries: [] })).toBeNull();
  });
});

/** One NDJSON body, delivered in chunks the caller chooses. */
function streaming(...chunks: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: {
      getReader() {
        const queue = [...chunks];
        return {
          async read() {
            const next = queue.shift();
            return next === undefined
              ? { done: true, value: undefined }
              : { done: false, value: encoder.encode(next) };
          },
        };
      },
    },
  };
}

describe("hiddenOn", () => {
  /**
   * The session already has the tutor, and the tutor is the one that can
   * teach. Two launchers make a stuck learner choose between them at the moment
   * they are least able to.
   */
  it("stands down on the screen that already has a chat", () => {
    expect(hiddenOn("/session/abc-123")).toBe(true);
    expect(hiddenOn("/session")).toBe(true);
  });

  it("is present everywhere else, including screens that merely start with the word", () => {
    for (const path of ["/today", "/progress", "/account/billing", "/sessions"]) {
      expect(hiddenOn(path)).toBe(false);
    }
  });
});

describe("AssistantPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pathnameMock.mockReturnValue("/today");
  });

  it("renders nothing at all inside a session", () => {
    pathnameMock.mockReturnValue("/session/abc-123");
    render(<AssistantPanel />);

    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  });

  it("shows nothing but the button until it is opened", () => {
    render(<AssistantPanel />);

    expect(screen.getByRole("button", { name: "Ask" })).toBeDefined();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("opens and closes, and hands focus back to the button", () => {
    render(<AssistantPanel />);
    const launcher = screen.getByRole("button", { name: "Ask" });

    fireEvent.click(launcher);
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeDefined();
    expect(launcher.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    // Focus lost at the top of the document makes the next Tab start from the
    // beginning of the page.
    expect(document.activeElement).toBe(launcher);
  });

  it("closes on Escape", () => {
    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("ignores other keys", () => {
    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByRole("complementary")).toBeDefined();
  });

  it("says what it is for, and what it cannot do, before anything is asked", () => {
    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(screen.getByText(/can&rsquo;t change them|can’t change them/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Show me my calendar" })).toBeDefined();
  });

  /**
   * A model writes markdown whether or not anything asked it to, and this
   * thread was printing the characters. The renderer is the session screen's,
   * not a second one — so the assertion is that the marks are *gone* from the
   * text and the structure arrived instead.
   */
  it("renders the markdown a model writes, rather than printing it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        `${JSON.stringify({
          t: "text",
          v: "**Two things** are due:\n\n- Window functions\n- A hand-in\n\nRun `pnpm start` first.",
        })}\n{"t":"done"}\n`,
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What should I do next?" }));

    await waitFor(() => expect(screen.getByText("Two things")).toBeDefined());

    // The marks themselves never reach the learner.
    expect(screen.queryByText(/\*\*Two things\*\*/)).toBeNull();
    expect(screen.getByText("Window functions")).toBeDefined();
    expect(screen.getByText("pnpm start")).toBeDefined();
  });

  /** The learner's own words are not model output — running them through a
      markdown renderer would restyle their question back at them. */
  it("leaves what the learner typed exactly as they typed it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming('{"t":"text","v":"ok"}\n{"t":"done"}\n') as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const input = screen.getByLabelText("Ask the assistant") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "what does **this** mean?" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("ok")).toBeDefined());
    expect(screen.getByText("what does **this** mean?")).toBeDefined();
  });

  it("streams an answer, reassembling objects split across chunks", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        streaming(
          '{"t":"tool","label":"Looking that up…"}\n{"t":"te',
          'xt","v":"Billing does that."}\n{"t":"done"}\n',
        ) as unknown as Response,
      );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What should I do next?" }));

    await waitFor(() =>
      expect(screen.getByText("Billing does that.")).toBeDefined(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/assistant", expect.anything());
    expect(screen.getByText("What should I do next?")).toBeDefined();
  });

  /** A line this version cannot read is dropped, and the rest of the answer
      still arrives — a deploy skew is a missing view, not a dead thread. */
  it("steps over a line it cannot read", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        '{"t":"widget","name":"calendar_month"}\n{not json\n{"t":"text","v":"Billing."}\n{"t":"done"}\n',
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me my calendar" }));

    await waitFor(() => expect(screen.getByText("Billing.")).toBeDefined());
  });

  /**
   * The point of the whole feature: a learner asks for their calendar and gets
   * the calendar, drawn by the same component `/progress` draws, with the
   * model's sentence around it rather than instead of it.
   */
  it("renders a calendar in the thread, between the prose around it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        `{"t":"tool","label":"Checking your calendar…"}\n${JSON.stringify({
          t: "widget",
          name: CALENDAR.widget,
          payload: CALENDAR.payload,
        })}\n{"t":"text","v":"The 3rd is the one you worked."}\n{"t":"done"}\n`,
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me my calendar" }));

    await waitFor(() =>
      expect(screen.getByText("The 3rd is the one you worked.")).toBeDefined(),
    );

    // The grid itself — the legend is CalendarMonth's, not the panel's.
    expect(screen.getByText("You worked")).toBeDefined();
    expect(screen.getByText("3 September: you worked")).toBeDefined();
    // And the label it replaced is gone.
    expect(screen.queryByText("Checking your calendar…")).toBeNull();
  });

  it("renders what is ahead when that is what was asked for", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        `${JSON.stringify({
          t: "widget",
          name: AHEAD.widget,
          payload: AHEAD.payload,
        })}\n{"t":"done"}\n`,
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What should I do next?" }));

    await waitFor(() => expect(screen.getByText("Window functions")).toBeDefined());
  });

  /**
   * The inert rule (§6.1) at the surface a learner actually touches. Two of the
   * three course actions are hard to walk back, and a thread whose whole
   * premise is that it only reads must not be a fourth place to press them.
   */
  it("renders the course list without the buttons that change a course", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        `${JSON.stringify({
          t: "widget",
          name: "course_list",
          payload: {
            courses: [
              {
                goalId: "g1",
                name: "SQL for data analysis",
                taxonomyParent: null,
                status: "active",
              },
            ],
          },
        })}\n{"t":"done"}\n`,
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What should I do next?" }));

    await waitFor(() =>
      expect(screen.getByText("SQL for data analysis")).toBeDefined(),
    );
    expect(screen.queryByRole("button", { name: "Put aside" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop it" })).toBeNull();
  });

  it("renders the plan, ending at a link rather than a control", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        `${JSON.stringify({
          t: "widget",
          name: "plan_card",
          payload: { planId: "pro", renewsOn: "2026-10-01" },
        })}\n{"t":"done"}\n`,
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What am I paying?" }));

    await waitFor(() =>
      expect(screen.getByText("Renews 1 October 2026")).toBeDefined(),
    );
    expect(
      screen.getByRole("link", { name: /Change or cancel it/ }).getAttribute("href"),
    ).toBe("/account/billing");
  });

  it("renders the week's digest", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        `${JSON.stringify({
          t: "widget",
          name: "week_digest",
          payload: DIGEST_PAYLOAD,
        })}\n{"t":"done"}\n`,
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What should I do next?" }));

    await waitFor(() => expect(screen.getByText("What changed")).toBeDefined());
    expect(screen.getByText("Window functions")).toBeDefined();
  });

  it("drops a widget it cannot render and keeps the answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        '{"t":"widget","name":"path_outline","payload":{"sections":[]}}\n{"t":"text","v":"You are on Pro."}\n{"t":"done"}\n',
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What am I paying?" }));

    await waitFor(() => expect(screen.getByText("You are on Pro.")).toBeDefined());
  });

  it("asks what was typed, and clears the box", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming('{"t":"text","v":"On the free plan."}\n{"t":"done"}\n') as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const input = screen.getByLabelText("Ask the assistant") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "what am I paying?" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("On the free plan.")).toBeDefined());
    expect(input.value).toBe("");
  });

  it("ignores an empty question", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const input = screen.getByLabelText("Ask the assistant") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** A failed request must not leave an empty bubble looking like it is still
      thinking. */
  it("says why it could not answer, in the turn it could not answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      body: null,
      text: async () => "That is everything the assistant answers in a day.",
    } as unknown as Response);

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What am I paying?" }));

    await waitFor(() =>
      expect(
        screen.getByText(/everything the assistant answers in a day/),
      ).toBeDefined(),
    );
  });

  it("survives a fetch that rejects with something that is not an error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("nope");

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What am I paying?" }));

    await waitFor(() =>
      expect(screen.getByText(/Couldn't reach the assistant\./)).toBeDefined(),
    );
  });

  it("shows the tool's label while it waits, and no prose yet", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming('{"t":"tool","label":"Checking your calendar…"}\n') as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me my calendar" }));

    await waitFor(() =>
      expect(screen.getByText("Checking your calendar…")).toBeDefined(),
    );
  });

  it("keeps a label visible beside prose that has already arrived", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streaming(
        '{"t":"text","v":"One moment."}\n{"t":"tool","label":"Checking…"}\n',
      ) as unknown as Response,
    );

    render(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "What should I do next?" }));

    await waitFor(() => expect(screen.getByText("Checking…")).toBeDefined());
    expect(screen.getByText(/One moment\./)).toBeDefined();
  });
});
