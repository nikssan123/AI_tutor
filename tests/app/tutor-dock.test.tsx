// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { appendToLast, exchanges, TutorDock } from "@/app/(app)/session/[id]/tutor-dock";

/**
 * The one client component in the signed-in product.
 *
 * Everything else in a session is a form POST that works with scripting off,
 * so what is tested here is narrow: that a stream reaches the screen as it
 * arrives, and that a failure leaves a message rather than an empty bubble
 * looking like the tutor is still thinking.
 */

function streamOf(chunks: string[]): Response {
  return {
    ok: true,
    body: {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: new TextEncoder().encode(chunks[i++]!) };
          },
        };
      },
    },
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(streamOf(["Because ", "of the grain."]));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the tutor panel", () => {
  /**
   * The dock arrives closed, even holding a transcript.
   *
   * Somebody returning to a session came back to the lesson, not to what they
   * asked about it yesterday — opening over the top of it would be the dock
   * taking the screen for itself before being asked to.
   */
  it("keeps a transcript it was handed out of the way until asked for", async () => {
    render(
      <TutorDock
        sessionId="s1"
        turnsTaken={0}
        turnLimit={30}
        initialTurns={[
          { role: "user", content: "why?" },
          { role: "assistant", content: "because" },
        ]}
      />,
    );

    expect(screen.queryByText("why?")).toBeNull();

    // Reaching for the box *is* the intent to use the tutor. There is no
    // second control to press: a learner who wants to ask something and a
    // learner who wants to reread the answer both start here.
    fireEvent.focus(screen.getByLabelText("Ask the tutor"));

    await waitFor(() => expect(screen.getByText("why?")).toBeDefined());
    expect(screen.getByText("because")).toBeDefined();
  });

  /**
   * The two one-click asks are for somebody already stuck, and they are the
   * whole reason the resting dock would otherwise be twice as tall.
   */
  it("keeps the named asks out of the resting bar", () => {
    render(<TutorDock sessionId="s1" initialTurns={[]} turnsTaken={0} turnLimit={30} />);

    const chips = screen.getByRole("button", { name: /don.t understand/i });
    expect(chips.parentElement?.className).toContain("hidden");

    fireEvent.focus(screen.getByLabelText("Ask the tutor"));
    expect(chips.parentElement?.className).not.toContain("hidden");
  });

  /**
   * The two ways back out of an open dock.
   *
   * It covers the lesson while it is open, so it has to be dismissible without
   * aiming at a target — and Escape is the one that has to work when the cursor
   * has already gone back to the paragraph underneath.
   */
  it.each([
    ["the Hide button", () => screen.getByRole("button", { name: "Hide" }).click()],
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
  ])("closes on %s", async (_name, dismiss) => {
    render(
      <TutorDock
        sessionId="s1"
        turnsTaken={0}
        turnLimit={30}
        initialTurns={[{ role: "assistant", content: "because" }]}
      />,
    );

    fireEvent.focus(screen.getByLabelText("Ask the tutor"));
    await waitFor(() => expect(screen.getByText("because")).toBeDefined());

    dismiss();

    await waitFor(() => expect(screen.queryByText("because")).toBeNull());
  });

  /** Every other key is somebody typing, including into the box below it. */
  it("stays open on any other key", async () => {
    render(
      <TutorDock
        sessionId="s1"
        turnsTaken={0}
        turnLimit={30}
        initialTurns={[{ role: "assistant", content: "because" }]}
      />,
    );

    fireEvent.focus(screen.getByLabelText("Ask the tutor"));
    await waitFor(() => expect(screen.getByText("because")).toBeDefined());

    fireEvent.keyDown(document, { key: "a" });

    expect(screen.getByText("because")).toBeDefined();
  });

  it("streams an answer into the page", async () => {
    render(<TutorDock sessionId="s1" initialTurns={[]} turnsTaken={0} turnLimit={30} />);

    const input = screen.getByLabelText("Ask the tutor") as HTMLInputElement;
    input.value = "why?";
    screen.getByRole("button", { name: "Ask" }).click();

    await waitFor(() =>
      expect(screen.getByText("Because of the grain.")).toBeDefined(),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends §8 screen 7's two named asks with one click each", async () => {
    render(<TutorDock sessionId="s1" initialTurns={[]} turnsTaken={0} turnLimit={30} />);

    screen.getByRole("button", { name: /don.t understand/i }).click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as { body: string }).body,
    ) as { message: string };
    expect(body.message).toContain("different way");

    cleanup();
    fetchMock.mockClear();
    render(<TutorDock sessionId="s1" initialTurns={[]} turnsTaken={0} turnLimit={30} />);
    screen.getByRole("button", { name: /too easy/i }).click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(
      JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body).message,
    ).toContain("harder version");
  });

  it("says the request failed rather than leaving an empty bubble", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      text: async () => "the tutor is down",
    } as unknown as Response);

    render(<TutorDock sessionId="s1" initialTurns={[]} turnsTaken={0} turnLimit={30} />);
    const input = screen.getByLabelText("Ask the tutor") as HTMLInputElement;
    input.value = "why?";
    screen.getByRole("button", { name: "Ask" }).click();

    await waitFor(() =>
      expect(screen.getByText(/the tutor is down/)).toBeDefined(),
    );
  });

  it("reports a non-Error failure", async () => {
    fetchMock.mockRejectedValue("just a string");

    render(<TutorDock sessionId="s1" initialTurns={[]} turnsTaken={0} turnLimit={30} />);
    const input = screen.getByLabelText("Ask the tutor") as HTMLInputElement;
    input.value = "why?";
    screen.getByRole("button", { name: "Ask" }).click();

    await waitFor(() =>
      expect(screen.getByText(/unknown error/)).toBeDefined(),
    );
  });

  it("shows the answer as pending before the first chunk arrives", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });

    fetchMock.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          async read() {
            await gate;
            return { done: true, value: undefined };
          },
        }),
      },
    } as unknown as Response);

    render(<TutorDock sessionId="s1" initialTurns={[]} turnsTaken={0} turnLimit={30} />);
    const input = screen.getByLabelText("Ask the tutor") as HTMLInputElement;
    input.value = "why?";
    screen.getByRole("button", { name: "Ask" }).click();

    // An empty bubble with nothing in it reads as a broken page; it says what
    // it is doing until the first token lands.
    await waitFor(() => expect(screen.getByText("Thinking…")).toBeDefined());
    release();
  });

  it("ignores an empty question", () => {
    render(<TutorDock sessionId="s1" initialTurns={[]} turnsTaken={0} turnLimit={30} />);
    screen.getByRole("button", { name: "Ask" }).click();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * A transcript is read in exchanges, not turns.
 *
 * A turn-per-row list gave a question and its answer the same standing and the
 * same gap as the gap to the next question, so a conversation of three read as
 * six unrelated blocks. Pairing them is what lets a rule between exchanges mean
 * anything.
 */
describe("exchanges", () => {
  it("pairs each question with the answer that followed it", () => {
    expect(
      exchanges([
        { role: "user", content: "why?" },
        { role: "assistant", content: "because" },
        { role: "user", content: "and?" },
        { role: "assistant", content: "so" },
      ]),
    ).toEqual([
      { question: "why?", answer: "because" },
      { question: "and?", answer: "so" },
    ]);
  });

  /** `transcriptFor` stops at `TRANSCRIPT_DEPTH`, so a long conversation can
   *  arrive already cut — and the cut can land on an answer. */
  it("keeps an answer whose question was cut off the top", () => {
    expect(exchanges([{ role: "assistant", content: "because" }])).toEqual([
      { answer: "because" },
    ]);
  });

  /** The route writes them alternately, so this cannot happen — but a second
   *  answer must start its own pair rather than overwrite the first. */
  it("does not let a second answer overwrite the first", () => {
    expect(
      exchanges([
        { role: "user", content: "why?" },
        { role: "assistant", content: "because" },
        { role: "assistant", content: "also" },
      ]),
    ).toEqual([
      { question: "why?", answer: "because" },
      { answer: "also" },
    ]);
  });

  it("rules between exchanges and not above the first", () => {
    render(
      <TutorDock
        sessionId="s1"
        turnsTaken={0}
        turnLimit={30}
        initialTurns={[
          { role: "user", content: "why?" },
          { role: "assistant", content: "because" },
          { role: "user", content: "and?" },
          { role: "assistant", content: "so" },
        ]}
      />,
    );

    fireEvent.focus(screen.getByLabelText("Ask the tutor"));

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.className).not.toContain("border-t");
    expect(rows[1]!.className).toContain("border-t");
  });
});

describe("appendToLast", () => {
  it("grows the turn in flight", () => {
    expect(
      appendToLast([{ role: "assistant", content: "Be" }], "cause"),
    ).toEqual([{ role: "assistant", content: "Because" }]);
  });

  it("has nothing to append to on an empty transcript", () => {
    expect(appendToLast([], "x")).toEqual([]);
  });
});

describe("§14.9.7 limit 4 — the warning, then the stop", () => {
  const panel = (turnsTaken: number, turnLimit = 15) => (
    <TutorDock
      sessionId="s1"
      initialTurns={[]}
      turnsTaken={turnsTaken}
      turnLimit={turnLimit}
    />
  );

  it("says nothing while there is plenty left", () => {
    render(panel(5));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns at five to go, and not at six", () => {
    // §14.9.7 writes it as "soft warning at 25" of 30 — five to go — and the
    // margin is expressed as the remainder so it lands in the same place on a
    // free learner's fifteen.
    const { unmount } = render(panel(9));
    expect(screen.queryByRole("status")).toBeNull();
    unmount();

    render(panel(10));
    expect(screen.getByRole("status").textContent).toMatch(/5 questions left/);
  });

  it("counts down, and says one in words rather than as a digit", () => {
    render(panel(14));
    expect(screen.getByRole("status").textContent).toMatch(/One question left/);
  });

  it("stops at the limit and says the next session starts fresh", () => {
    render(panel(15));

    expect(screen.getByRole("status").textContent).toMatch(
      /this session.s questions/,
    );
    expect(
      (screen.getByLabelText("Ask the tutor") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables the two shortcuts too", () => {
    // Otherwise "I don't understand" is a button that looks live and produces a
    // 409 the learner never asked to see.
    render(panel(15));

    for (const name of ["I don’t understand", "Too easy"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });

  it("never goes below nothing left", () => {
    // A plan downgrade mid-session can leave somebody past their new ceiling.
    render(panel(40, 15));
    expect(screen.getByRole("status").textContent).toMatch(
      /this session.s questions/,
    );
  });

  it("holds the warning back when the screen is already asking for money", () => {
    // "You are running out" and "please pay" arriving together is what turns a
    // limit into a grievance.
    render(
      <TutorDock
        sessionId="s1"
        initialTurns={[]}
        turnsTaken={12}
        turnLimit={15}
        quiet
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never holds the stop back, however crowded the screen", () => {
    // A disabled box with no explanation is worse than any amount of crowding.
    render(
      <TutorDock
        sessionId="s1"
        initialTurns={[]}
        turnsTaken={15}
        turnLimit={15}
        quiet
      />,
    );

    expect(screen.getByRole("status").textContent).toMatch(
      /this session.s questions/,
    );
  });

  it("warns a paid learner at the same distance from a bigger number", () => {
    render(panel(25, 30));
    expect(screen.getByRole("status").textContent).toMatch(/5 questions left/);
  });

  it("counts a question the moment it is sent, not when it is answered", async () => {
    // A question that failed still reached the route and still counted there,
    // so decrementing on error would drift the panel above the truth and let
    // somebody past a stop the server will enforce anyway.
    fetchMock.mockResolvedValue({
      ok: false,
      body: null,
      text: async () => "nope",
    } as unknown as Response);

    render(panel(13));
    screen.getByRole("button", { name: /don.t understand/i }).click();

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(
        /One question left/,
      ),
    );
  });
});
