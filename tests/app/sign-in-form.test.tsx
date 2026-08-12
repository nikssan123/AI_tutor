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

const { SignInForm } = await import("@/app/(app)/sign-in/sign-in-form");

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

  it("creates an account from the same form", () => {
    // §8 screen 3 defers signup until after the diagnostic — this screen is a
    // utility, not a conversion surface, so it does not deserve two of anything.
    signUpEmail.mockResolvedValue({ error: null });
    render(<SignInForm />);
    fill("new@user.co", "correct-horse-battery");
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(signUpEmail).toHaveBeenCalledWith({
      email: "new@user.co",
      password: "correct-horse-battery",
      name: "new@user.co",
    });
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

  it("surfaces a sign-up failure too, not just a sign-in one", async () => {
    signUpEmail.mockResolvedValue({ error: { message: "Email already in use" } });
    render(<SignInForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(await screen.findByText("Email already in use")).toBeDefined();
    expect(push).not.toHaveBeenCalled();
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
