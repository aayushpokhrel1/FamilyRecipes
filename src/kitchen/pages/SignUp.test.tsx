import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SignUp from "./SignUp";

vi.mock("../../lib/api/auth", () => ({
  signUp: vi.fn().mockResolvedValue({}),
  signInWithGoogle: vi.fn(),
}));

function renderSignUp() {
  render(
    <MemoryRouter initialEntries={["/signup"]}>
      <SignUp />
    </MemoryRouter>,
  );
}

describe("the kitchen sign-up page", () => {
  it("offers the same ways in as the sign-in page", () => {
    renderSignUp();
    expect(screen.getByRole("button", { name: /create the account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign up with google/i })).toBeInTheDocument();
  });

  it("carries the kitchen's own name, not the family app's", () => {
    renderSignUp();
    expect(screen.getByRole("link", { name: /enamel vault for kitchens/i })).toBeInTheDocument();
    expect(screen.queryByText("Family Recipes")).not.toBeInTheDocument();
  });

  // The documents have to be readable BEFORE committing to an account. Acceptance itself is
  // recorded later by KitchenTermsGate, which is why this page links them rather than
  // claiming you agreed by signing up.
  it("links both documents without claiming you have accepted them", () => {
    renderSignUp();
    expect(screen.getByRole("link", { name: /^terms$/i })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: /privacy page/i })).toHaveAttribute("href", "/privacy");
    expect(screen.queryByText(/by signing up you agree/i)).not.toBeInTheDocument();
  });
});
