import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import JoinByLink from "./JoinByLink";
import { peekInvite, acceptInvite } from "../../lib/api/kitchen/invites";

vi.mock("../../lib/api/kitchen/invites", () => ({
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
}));
const auth = vi.fn();
vi.mock("../../context/AuthContext", () => ({ useAuth: () => auth() }));

function renderAt(code: string) {
  return render(
    <MemoryRouter initialEntries={[`/join/${code}`]}>
      <Routes>
        <Route path="/join/:code" element={<JoinByLink />} />
        <Route path="/signin" element={<p>the sign in page</p>} />
        <Route path="/" element={<p>the dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockReturnValue({ userId: null, loading: false });
});

describe("an invite link", () => {
  it("names the group and the role to a stranger with no account", async () => {
    vi.mocked(peekInvite).mockResolvedValue({
      org_name: "Enamel Group",
      role: "site_manager",
      site_name: "Shoreditch",
    });
    renderAt("abc123");
    expect(await screen.findByText(/Enamel Group/)).toBeInTheDocument();
    expect(screen.getByText(/site manager/i)).toBeInTheDocument();
    expect(screen.getByText(/Shoreditch/)).toBeInTheDocument();
  });

  it("employs nobody just by being opened", async () => {
    vi.mocked(peekInvite).mockResolvedValue({
      org_name: "Enamel Group",
      role: "chef",
      site_name: null,
    });
    renderAt("abc123");
    await screen.findByText(/Enamel Group/);
    // A forwarded link must not make the person who opened it a chef.
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor onward with the invite in the URL, on BOTH hops", async () => {
    vi.mocked(peekInvite).mockResolvedValue({
      org_name: "Enamel Group",
      role: "chef",
      site_name: null,
    });
    renderAt("abc123");
    // BOTH links, not either: the family app lost its invite on the sign-UP hop specifically,
    // because that is the door a person with no account actually takes.
    const links = [
      await screen.findByRole("link", { name: /^sign in$/i }),
      screen.getByRole("link", { name: /create an account/i }),
    ];
    // In the URL, because Google and an email confirmation link both leave the page. This is
    // the exact defect that shipped on the family side on 2026-10-10.
    for (const link of links) {
      expect(link).toHaveAttribute("href", expect.stringContaining("next=%2Fjoin%2Fabc123"));
    }
  });

  it("lets a signed-in person accept, and then shows them the kitchen", async () => {
    auth.mockReturnValue({ userId: "u1", loading: false });
    vi.mocked(peekInvite).mockResolvedValue({
      org_name: "Enamel Group",
      role: "chef",
      site_name: null,
    });
    vi.mocked(acceptInvite).mockResolvedValue("org-1");
    renderAt("abc123");
    await userEvent.type(await screen.findByLabelText(/your name/i), "Ada");
    await userEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(acceptInvite).toHaveBeenCalledWith("abc123", "Ada");
    expect(await screen.findByText("the dashboard")).toBeInTheDocument();
  });

  it("says a used or unknown link is no longer valid, and offers no button", async () => {
    vi.mocked(peekInvite).mockResolvedValue(null);
    renderAt("gone");
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid|expired|already/i);
    expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument();
  });
});
