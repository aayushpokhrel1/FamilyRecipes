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

// Read at call time like mockAuth above, so a test can set it before rendering.
let mockProfile: { is_moderator: boolean } = { is_moderator: false };
vi.mock("../lib/api/profile", () => ({ getMyProfile: () => Promise.resolve(mockProfile) }));

// Reset between tests so one test's visitor cannot leak into the next.
beforeEach(() => {
  mockAuth = { userId: "u1", loading: false };
  // Default to the ordinary cook. A test that wants the moderator says so.
  mockProfile = { is_moderator: false };
});

describe("AppLayout", () => {
  // The point of /me: the public page was reachable only through Settings, which is where
  // nobody looks for it. The link is static and unconditional, so it is here even before you
  // have a handle, and /me explains the rest.
  it("offers the public page from the nav, not only through Settings", () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "My Profile" })).toHaveAttribute("href", "/me");
  });

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

  // /moderation has no entry point anywhere else, so without this link a moderator has to
  // remember the URL to find their own queue.
  it("offers Moderation in the nav to a moderator", async () => {
    mockProfile = { is_moderator: true };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: /moderation/i }))
      .toHaveAttribute("href", "/moderation");
  });

  // Hiding the link is a convenience and NOT the guard: the page re-checks is_moderator and
  // RLS hides the reports regardless. This test pins the convenience; the guard is pinned in
  // the moderation tests, and both have to hold.
  it("hides Moderation from an ordinary cook", async () => {
    mockProfile = { is_moderator: false };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "My Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /moderation/i })).not.toBeInTheDocument();
  });

  it("hides Moderation from a signed-out visitor", async () => {
    mockAuth = { userId: null, loading: false };
    mockProfile = { is_moderator: true };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /moderation/i })).not.toBeInTheDocument();
  });
});
