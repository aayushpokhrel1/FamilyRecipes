import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DishDetail from "./DishDetail";
import {
  getDish, listVersions, getVersion, menuVersionId, listDeviations, getSnapshot,
} from "../../lib/api/kitchen/dishes";
import { listSites, listStaff, myRole } from "../../lib/api/kitchen/orgs";

vi.mock("../../lib/api/kitchen/dishes", () => ({
  getDish: vi.fn(), listVersions: vi.fn(), getVersion: vi.fn(), menuVersionId: vi.fn(),
  listDeviations: vi.fn(), getSnapshot: vi.fn(), reviseDish: vi.fn(), sendToTrial: vi.fn(),
  signOff: vi.fn(), recordDeviation: vi.fn(), publishDish: vi.fn(), unpublishDish: vi.fn(),
}));
vi.mock("../../lib/api/kitchen/orgs", () => ({
  listSites: vi.fn(), myRole: vi.fn(), listStaff: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/orgs/o1/dishes/d1"]}>
      <Routes>
        <Route path="/orgs/:id/dishes/:dishId" element={<DishDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(myRole).mockResolvedValue("chef");
  vi.mocked(listSites).mockResolvedValue([{ id: "s1", org_id: "o1", name: "Shoreditch", closed_at: null }]);
  // The page reads the roster to find the VIEWER's own site, which is what decides
  // whether a site manager may record a deviation here.
  vi.mocked(listStaff).mockResolvedValue([
    { user_id: "u1", role: "chef", site_id: null, display_name: "Ada" },
  ]);
  vi.mocked(getDish).mockResolvedValue({
    id: "d1", org_id: "o1", title: "Smoked onion tart", stage: "menu", trial_site_id: null,
    retired_at: null,
  });
  vi.mocked(listVersions).mockResolvedValue([
    { id: "v2", n: 2, note: "more salt", created_by: "u1", created_at: "2026-10-11T10:00:00Z" },
    { id: "v1", n: 1, note: "first pass", created_by: "u1", created_at: "2026-10-10T10:00:00Z" },
  ]);
  vi.mocked(menuVersionId).mockResolvedValue("v1");
  vi.mocked(getVersion).mockResolvedValue({
    ingredients: [{ position: 1, quantity: "2", unit: null, item: "onions", section: null }],
    steps: [{ position: 1, text: "Smoke the onions." }],
  });
  vi.mocked(listDeviations).mockResolvedValue([]);
  vi.mocked(getSnapshot).mockResolvedValue(null);
});

describe("the dish page", () => {
  it("names the dish and the stage it is at", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Smoked onion tart" })).toBeInTheDocument();
    expect(screen.getByText(/on the menu/i)).toBeInTheDocument();
  });

  it("says which version the sites are cooking when it is NOT the newest", async () => {
    // The rule the whole product sells: a dish revised after sign-off keeps the approved
    // version live. Showing version 2 as live here would tell three kitchens to cook
    // something nobody signed off.
    renderPage();
    expect(await screen.findByText(/sites are cooking version 1/i)).toBeInTheDocument();
    expect(screen.getByText(/version 2 is not signed off/i)).toBeInTheDocument();
  });

  it("lists every version with its note, newest first", async () => {
    renderPage();
    expect(await screen.findByText(/more salt/)).toBeInTheDocument();
    expect(screen.getByText(/first pass/)).toBeInTheDocument();
  });

  it("shows the ingredients and steps of the version it is displaying", async () => {
    renderPage();
    // Exact strings, not /onions/: that also matches "Smoke the onions." A chef sees each
    // line TWICE, once in the read-only list and once in the editor below it, so the step
    // assertion counts rather than demanding one match.
    expect(await screen.findByText("2 onions")).toBeInTheDocument();
    expect(screen.getAllByText("Smoke the onions.").length).toBeGreaterThan(0);
  });

  it("shows the version the SITES ARE COOKING in the read-only part, not the newest", async () => {
    // Found in a browser on 2026-10-11: the page said "the sites are cooking version 1" and
    // then listed version 2's ingredients underneath it. A site manager or a cook reading
    // that page is the person who actually cooks the dish, and they were being shown
    // quantities nobody had signed off.
    vi.mocked(getVersion).mockImplementation(async (versionId: string) =>
      versionId === "v1"
        ? {
            ingredients: [
              { position: 1, quantity: "2", unit: null, item: "onions", section: null },
            ],
            steps: [{ position: 1, text: "Smoke the onions." }],
          }
        : {
            ingredients: [
              { position: 1, quantity: "3", unit: null, item: "onions", section: null },
            ],
            steps: [{ position: 1, text: "Smoke them longer." }],
          },
    );
    renderPage();
    expect(await screen.findByText("2 onions")).toBeInTheDocument();
    // The newest version's quantity appears only inside the editor's inputs, which carry it
    // as a value rather than as text, so nobody reads it as the dish.
    expect(screen.queryByText("3 onions")).not.toBeInTheDocument();
  });

  it("renders a dish with no ingredients at all rather than crashing", async () => {
    // revise_dish accepts an empty list, so this state is reachable.
    vi.mocked(getVersion).mockResolvedValue({ ingredients: [], steps: [] });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Smoked onion tart" })).toBeInTheDocument();
  });

  it("says not found when the viewer's role may not read the dish", async () => {
    // Hiding a link is not a guard. A cook who types the URL gets no row back, and that has
    // to read as "not found" rather than a blank page or a crash.
    vi.mocked(getDish).mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText(/no dish here/i)).toBeInTheDocument();
  });

  it("offers a chef the revise form and a cook none", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /save a new version/i })).toBeInTheDocument();
  });

  it("hides the revise form from a cook", async () => {
    vi.mocked(myRole).mockResolvedValue("cook");
    renderPage();
    await screen.findByRole("heading", { name: "Smoked onion tart" });
    expect(screen.queryByRole("button", { name: /save a new version/i })).not.toBeInTheDocument();
  });
});
