import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "./AppLayout";
// The constants, never the literal strings: import.meta.env.DEV is TRUE under Vitest, so these
// are the localhost origins here and the production ones in a build. Asserting on a hardcoded
// string would pin whichever of the two the author happened to be thinking of.
import { ADMIN_ORIGIN, KITCHEN_ORIGIN } from "../lib/hosts";

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

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigateSpy,
}));

// Read at call time like mockAuth above, so a test can set it before rendering.
let mockProfile: {
  is_moderator: boolean;
  name_cleared_at?: string | null;
  name_cleared_reason?: string | null;
  public_name?: string | null;
} = { is_moderator: false };
vi.mock("../lib/api/profile", () => ({ getMyProfile: () => Promise.resolve(mockProfile) }));

// Reset between tests so one test's visitor cannot leak into the next.
beforeEach(() => {
  mockAuth = { userId: "u1", loading: false };
  // Default to the ordinary cook. A test that wants the moderator says so.
  mockProfile = { is_moderator: false };
  navigateSpy.mockReset();
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

  // The console lives on admin.enamelvault.com now, so this is a cross-origin link and must
  // stay a plain <a>: a NavLink would be routed inside this app and land on nothing. The link
  // is still a CONVENIENCE and not a permission, which the two tests below pin.
  it("offers the console to a moderator, on its own host", async () => {
    mockProfile = { is_moderator: true };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: /console/i }))
      .toHaveAttribute("href", ADMIN_ORIGIN);
  });

  // Hiding the link is a convenience and NOT the guard: the page re-checks is_moderator and
  // RLS hides the reports regardless. This test pins the convenience; the guard is pinned in
  // the moderation tests, and both have to hold.
  it("hides the console from an ordinary cook", async () => {
    mockProfile = { is_moderator: false };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "My Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /console/i })).not.toBeInTheDocument();
  });

  it("hides the console from a signed-out visitor", async () => {
    mockAuth = { userId: null, loading: false };
    mockProfile = { is_moderator: true };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /console/i })).not.toBeInTheDocument();
  });

  // Shown to everyone on purpose: it is a product of the same operator, already marketed on
  // enamelvault.com, so it leaks nothing, and it is the hop that makes the two products feel
  // like one account.
  it("offers the kitchen app to every signed-in cook, moderator or not", async () => {
    mockProfile = { is_moderator: false };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: /for kitchens/i }))
      .toHaveAttribute("href", KITCHEN_ORIGIN);
  });

  // The notice used to live only in Settings, the one page a cook has no reason to visit.
  it("tells a cleared cook on every page, not only in Settings", async () => {
    mockProfile = {
      is_moderator: false,
      name_cleared_at: "2026-10-02T00:00:00Z",
      name_cleared_reason: "impersonation",
      public_name: null,
    };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    const banner = await screen.findByText(/hidden from Potluck/);
    expect(banner.closest("p")).toHaveTextContent("Impersonation");
    expect(screen.getByRole("link", { name: /set one in settings/i }))
      .toHaveAttribute("href", "/settings");
  });

  it("stops telling them once a public name is set", async () => {
    mockProfile = {
      is_moderator: false,
      name_cleared_at: "2026-10-02T00:00:00Z",
      name_cleared_reason: "impersonation",
      public_name: "Nana Rose",
    };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    await screen.findByRole("link", { name: "My Profile" });
    expect(screen.queryByText(/hidden from Potluck/)).not.toBeInTheDocument();
  });

  it("shows no banner to an ordinary cook", async () => {
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    await screen.findByRole("link", { name: "My Profile" });
    expect(screen.queryByText(/hidden from Potluck/)).not.toBeInTheDocument();
  });
});

describe("signing out", () => {
  // Leaving the guarded page BEFORE the session goes is the whole fix. Sign out from a guarded
  // page such as /settings and RequireAuth saw a signed-out visitor still standing on it, so it
  // redirected to /signin?next=%2Fsettings and the NEXT person to sign in on that browser
  // landed on the previous person's page. The page itself refused them, so this was a papercut
  // rather than a hole, but a shared machine should not hand over a destination.
  //
  // The original report was about /moderation, which has since moved to its own host. The bug
  // was never specific to that route: any route inside RequireAuth shows it.
  it("leaves the guarded page before the session is dropped", async () => {
    const order: string[] = [];
    const { signOut } = await import("../lib/api/auth");
    (signOut as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("signOut");
    });
    navigateSpy.mockImplementation((to: string) => { order.push(`navigate:${to}`); });

    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    screen.getByRole("button", { name: "Sign out" }).click();
    await vi.waitFor(() => expect(order).toContain("signOut"));

    expect(order).toEqual(["navigate:/signin", "signOut"]);
  });
});
