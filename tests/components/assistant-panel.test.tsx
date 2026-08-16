// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  applyFrame,
  AssistantPanel,
  parseFrame,
  takeLines,
} from "@/components/assistant-panel";

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

describe("applyFrame", () => {
  const thread = [
    { role: "user" as const, content: "where?" },
    { role: "assistant" as const, content: "" },
  ];

  it("appends prose to the turn in flight", () => {
    const after = applyFrame(applyFrame(thread, { t: "text", v: "Bil" }), {
      t: "text",
      v: "ling.",
    });
    expect(after[1]!.content).toBe("Billing.");
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

  it("puts an error where the answer would have been", () => {
    const broken = applyFrame(thread, { t: "error", message: "It broke." });
    expect(broken[1]!.content).toBe("It broke.");
  });

  it("keeps the half-answer it already gave, and separates it", () => {
    const partial = applyFrame(thread, { t: "text", v: "Half a sen" });
    const broken = applyFrame(partial, { t: "error", message: "It broke." });
    expect(broken[1]!.content).toBe("Half a sen\n\nIt broke.");
  });

  it("has nothing to append to before a turn is opened", () => {
    expect(applyFrame([], { t: "text", v: "hi" })).toEqual([]);
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

describe("AssistantPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
