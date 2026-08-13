// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
const signInEmail = vi.fn();
const signUpEmail = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: (...a: unknown[]) => signInEmail(...a) },
    signUp: { email: (...a: unknown[]) => signUpEmail(...a) },
  },
}));

const { SignInForm, humanError } = await import(
  "@/app/(app)/sign-in/sign-in-form"
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fill(email = "a@b.co", password = "hunter2hunter2") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
}

/** The form element itself — submitted directly to model the Enter key. */
const formEl = () => screen.getByLabelText("Email").closest("form")!;

describe("SignInForm", () => {
  it("signs in and lands the learner on /today", async () => {
    signInEmail.mockResolvedValue({ error: null });
    render(<SignInForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(signInEmail).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "hunter2hunter2",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("sends someone creating an account to /sign-up, and signs nobody up itself", () => {
    // This form used to do both, told apart by which button submitted it. That
    // stopped working when sign-up grew a confirmation field that sign-in must
    // not have.
    const { container } = render(<SignInForm />);

    expect(
      screen.queryByRole("button", { name: "Create an account" }),
    ).toBeNull();
    expect(
      container.querySelector('a[href="/sign-up"]')?.textContent,
    ).toBe("Create an account");
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("surfaces the server's message on failure and stays put", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid credentials" } });
    render(<SignInForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid credentials")).toBeDefined();
    expect(push).not.toHaveBeenCalled();
  });

  it("falls back to a plain message when the server sends none", async () => {
    signInEmail.mockResolvedValue({ error: {} });
    render(<SignInForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("That didn't work.")).toBeDefined();
  });

  it("disables both actions while a request is in flight", async () => {
    let resolve!: (v: unknown) => void;
    signInEmail.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<SignInForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    resolve({ error: null });
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("clears a previous error when the learner tries again", async () => {
    signInEmail.mockResolvedValueOnce({ error: { message: "Nope" } });
    render(<SignInForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Nope")).toBeDefined();

    signInEmail.mockResolvedValueOnce({ error: null });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.queryByText("Nope")).toBeNull());
  });

  it("recovers from a network failure instead of hanging disabled", async () => {
    // Without a catch, a rejected promise leaves `pending` true forever: the
    // button is disabled and the learner is told nothing.
    signInEmail.mockRejectedValue(new Error("Failed to fetch"));
    render(<SignInForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/couldn't reach the server/i)).toBeDefined();
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
  });

  it("uses the right autocomplete hints", () => {
    render(<SignInForm />);
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe(
      "email",
    );
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });
});

/**
 * The four defects that made this screen fail in the browser while every test
 * above kept passing. Each one was invisible to a suite that only ever clicked
 * buttons with `fireEvent` on an already-hydrated component.
 */
describe("submitting the way people actually do", () => {
  it("submits on Enter, which a stack of buttons in a div never did", async () => {
    // No <form> meant the most ordinary way to submit a two-field login — type
    // password, press Enter — did nothing whatsoever.
    signInEmail.mockResolvedValue({ error: null });
    render(<SignInForm />);
    fill();
    fireEvent.submit(formEl());

    await waitFor(() => expect(signInEmail).toHaveBeenCalled());
    // Enter carries no submitter, so it must mean "sign in", not "create one".
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("marks both fields required so an empty submit never reaches the server", () => {
    // The server answers an empty body with a Zod dump. The fix is to not send
    // one: the browser blocks the submit and points at the offending field.
    render(<SignInForm />);
    expect((screen.getByLabelText("Email") as HTMLInputElement).required).toBe(
      true,
    );
    expect(
      (screen.getByLabelText("Password") as HTMLInputElement).required,
    ).toBe(true);
  });

  it("reads the values off the DOM, so pre-hydration typing is not lost", async () => {
    // Someone who types before React attaches has their text in the input but
    // in no `useState`. Controlled inputs dropped it and posted empty strings —
    // which is exactly what produced the error on screen.
    signInEmail.mockResolvedValue({ error: null });
    render(<SignInForm />);

    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    // Set the DOM directly, firing no React event at all.
    email.value = "typed-early@example.com";
    password.value = "before-hydration";

    fireEvent.submit(formEl());

    await waitFor(() =>
      expect(signInEmail).toHaveBeenCalledWith({
        email: "typed-early@example.com",
        password: "before-hydration",
      }),
    );
  });

  it("announces the error to a screen reader", () => {
    render(<SignInForm />);
    fill();
    signInEmail.mockResolvedValue({ error: { message: "Nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    return waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});

describe("humanError", () => {
  it("replaces the Zod dump a learner should never see", () => {
    expect(
      humanError({
        code: "VALIDATION_ERROR",
        message:
          "[body.email] Invalid email address; [body.password] Too small: expected string to have >=1 characters",
      }),
    ).toBe("Enter an email address and a password.");
  });

  it("catches the same dump when it arrives without the code", () => {
    expect(humanError({ message: "[body.email] Invalid email address" })).toBe(
      "Enter an email address and a password.",
    );
  });

  it.each([
    ["Invalid email or password"],
    ["Password too short"],
    ["User already exists"],
  ])("passes %s through — the server already wrote it for a person", (message) => {
    expect(humanError({ message })).toBe(message);
  });

  it("falls back when the server says nothing at all", () => {
    expect(humanError({})).toBe("That didn't work.");
  });
});
