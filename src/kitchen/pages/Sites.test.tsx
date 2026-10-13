import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Sites from "./Sites";
import { addSite, listSites, myRole } from "../../lib/api/kitchen/orgs";

vi.mock("../../lib/api/kitchen/orgs", () => ({
  addSite: vi.fn(),
  listSites: vi.fn(),
  myRole: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/orgs/org-1/sites"]}>
      <Routes>
        <Route path="/orgs/:id/sites" element={<Sites />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(myRole).mockResolvedValue("owner");
  vi.mocked(listSites).mockResolvedValue([{ id: "site-1", org_id: "org-1", name: "Shoreditch" }]);
});

describe("the sites page", () => {
  it("lists the group's sites to anybody who works there", async () => {
    vi.mocked(myRole).mockResolvedValue("cook");
    renderPage();
    expect(await screen.findByText("Shoreditch")).toBeInTheDocument();
  });

  it("lets an owner add one", async () => {
    vi.mocked(addSite).mockResolvedValue("site-2");
    renderPage();
    await screen.findByText("Shoreditch");
    await userEvent.type(await screen.findByLabelText(/add a site/i), "Peckham");
    await userEvent.click(screen.getByRole("button", { name: /add the site/i }));
    expect(addSite).toHaveBeenCalledWith("org-1", "Peckham");
  });

  it("offers nobody else the form, because add_site refuses them", async () => {
    // A chef is the closest role to an owner here and still may not name a site. The refusal
    // is loud (KIT01), which is exactly why this read as harmless: a control that always
    // fails is still a page telling its viewer they may do something they may not.
    vi.mocked(myRole).mockResolvedValue("chef");
    renderPage();
    await screen.findByText("Shoreditch");
    expect(screen.queryByLabelText(/add a site/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add the site/i })).not.toBeInTheDocument();
  });
});
