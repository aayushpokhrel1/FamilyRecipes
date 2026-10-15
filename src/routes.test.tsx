import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppRoutes from "./routes";

// Without a catch-all React Router matches nothing and renders an EMPTY tree: no header, no
// nav, no way out but the back button. A typo or a stale link looked like a broken app
// rather than a wrong address, and nothing in the suite could see it, because every other
// test renders one page directly instead of going through the router.
//
// The family app's catch-all is PUBLIC, so a signed-out visitor must reach it too. That is
// the half worth pinning: gating it would bounce them through sign-in to be told their link
// is dead. src/routes.terms.test.ts holds the wiring side of the same decision.

vi.mock("./context/AuthContext", () => ({
  useAuth: () => ({ userId: null, loading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: null, families: [], setActiveFamily: vi.fn() }),
  FamilyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./lib/api/profile", () => ({
  getMyProfile: vi.fn().mockResolvedValue(null),
  getByline: vi.fn().mockResolvedValue(null),
}));

it("answers an unknown path with a page rather than nothing", () => {
  render(
    <MemoryRouter initialEntries={["/recipes/not-a-real-route/nope"]}>
      <AppRoutes />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: /that page is not here/i })).toBeInTheDocument();
});

it("shows it to a signed-out visitor instead of sending them to sign in", () => {
  render(
    <MemoryRouter initialEntries={["/this-page-does-not-exist"]}>
      <AppRoutes />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: /that page is not here/i })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /^sign in$/i })).not.toBeInTheDocument();
});

// The risk a catch-all introduces: it is ranked by specificity rather than source order, so
// a real route must still beat it. /terms is the cheapest proof, being public and static.
it("does not swallow a route that does exist", () => {
  render(
    <MemoryRouter initialEntries={["/terms"]}>
      <AppRoutes />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("heading", { name: /that page is not here/i })).toBeNull();
});
