import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import JoinByCode from "./JoinByCode";

const familyNameForCode = vi.fn();
const joinByCode = vi.fn();
vi.mock("../lib/api/families", () => ({
  familyNameForCode: (...a: any[]) => familyNameForCode(...a),
  joinByCode: (...a: any[]) => joinByCode(...a),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

let mockAuth: { userId: string | null; loading: boolean } = { userId: null, loading: false };
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockAuth }));
const reload = vi.fn();
vi.mock("../context/FamilyContext", () => ({ useFamily: () => ({ reload }) }));

function renderAt(code: string) {
  return render(
    <MemoryRouter initialEntries={[`/join/${code}`]}>
      <Routes><Route path="/join/:code" element={<JoinByCode />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth = { userId: null, loading: false };
  familyNameForCode.mockResolvedValue("The Pokhrel family");
  joinByCode.mockResolvedValue(undefined);
});

// userId is null while the session is still resolving, so a signed-in visitor was shown the
// "create an account" branch for a beat and could click it, landing in signup while already
// signed in.
test("waits for the session before deciding what to offer", async () => {
  mockAuth = { userId: null, loading: true };
  renderAt("abc123");
  await waitFor(() => expect(familyNameForCode).toHaveBeenCalled());
  expect(screen.queryByRole("link", { name: /create an account/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /join this family/i })).not.toBeInTheDocument();
});


test("tells a signed-out visitor which family invited them", async () => {
  renderAt("abc123");
  expect(await screen.findByText("The Pokhrel family")).toBeInTheDocument();
  expect(joinByCode).not.toHaveBeenCalled();
});

// Both links, and the ?next= on them, not just the presence of a link.
//
// This test was here, under this name, while the invite rode in React Router's `state`, which
// an href cannot show: it asserted href="/signup" and passed all the way through the bug.
// Router state dies when the browser leaves the page, and three of the four ways in do leave
// it, so a cook who signed up by email landed on the home page with no family. Found on
// production, 2026-10-10. The destination is in the URL now precisely so a test can see it.
test("offers a signed-out visitor both doors, each carrying the invite", async () => {
  renderAt("abc123");
  const create = await screen.findByRole("link", { name: /create an account/i });
  expect(create).toHaveAttribute("href", "/signup?next=%2Fjoin%2Fabc123");
  const signin = screen.getByRole("link", { name: /already have an account/i });
  expect(signin).toHaveAttribute("href", "/signin?next=%2Fjoin%2Fabc123");
});

test("asks a signed-in visitor before joining", async () => {
  // The page used to join on mount, so a forwarded link joined you by itself.
  mockAuth = { userId: "u1", loading: false };
  renderAt("abc123");
  expect(await screen.findByRole("button", { name: "Join this family" })).toBeInTheDocument();
  expect(joinByCode).not.toHaveBeenCalled();
});

test("joins and goes home when the button is pressed", async () => {
  mockAuth = { userId: "u1", loading: false };
  renderAt("abc123");
  await userEvent.click(await screen.findByRole("button", { name: "Join this family" }));
  await waitFor(() => expect(joinByCode).toHaveBeenCalledWith("abc123"));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
});

test("says an unknown invite is dead and offers no way in", async () => {
  familyNameForCode.mockResolvedValue(null);
  renderAt("gone");
  expect(await screen.findByText(/does not work any more/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument();
});

test("shows the reason a join failed and stays put", async () => {
  mockAuth = { userId: "u1", loading: false };
  joinByCode.mockRejectedValue(new Error("invalid invite code"));
  renderAt("abc123");
  await userEvent.click(await screen.findByRole("button", { name: "Join this family" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("invalid invite code");
  expect(navigate).not.toHaveBeenCalled();
});
