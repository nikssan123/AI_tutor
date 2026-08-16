// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SubmitButton } from "@/components/submit-button";

/**
 * The throbber the `fetch` submission took away.
 *
 * These drive a real React form action rather than stubbing `useFormStatus`,
 * because the thing worth asserting is not that a boolean flips — it is that a
 * button nested in a form knows the form is busy without being told. A mock of
 * the hook would pass just as happily against a component that had been lifted
 * out of the form and wired to nothing.
 */

/** A form action that stays running until the test lets it finish. */
function gate() {
  let open!: () => void;
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, action: async () => shut };
}

function renderIn(action: () => Promise<void>) {
  return render(
    <form action={action}>
      <SubmitButton
        pendingLabel="Building your path"
        note="Cutting the subject into modules."
      >
        Build my path
      </SubmitButton>
    </form>,
  );
}

afterEach(cleanup);

describe("SubmitButton", () => {
  it("is an ordinary submit button until the form is busy", () => {
    renderIn(async () => {});

    const button = screen.getByRole<HTMLButtonElement>("button");
    expect(button.textContent).toBe("Build my path");
    expect(button.type).toBe("submit");
    expect(button.disabled).toBe(false);
    // The live region is there from the first paint, empty — see the component.
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("says what is happening, in the label and out loud", async () => {
    const { open, action } = gate();
    renderIn(action);

    fireEvent.click(screen.getByRole("button"));

    const button = await screen.findByRole<HTMLButtonElement>("button", {
      name: /Building your path/,
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Cutting the subject into modules.",
    );

    // A second press of a button that costs a model call is a second model
    // call, so the wait is not clickable.
    expect(button.disabled).toBe(true);

    await act(async () => {
      open();
    });
  });

  it("goes back to being a button when the action finishes", async () => {
    const { open, action } = gate();
    renderIn(action);

    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("button", { name: /Building your path/ });

    await act(async () => {
      open();
    });

    const button = screen.getByRole<HTMLButtonElement>("button");
    expect(button.textContent).toBe("Build my path");
    expect(button.disabled).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
