import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Numbers from "./Numbers";
import { groupNumbers, groupPeople } from "../../lib/api/kitchen/numbers";
import type { GroupNumbers, GroupPeople } from "../../lib/api/kitchen/types";

vi.mock("../../lib/api/kitchen/numbers", () => ({ groupNumbers: vi.fn(), groupPeople: vi.fn() }));

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

const people: GroupPeople = {
  staff: [
    {
      user_id: "user-1",
      display_name: "Ada",
      role: "chef",
      site_name: "Shoreditch",
      days_back: 5,
      of_days: 7,
      last_seen: "2026-10-01T00:00:00Z",
      never: false,
    },
  ],
  invites: { issued: 4, used: 2, open: 1, aged_out: 1 },
  closed_sites: 1,
  retired_dishes: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(groupNumbers).mockResolvedValue(full);
  vi.mocked(groupPeople).mockResolvedValue(people);
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

  it("names somebody who has never opened it", async () => {
    vi.mocked(groupPeople).mockResolvedValue({
      ...people,
      staff: [{ ...people.staff[0], never: true, last_seen: null, days_back: 0 }],
    });
    renderPage();
    expect(await screen.findByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByText(/have not opened it yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/back 0 of/i)).toBeNull();
  });

  it("prints the denominator it was given, not seven", async () => {
    vi.mocked(groupPeople).mockResolvedValue({
      ...people,
      staff: [{ ...people.staff[0], days_back: 2, of_days: 3 }],
    });
    renderPage();
    expect(await screen.findByText(/back 2 of 3 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/of 7 days/i)).toBeNull();
    expect(screen.getByText(/4 invites issued, 2 used, 1 open, 1 aged out unused/i)).toBeInTheDocument();
    expect(screen.getByText(/1 closed sites, 2 retired dishes/i)).toBeInTheDocument();
  });

  it("shows no people block when the reader is not the owner", async () => {
    vi.mocked(groupPeople).mockResolvedValue(null);
    renderPage();
    await screen.findByText(/1 of 4 dishes signed off/i);
    expect(screen.queryByText(/seen by the group's owner only/i)).toBeNull();
    expect(screen.queryByText(/Ada/)).toBeNull();
  });

  it("still shows the figures when the people call fails", async () => {
    vi.mocked(groupPeople).mockRejectedValue(new Error("KIT02: not yours"));
    renderPage();
    expect(await screen.findByText(/1 of 4 dishes signed off/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/seen by the group's owner only/i)).toBeNull();
  });
});
