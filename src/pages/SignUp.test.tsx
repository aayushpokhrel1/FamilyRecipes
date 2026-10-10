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

function submit(at = "/signup") {
  render(<MemoryRouter initialEntries={[at]}><SignUp /></MemoryRouter>);
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

// The fourth argument is what puts the invite in the confirmation EMAIL. Without it the link
// in the inbox lands on the home page, which is how a cook joined by link on production and
// ended up with a kitchen of their own and no family.
test("carries the invite into the confirmation email", async () => {
  signUp.mockResolvedValue({ user: { id: "u1" }, session: null });
  submit("/signup?next=%2Fjoin%2Fabc123");
  await waitFor(() =>
    expect(signUp).toHaveBeenCalledWith("a@b.dev", "hunter2hunter2", "A", "/join/abc123"),
  );
});

test("refuses a destination pointing at another host", async () => {
  // ?next= comes off a URL anyone can write, so this is the open-redirect case: a freshly
  // signed-up cook must never be handed to someone else's page. lib/nextPath.ts is the guard.
  signUp.mockResolvedValue({ user: { id: "u1" }, session: { access_token: "t" } });
  submit("/signup?next=https%3A%2F%2Fevil.example");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
});
