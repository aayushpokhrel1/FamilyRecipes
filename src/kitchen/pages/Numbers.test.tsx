import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Numbers from "./Numbers";
import { groupNumbers } from "../../lib/api/kitchen/numbers";
import type { GroupNumbers } from "../../lib/api/kitchen/types";

vi.mock("../../lib/api/kitchen/numbers", () => ({ groupNumbers: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/orgs/org-1/numbers"]}>
      <Routes>
        <Route path="/orgs/:id/numbers" element={<Numbers />} />
      </Routes>
    </MemoryRouter>,
  );
}

const full: GroupNumbers = {
  dishes: {
    started: 4,
    landed: 1,
    median_days: 12.5,
    slow: [{ id: "dish-9", title: "Brown butter tart", days: 47 }],
  },
  funnel: { dishes: 4, with_version: 3, trialled: 2, landed: 1, on_menu: 1 },
  sites: [
    {
      id: "site-1",
      name: "Shoreditch",
      substitutions: 3,
      trials: 2,
      last_recorded: "2026-10-01T00:00:00Z",
      added: "2026-01-05T00:00:00Z",
      closed: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(groupNumbers).mockResolvedValue(full);
});

describe("the numbers page", () => {
  it("shows the three figures and the funnel", async () => {
    renderPage();
    expect(await screen.findByText(/1 of 4 dishes signed off/i)).toBeInTheDocument();
    expect(screen.getByText(/median dish takes 12.5 days/i)).toBeInTheDocument();
    expect(screen.getByText(/1 dish in development for over a month/i)).toBeInTheDocument();
    expect(
      screen.getByText(/4 dishes created, 3 with a version, 2 trialled, 1 signed off, 1 on a menu/i),
    ).toBeInTheDocument();
  });

  it("names each slow dish and links to it", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: "Brown butter tart" });
    expect(link).toHaveAttribute("href", "/orgs/org-1/dishes/dish-9");
    expect(screen.getByText(/47 days/i)).toBeInTheDocument();
  });

  it("says a site has recorded nothing, and when it was added", async () => {
    vi.mocked(groupNumbers).mockResolvedValue({
      ...full,
      sites: [{ ...full.sites[0], last_recorded: null }],
    });
    renderPage();
    expect(await screen.findByText(/nothing recorded since it was added on/i)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(new Date("2026-01-05T00:00:00Z").toLocaleDateString())),
    ).toBeInTheDocument();
  });

  it("a group with no dishes says so instead of showing zeros", async () => {
    vi.mocked(groupNumbers).mockResolvedValue({
      dishes: { started: 0, landed: 0, median_days: null, slow: [] },
      funnel: { dishes: 0, with_version: 0, trialled: 0, landed: 0, on_menu: 0 },
      sites: [],
    });
    renderPage();
    expect(await screen.findByText(/has not started a dish yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
    expect(screen.queryByText(/dishes created/)).toBeNull();
    expect(screen.queryByText(/Does a dish land/i)).toBeNull();
  });

  it("a reader who is not served gets the not-for-you note, not an empty page", async () => {
    vi.mocked(groupNumbers).mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText(/only an owner or a chef sees a group's numbers/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error when the call fails", async () => {
    vi.mocked(groupNumbers).mockRejectedValue(new Error("KIT01: not yours"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("KIT01: not yours");
  });

  it("renders nothing from the people block", async () => {
    // The design deliberately leaves out whether a person comes back: it needs storage this
    // schema does not have yet, so the page must not imply it is being measured.
    renderPage();
    await screen.findByText(/1 of 4 dishes signed off/i);
    expect(screen.queryByText(/never opened/i)).toBeNull();
  });
});
