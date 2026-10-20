import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import OrgSettings from "./OrgSettings";
import { eraseOrg, listStaff, myOrgs, myRole } from "../../lib/api/kitchen/orgs";

vi.mock("../../lib/api/kitchen/orgs", () => ({
  eraseOrg: vi.fn(),
  listStaff: vi.fn(),
  myOrgs: vi.fn(),
  myRole: vi.fn(),
}));

const auth = vi.fn();
vi.mock("../../context/AuthContext", () => ({ useAuth: () => auth() }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/orgs/org-1/settings"]}>
      <Routes>
        <Route path="/orgs/:id/settings" element={<OrgSettings />} />
        <Route path="/" element={<p>the group list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockReturnValue({ userId: "u1", loading: false });
  vi.mocked(myRole).mockResolvedValue("owner");
  vi.mocked(myOrgs).mockResolvedValue([{ id: "org-1", name: "Enamel Group" }]);
  vi.mocked(listStaff).mockResolvedValue([
    { user_id: "u1", role: "owner", site_id: null, display_name: "Ada" },
    { user_id: "u2", role: "chef", site_id: null, display_name: "Bella" },
    { user_id: "u3", role: "cook", site_id: "site-1", display_name: "Cyrus" },
  ]);
  vi.mocked(eraseOrg).mockResolvedValue(undefined);
});

describe("the settings page", () => {
  it("offers a chef no erase control, and says only an owner can erase", async () => {
    vi.mocked(myRole).mockResolvedValue("chef");
    renderPage();
    expect(await screen.findByText(/only an owner can erase/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /erase/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/type the group's name/i)).not.toBeInTheDocument();
  });

  it("tells an owner how many people will lose access, in the right number", async () => {
    // Two other people in the roster, so the plural is exercised; the viewer is not counted.
    renderPage();
    expect(await screen.findByText(/2 people will lose access/i)).toBeInTheDocument();
    expect(screen.getByText(/takes every published dish down from Potluck/i)).toBeInTheDocument();
  });

  it("says nobody else loses access when the owner is alone", async () => {
    vi.mocked(listStaff).mockResolvedValue([
      { user_id: "u1", role: "owner", site_id: null, display_name: "Ada" },
    ]);
    renderPage();
    expect(await screen.findByText(/nobody else will lose access/i)).toBeInTheDocument();
  });

  it("keeps the control disabled until the group's name is typed exactly", async () => {
    renderPage();
    const field = await screen.findByLabelText(/type the group's name/i);
    const button = screen.getByRole("button", { name: /erase this group/i });
    expect(button).toBeDisabled();
    // A near miss: right name, wrong case.
    await userEvent.type(field, "enamel group");
    expect(button).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "Enamel Group");
    expect(button).toBeEnabled();
  });

  it("erases the group the person named, and goes back to the group list", async () => {
    renderPage();
    await userEvent.type(await screen.findByLabelText(/type the group's name/i), "Enamel Group");
    await userEvent.click(screen.getByRole("button", { name: /erase this group/i }));
    expect(eraseOrg).toHaveBeenCalledWith("org-1");
    expect(await screen.findByText("the group list")).toBeInTheDocument();
  });

  it("offers no control when another owner exists, and says they must go first", async () => {
    vi.mocked(listStaff).mockResolvedValue([
      { user_id: "u1", role: "owner", site_id: null, display_name: "Ada" },
      { user_id: "u2", role: "owner", site_id: null, display_name: "Bella" },
    ]);
    renderPage();
    expect(await screen.findByText(/1 other owner/i)).toBeInTheDocument();
    expect(screen.getByText(/removed first/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /erase/i })).not.toBeInTheDocument();
  });

  it("shows a refusal verbatim", async () => {
    vi.mocked(eraseOrg).mockRejectedValue(new Error("KIT02: remove the other owners first"));
    renderPage();
    await userEvent.type(await screen.findByLabelText(/type the group's name/i), "Enamel Group");
    await userEvent.click(screen.getByRole("button", { name: /erase this group/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "KIT02: remove the other owners first",
    );
  });
});
