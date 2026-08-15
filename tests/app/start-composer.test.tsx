// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { OUTCOME_SEPARATOR } from "@/lib/goals/intake-protocol";

/**
 * The answer box, and everything that happens in the seconds after you use it.
 *
 * A turn calls a model, so it takes seconds — with no feedback the screen read
 * as frozen, which is how a chip got tapped three times and three turns were
 * recorded. So the send is echoed and the wait is named.
 *
 * What the wait must not do is end in two places. The reply used to be painted
 * as it streamed, which put a finished question on screen while the box under
 * it was still locked — the screen asked and then refused to be answered. The
 * question and the box now arrive in the same render, and the tests below hold
 * that line: nothing of the answer is shown until the page has caught up.
 *
 * The property that has to survive all of it: these are still real forms
 * pointed at the same Server Actions, so the screen works with scripting off.
 */
const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const { Composer } = await import("@/app/(app)/start/composer");

const reply = vi.fn(async () => undefined);
const restart = vi.fn(async () => undefined);

// jsdom has no layout, so scrolling is stubbed rather than exercised.
const scrollTo = vi.fn();
vi.stubGlobal("scrollTo", scrollTo);

/** A response whose body arrives in pieces, like the real one. */
function streaming(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function answers(...chunks: string[]) {
  const fetchMock = vi.fn(async () => streaming(...chunks));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * A response fed by hand, so a turn can be held open in the middle.
 *
 * The seconds this component exists for are the ones between "the model has
 * written the question" and "the turn is stored and rendered", and `streaming`
 * closes too fast to see them: it enqueues everything and closes before React
 * has rendered once.
 */
function held() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    { status: 200 },
  );
  vi.stubGlobal("fetch", vi.fn(async () => response));

  return {
    write: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

function draw(chips: string[] = ["1-2 hrs", "3-5 hrs"]) {
  return render(
    <Composer
      chips={chips}
      asked={2}
      maxTurns={6}
      reply={reply}
      restart={restart}
    />,
  );
}

/** The same bar on a plan that keeps one conversation — no way to discard it. */
function drawWithoutRestart() {
  return render(
    <Composer chips={[]} asked={2} maxTurns={6} reply={reply} />,
  );
}

const box = () => screen.getByLabelText("Your answer") as HTMLInputElement;
const send = () => screen.getByRole("button", { name: /send/i });
const submit = () => fireEvent.submit(box().closest("form")!);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Composer", () => {
  it("posts to the server action, so it works with no JavaScript", () => {
    // jsdom will not run a Server Action, but the wiring is the point: a real
    // <form> with the action on it still submits when the bundle never loads.
    const { container } = draw();
    expect(container.querySelectorAll("form")).toHaveLength(4);
    for (const form of container.querySelectorAll("form")) {
      expect(form.getAttribute("action")).not.toBe("");
    }
  });

  it("shows nothing extra until something is actually sent", () => {
    draw();
    expect(screen.queryByText("Thinking…")).toBeNull();
    expect(send()).not.toHaveProperty("disabled", true);
  });

  it("echoes what was typed the moment it is sent", async () => {
    answers("Got it.", `${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "get a dev job" } });
    submit();

    // Their message, immediately — not after the model has finished.
    expect(screen.getByText("get a dev job")).toBeDefined();
    expect(screen.getByText("Thinking…")).toBeDefined();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /**
   * The reported bug, and the whole reason the preview went.
   *
   * `reply` is the first field in the analyzer's tool schema, so it finishes
   * streaming while `captured`, `chips` and `done` are still being written —
   * and then the turn still has to be stored and the page re-rendered. Painting
   * it as it arrived meant a complete question sat on screen for those seconds
   * above a box that took nothing: the screen asked, then refused the answer.
   */
  it("shows nothing of the answer while the box is still shut", async () => {
    const stream = held();
    draw();
    fireEvent.change(box(), { target: { value: "beginner" } });
    submit();

    stream.write("How much time do you have?");
    // A tick, so anything that was going to draw that fragment has had its
    // chance to. Nothing is: the sentence is the server's to render.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("How much time do you have?")).toBeNull();
    // Still the thinking indicator, and the box still says why it is shut.
    expect(screen.getByText("Thinking…")).toBeDefined();
    expect(
      screen.getByText(/you can type again when the next question arrives/),
    ).toBeDefined();
    expect(box().readOnly).toBe(true);

    stream.write(`${OUTCOME_SEPARATOR}ok`);
    stream.close();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("never draws the raw stream, verdict byte and all", async () => {
    // The body is a sentence, a NUL, then how the turn ended. None of it is for
    // the screen — the client reads it for the verdict and refreshes.
    answers(`All set.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "yes" } });
    submit();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/All set/)).toBeNull();
    expect(document.body.textContent).not.toContain(OUTCOME_SEPARATOR);
  });

  it("sends the turn to the streaming endpoint", async () => {
    const fetchMock = answers(`Fine.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "get a dev job" } });
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/goal-intake");
    expect(JSON.parse(String(init.body))).toEqual({ reply: "get a dev job" });
  });

  it("refreshes at the end, so the server's turn replaces the echo", async () => {
    answers(`Done.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "yes" } });
    submit();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("lands on the error banner when the turn could not be completed", async () => {
    // Once bytes are flowing there is no status code left to say so with, so
    // the verdict rides in the body.
    answers(`Half a sen${OUTCOME_SEPARATOR}failed`);
    draw();
    fireEvent.change(box(), { target: { value: "yes" } });
    submit();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/start?error=analyzer"),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("hands the answer back when the request never left", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    draw();
    fireEvent.change(box(), { target: { value: "get a dev job" } });
    submit();

    await waitFor(() => expect(screen.getByText(/didn.t send/)).toBeDefined());
    // Nothing was stored, so pretending it was sent would be the lie.
    expect(box().value).toBe("get a dev job");
    expect(send()).not.toHaveProperty("disabled", true);
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * The request left and came back refused — a finished conversation (409) or
   * a signed-out session (401). Nothing was recorded, so it is handled exactly
   * like the request that never left: give the answer back rather than leave
   * it looking sent.
   */
  it("hands the answer back when the server refuses the turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("That conversation is finished.", { status: 409 })),
    );
    draw();
    fireEvent.change(box(), { target: { value: "get a dev job" } });
    submit();

    await waitFor(() => expect(screen.getByText(/didn.t send/)).toBeDefined());
    expect(box().value).toBe("get a dev job");
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * A 200 with nothing to read. There is no stream to consume, so treating it
   * as success would show an empty answer and then refresh over the top of it.
   */
  it("hands the answer back when a successful response has no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    draw();
    fireEvent.change(box(), { target: { value: "get a dev job" } });
    submit();

    await waitFor(() => expect(screen.getByText(/didn.t send/)).toBeDefined());
    expect(box().value).toBe("get a dev job");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("echoes a tapped chip, which is the answer that felt most broken", async () => {
    answers(`Noted.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.submit(
      screen.getByRole("button", { name: "3-5 hrs" }).closest("form")!,
    );

    // The bubble, not the chip that is still sitting in the bar.
    expect(screen.getAllByText("3-5 hrs").length).toBe(2);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("stops taking a second answer to a question already on its way", async () => {
    // Three turns were recorded from one tap, because a chip that gave no sign
    // of working got tapped again.
    answers(`Noted.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.submit(
      screen.getByRole("button", { name: "1-2 hrs" }).closest("form")!,
    );

    expect(send()).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "3-5 hrs" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Start over" })).toHaveProperty(
      "disabled",
      true,
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("keeps the typed answer submittable while it is in flight", async () => {
    // `readOnly`, never `disabled`: a disabled control is left out of the
    // FormData, so locking it that way would post the answer as an empty
    // string — the field is showing text it is no longer sending.
    answers(`Noted.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "get a dev job" } });
    submit();

    expect(box().readOnly).toBe(true);
    expect(box().disabled).toBe(false);
    expect(box().value).toBe("get a dev job");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("says it is sending on the button itself", async () => {
    answers(`Noted.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "anything" } });
    submit();
    expect(screen.getByRole("button", { name: /sending/i })).toBeDefined();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("announces the wait rather than only animating it", async () => {
    answers(`Noted.${OUTCOME_SEPARATOR}ok`);
    const { container } = draw();
    fireEvent.change(box(), { target: { value: "anything" } });
    submit();

    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    // The dots are decoration; the word is what gets read out.
    for (const dot of container.querySelectorAll(".animate-pulse")) {
      expect(dot.getAttribute("aria-hidden")).toBe("true");
      expect(dot.className).toContain("motion-reduce:animate-none");
    }
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("brings the echo into view instead of leaving it under the composer", async () => {
    // The composer is pinned over the end of the conversation, so an echo that
    // does not scroll itself into view is feedback nobody sees — which is no
    // better than the frozen screen it replaced.
    answers(`Noted.${OUTCOME_SEPARATOR}ok`);
    draw();
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.change(box(), { target: { value: "get a dev job" } });
    submit();

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: expect.any(Number) }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("points the locked box at the line that explains it", async () => {
    // Faintness is a style; a description is a state. A screen reader landing
    // on the box hears why it will not take anything.
    const stream = held();
    draw();
    fireEvent.change(box(), { target: { value: "beginner" } });
    submit();

    const described = box().getAttribute("aria-describedby")!;
    expect(document.getElementById(described)).not.toBeNull();
    expect(box().className).toContain("cursor-not-allowed");

    stream.write(`Noted.${OUTCOME_SEPARATOR}ok`);
    stream.close();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("says the page is catching up once the model has stopped writing", async () => {
    // A different wait with a different sentence: the turn is stored by now,
    // but the next question is not on screen and the box is still shut. The
    // sentence changing is the only thing left that shows the wait is moving.
    answers(`All set.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "yes" } });
    submit();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByText(/Bringing in the next question/)).toBeDefined();
    expect(screen.queryByText(/you can type again when the next question/)).toBeNull();
    expect(box().readOnly).toBe(true);
    // Right up to the swap: the answer is still the server's to show.
    expect(screen.getByText("Thinking…")).toBeDefined();
  });

  it("says nothing about waiting once there is nothing to wait for", () => {
    draw();
    expect(screen.queryByText(/type again when the next question/)).toBeNull();
    expect(screen.queryByText(/Bringing in the next question/)).toBeNull();
    expect(box().getAttribute("aria-describedby")).toBeNull();
  });

  it("unlocks the box when the answer is handed back", async () => {
    // The failure path clears the wait as well as the echo — a box that is
    // open again under a line saying it is busy is the same bug twice.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    draw();
    fireEvent.change(box(), { target: { value: "beginner" } });
    submit();

    await waitFor(() => expect(screen.getByText(/didn.t send/)).toBeDefined());
    expect(screen.queryByText(/type again when the next question/)).toBeNull();
    expect(box().readOnly).toBe(false);
  });

  it("draws no chip row when the honest answer is prose", () => {
    const { container } = draw([]);
    // Two forms left: the answer and the way out.
    expect(container.querySelectorAll("form")).toHaveLength(2);
  });

  it("draws no way out at all on a plan that keeps one conversation", () => {
    /*
     * Not a disabled link, and not a link to the pricing page either. The bar
     * is where somebody answers a question; a permanent reminder of what their
     * plan does not include, pinned above the keyboard for the whole
     * conversation, is an odd thing to make them read six times.
     *
     * The offer is simply absent, and `restartAction` refuses the POST — the
     * screen is not the check.
     */
    const { container } = drawWithoutRestart();

    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
    // The answer, and nothing else.
    expect(container.querySelectorAll("form")).toHaveLength(1);
  });
});
