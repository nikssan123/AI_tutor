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
 * Two problems live here. A turn calls a model, so it takes seconds — with no
 * feedback the screen read as frozen, which is how a chip got tapped three
 * times and three turns were recorded. And an answer that arrives all at once
 * after that wait still reads as a stall, so it arrives as it is written.
 *
 * The property that has to survive both: these are still real forms pointed at
 * the same Server Actions, so the screen works with scripting off.
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

  it("writes the reply out as it arrives, not once at the end", async () => {
    answers("Got it — ", "starting from scratch.", `${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "beginner" } });
    submit();

    await waitFor(() =>
      expect(screen.getByText("Got it — starting from scratch.")).toBeDefined(),
    );
    // The dots are for the wait before the first word, and give way to it.
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("keeps the verdict out of the sentence it follows", async () => {
    answers(`All set.${OUTCOME_SEPARATOR}ok`);
    draw();
    fireEvent.change(box(), { target: { value: "yes" } });
    submit();

    await waitFor(() => expect(screen.getByText("All set.")).toBeDefined());
    expect(screen.queryByText(/All set\.\s*ok/)).toBeNull();
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

  it("draws no chip row when the honest answer is prose", () => {
    const { container } = draw([]);
    // Two forms left: the answer and the way out.
    expect(container.querySelectorAll("form")).toHaveLength(2);
  });
});
