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
  // All three, not just the email: the fields are `required`, so an empty display name or
  // password now makes the browser refuse the submit before handleSubmit ever runs. Filling
  // only the email used to be enough and silently stopped being enough.
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.dev" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
  // "Create account", not "Sign up": the submit button says what it does, which also stops it
  // reading as a near-duplicate of the "Sign up with Google" button beside it.
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
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
