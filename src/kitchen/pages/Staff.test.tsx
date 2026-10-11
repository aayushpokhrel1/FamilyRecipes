import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Staff from "./Staff";
import { listStaff, listSites } from "../../lib/api/kitchen/orgs";
import { createInvite } from "../../lib/api/kitchen/invites";

vi.mock("../../lib/api/kitchen/orgs", () => ({ listStaff: vi.fn(), listSites: vi.fn() }));
vi.mock("../../lib/api/kitchen/invites", () => ({ createInvite: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/orgs/org-1/staff"]}>
      <Routes>
        <Route path="/orgs/:id/staff" element={<Staff />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listSites).mockResolvedValue([
    { id: "site-1", org_id: "org-1", name: "Shoreditch" },
  ]);
  vi.mocked(listStaff).mockResolvedValue([
    { user_id: "u1", role: "owner", site_id: null, display_name: "Sam" },
    { user_id: "u2", role: "cook", site_id: "site-1", display_name: "Kit" },
  ]);
});

describe("the staff page", () => {
  it("shows who is in the group, with their role", async () => {
    renderPage();
    expect(await screen.findByText("Sam")).toBeInTheDocument();
    expect(screen.getByText(/owner/i)).toBeInTheDocument();
    expect(screen.getByText("Kit")).toBeInTheDocument();
  });

  it("makes a link to send, with the role on it", async () => {
    vi.mocked(createInvite).mockResolvedValue("deadbeef");
    renderPage();
    await screen.findByText("Sam");
    await userEvent.selectOptions(screen.getByLabelText(/role/i), "chef");
    await userEvent.click(screen.getByRole("button", { name: /make a link/i }));
    expect(createInvite).toHaveBeenCalledWith("org-1", "chef", null);
    // The link is shown so it can be copied. It carries no name and no email: who it reaches
    // is the owner's business, and we send nothing.
    expect(await screen.findByText(/\/join\/deadbeef/)).toBeInTheDocument();
  });

  it("attaches the chosen site for a site role", async () => {
    vi.mocked(createInvite).mockResolvedValue("deadbeef");
    renderPage();
    await screen.findByText("Sam");
    await userEvent.selectOptions(screen.getByLabelText(/role/i), "site_manager");
    await userEvent.selectOptions(screen.getByLabelText(/site/i), "site-1");
    await userEvent.click(screen.getByRole("button", { name: /make a link/i }));
    expect(createInvite).toHaveBeenCalledWith("org-1", "site_manager", "site-1");
  });

  it("shows the refusal when a chef tries to invite", async () => {
    vi.mocked(createInvite).mockRejectedValue(new Error("only an owner may invite staff"));
    renderPage();
    await screen.findByText("Sam");
    await userEvent.click(screen.getByRole("button", { name: /make a link/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only an owner may invite staff");
  });
});
