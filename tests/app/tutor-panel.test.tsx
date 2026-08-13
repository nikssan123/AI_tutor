// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { appendToLast, TutorPanel } from "@/app/(app)/session/[id]/tutor-panel";

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
  it("shows the transcript it was handed", () => {
    render(
      <TutorPanel
        sessionId="s1"
        initialTurns={[
          { role: "user", content: "why?" },
          { role: "assistant", content: "because" },
        ]}
      />,
    );

    expect(screen.getByText("why?")).toBeDefined();
    expect(screen.getByText("because")).toBeDefined();
  });

  it("streams an answer into the page", async () => {
    render(<TutorPanel sessionId="s1" initialTurns={[]} />);

    const input = screen.getByLabelText("Ask the tutor") as HTMLInputElement;
    input.value = "why?";
    screen.getByRole("button", { name: "Ask" }).click();

    await waitFor(() =>
      expect(screen.getByText("Because of the grain.")).toBeDefined(),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends §8 screen 7's two named asks with one click each", async () => {
    render(<TutorPanel sessionId="s1" initialTurns={[]} />);

    screen.getByRole("button", { name: /don.t understand/i }).click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as { body: string }).body,
    ) as { message: string };
    expect(body.message).toContain("different way");

    cleanup();
    fetchMock.mockClear();
    render(<TutorPanel sessionId="s1" initialTurns={[]} />);
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

    render(<TutorPanel sessionId="s1" initialTurns={[]} />);
    const input = screen.getByLabelText("Ask the tutor") as HTMLInputElement;
    input.value = "why?";
    screen.getByRole("button", { name: "Ask" }).click();

    await waitFor(() =>
      expect(screen.getByText(/the tutor is down/)).toBeDefined(),
    );
  });

  it("reports a non-Error failure", async () => {
    fetchMock.mockRejectedValue("just a string");

    render(<TutorPanel sessionId="s1" initialTurns={[]} />);
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

    render(<TutorPanel sessionId="s1" initialTurns={[]} />);
    const input = screen.getByLabelText("Ask the tutor") as HTMLInputElement;
    input.value = "why?";
    screen.getByRole("button", { name: "Ask" }).click();

    // An empty bubble with nothing in it reads as a broken page; it says what
    // it is doing until the first token lands.
    await waitFor(() => expect(screen.getByText("Thinking…")).toBeDefined());
    release();
  });

  it("ignores an empty question", () => {
    render(<TutorPanel sessionId="s1" initialTurns={[]} />);
    screen.getByRole("button", { name: "Ask" }).click();
    expect(fetchMock).not.toHaveBeenCalled();
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
