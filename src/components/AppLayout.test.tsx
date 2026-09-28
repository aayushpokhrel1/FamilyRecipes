import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "./AppLayout";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({
    families: [],
    activeFamily: null,
    setActiveFamily() {},
    reload() {},
  }),
}));
vi.mock("../lib/api/auth", () => ({ signOut: vi.fn() }));

// Hoisted by vi.mock, so mockAuth is read at render time, not at mock time.
let mockAuth: { userId: string | null; loading: boolean } = { userId: "u1", loading: false };
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockAuth }));
vi.mock("./FamilySwitcher", () => ({ default: () => <div>switcher</div> }));

// Reset between tests so one test's visitor cannot leak into the next.
beforeEach(() => {
  mockAuth = { userId: "u1", loading: false };
});

describe("AppLayout", () => {
  it("renders the app shell", () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /families/i })).toBeInTheDocument();
  });

  it("shows a Sign in link and no family controls when signed out", () => {
    mockAuth = { userId: null, loading: false };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText("switcher")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /my kitchen/i })).not.toBeInTheDocument();
  });

  it("shows the full nav when signed in", () => {
    mockAuth = { userId: "u1", loading: false };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(screen.getByText("switcher")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});
