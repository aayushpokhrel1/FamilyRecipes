import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Sites from "./Sites";
import {
  addSite, closeSite, listSites, myRole, reopenSite, siteClosureImpact,
} from "../../lib/api/kitchen/orgs";

vi.mock("../../lib/api/kitchen/orgs", () => ({
  addSite: vi.fn(),
  closeSite: vi.fn(),
  listSites: vi.fn(),
  myRole: vi.fn(),
  reopenSite: vi.fn(),
  siteClosureImpact: vi.fn(),
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
  vi.mocked(listSites).mockResolvedValue([{ id: "site-1", org_id: "org-1", name: "Shoreditch", closed_at: null }]);
  vi.mocked(siteClosureImpact).mockResolvedValue({ dishes: 2, people: 1 });
  vi.mocked(closeSite).mockResolvedValue(undefined);
  vi.mocked(reopenSite).mockResolvedValue(undefined);
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

  it("offers an owner Close on an open site", async () => {
    renderPage();
    await screen.findByText("Shoreditch");
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("offers a chef no Close on any site, because close_site refuses them", async () => {
    vi.mocked(myRole).mockResolvedValue("chef");
    renderPage();
    await screen.findByText("Shoreditch");
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reopen/i })).not.toBeInTheDocument();
  });

  it("names what closing costs before it closes anything", async () => {
    // The numbers are the damage: two dishes and one person, so the plural and the singular
    // are both exercised in the same assertion.
    renderPage();
    await screen.findByText("Shoreditch");
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(await screen.findByText(/2 dishes on trial/i)).toBeInTheDocument();
    expect(screen.getByText(/1 person/i)).toBeInTheDocument();
    expect(siteClosureImpact).toHaveBeenCalledWith("site-1");
    expect(closeSite).not.toHaveBeenCalled();
  });

  it("closes the site the person confirmed", async () => {
    renderPage();
    await screen.findByText("Shoreditch");
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /close the site/i }));
    expect(closeSite).toHaveBeenCalledWith("site-1");
  });

  it("closes nothing when the person backs out", async () => {
    renderPage();
    await screen.findByText("Shoreditch");
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /leave it open/i }));
    expect(closeSite).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("shows a closed site as closed and offers Reopen rather than Close", async () => {
    vi.mocked(listSites).mockResolvedValue([
      { id: "site-1", org_id: "org-1", name: "Shoreditch", closed_at: "2026-01-01T00:00:00Z" },
    ]);
    renderPage();
    await screen.findByText(/Shoreditch/);
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/does not bring back the dishes or the people/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reopen/i }));
    expect(reopenSite).toHaveBeenCalledWith("site-1");
  });

  it("shows a refusal verbatim", async () => {
    vi.mocked(closeSite).mockRejectedValue(new Error("KIT01: only an owner may close a site"));
    renderPage();
    await screen.findByText("Shoreditch");
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /close the site/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "KIT01: only an owner may close a site",
    );
  });
});
