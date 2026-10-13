import { render, waitFor, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigate,
}));
const getSession = vi.fn();
vi.mock("../../lib/api/auth", () => ({ getSession: () => getSession() }));

import AuthCallback from "./AuthCallback";

// The kitchen's callback had NO tests, and it is a `safeNext` consumer: an audit unit on
// 2026-10-13 went through every one of them looking for an open redirect, and an unguarded
// surface is the one that stops being clean without anybody noticing. The family app's copy
// has these cases and a fourth about the effect running twice; that one does not port, because
// this page reads the destination through useSearchParams and the route stops matching the
// moment it navigates, so the query cannot go empty underneath it.
function land(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${search}`]}>
      <AuthCallback />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  getSession.mockResolvedValue({ access_token: "t" });
});

test("sends a confirmed sign-in on to the invite it came from", async () => {
  land("?next=%2Fjoin%2Fabc123");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/join/abc123", { replace: true }));
});

test("goes to the dashboard when there is nowhere in particular to go", async () => {
  land("");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
});

test("refuses a destination on another host", async () => {
  // The parameter survives a round trip through Google, so it is as attacker-writable as any
  // URL. A chef landing on somebody else's copy of this page, freshly authenticated, is the
  // thing safeNext exists to stop.
  land("?next=https%3A%2F%2Fevil.example");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
});

test("refuses a protocol-relative destination, which looks like a path and is not", async () => {
  land("?next=%2F%2Fevil.example");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
});

test("explains an expired link instead of navigating", async () => {
  getSession.mockResolvedValue(null);
  land("?next=%2Fjoin%2Fabc123");
  expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
});
