import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigate,
}));
const signUp = vi.fn();
vi.mock("../lib/api/auth", () => ({ signUp: (...a: unknown[]) => signUp(...a) }));

import SignUp from "./SignUp";

function submit() {
  render(<MemoryRouter><SignUp /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.dev" } });
  // Exact, not /sign up/i: "Sign up with Google" sits beside it and would match too.
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
}

test("tells the user to check their inbox when there is no session yet", async () => {
  signUp.mockResolvedValue({ user: { id: "u1" }, session: null });
  submit();
  await screen.findByText(/check your email/i);
  expect(screen.getByText("a@b.dev")).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});

test("goes straight in when confirmation is off and a session comes back", async () => {
  signUp.mockResolvedValue({ user: { id: "u1" }, session: { access_token: "t" } });
  submit();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
});
