import { StrictMode } from "react";
import { render, waitFor, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigate,
}));
const getSession = vi.fn();
vi.mock("../lib/api/auth", () => ({ getSession: () => getSession() }));

import AuthCallback from "./AuthCallback";

// This page reads window.location directly, not the router: it is the landing point of a FULL
// page load, which is the entire reason the destination cannot live in router state.
function land(search: string) {
  landAnd(search);
}

function landAnd(search: string) {
  window.history.replaceState({}, "", `/auth/callback${search}`);
  return render(<MemoryRouter><AuthCallback /></MemoryRouter>);
}

beforeEach(() => {
  navigate.mockClear();
  getSession.mockResolvedValue({ access_token: "t" });
});

// Both doors that leave the page, Google and an email confirmation link, come back HERE, so
// this is where an invite is finally honoured or finally lost. It was lost: a cook who
// joined by link on production got a kitchen of their own and no family.
test("sends a confirmed sign-in on to the invite it came from", async () => {
  land("?next=%2Fjoin%2Fabc123");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/join/abc123", { replace: true }));
});

test("goes home when there is nowhere in particular to go", async () => {
  land("");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
});

test("refuses a destination on another host", async () => {
  // The parameter survives a round trip through Google, so it is as attacker-writable as any
  // URL. Landing a freshly authenticated person on someone else's page is the thing to stop.
  land("?next=https%3A%2F%2Fevil.example");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
});

test("still explains a refusal instead of redirecting", async () => {
  getSession.mockResolvedValue(null);
  land("?next=%2Fjoin%2Fabc123");
  expect(await screen.findByText(/did not complete/i)).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
});

// The destination must survive the effect running twice, which is what StrictMode does in
// development and what any remount does anywhere. It did not: the first run navigated, which
// cleared the query, and the second read an empty one and sent the person home. The invite
// link looked exactly as broken as before the fix. Caught in a browser, 2026-10-10.
test("survives the effect running a second time after the query is gone", async () => {
  // Two things here imitate the real browser, and the suite could not see this bug without
  // either of them: StrictMode runs the effect TWICE on the same instance, and a real
  // navigate CHANGES THE URL, which is what takes the query away between the two runs.
  // Caught in a browser instead, 2026-10-10: the first run went to the invite, the second
  // read an empty query and sent the person home over the top of it.
  navigate.mockImplementation((to: string) => {
    window.history.replaceState({}, "", to);
  });
  window.history.replaceState({}, "", "/auth/callback?next=%2Fjoin%2Fabc123");
  render(
    <StrictMode>
      <MemoryRouter>
        <AuthCallback />
      </MemoryRouter>
    </StrictMode>,
  );
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
  expect(navigate).not.toHaveBeenCalledWith("/", { replace: true });
  expect(navigate).toHaveBeenLastCalledWith("/join/abc123", { replace: true });
});
