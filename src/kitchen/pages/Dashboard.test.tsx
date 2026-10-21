import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import { myOrgs } from "../../lib/api/kitchen/orgs";
import { myGroupNumbers } from "../../lib/api/kitchen/numbers";

vi.mock("../../lib/api/kitchen/orgs", () => ({ myOrgs: vi.fn() }));
vi.mock("../../lib/api/kitchen/numbers", () => ({ myGroupNumbers: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(myGroupNumbers).mockResolvedValue({});
});

describe("the dashboard", () => {
  it("offers a way forward to someone who belongs to no org at all", async () => {
    // The dead end this project already shipped once: a brand-new account where every page
    // keys off something they do not have yet, so nothing works and nothing says why (0032).
    vi.mocked(myOrgs).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("link", { name: /start a kitchen group/i })).toBeInTheDocument();
  });

  it("lists the orgs a person is staff of", async () => {
    vi.mocked(myOrgs).mockResolvedValue([
      { id: "org-1", name: "Enamel Group" },
      { id: "org-2", name: "Second Group" },
    ]);
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Enamel Group")).toBeInTheDocument();
    expect(screen.getByText("Second Group")).toBeInTheDocument();
  });

  it("says so, rather than showing an empty page, when the read fails", async () => {
    vi.mocked(myOrgs).mockRejectedValue(new Error("The schema must be one of the following"));
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/schema must be one of/i);
  });

  it("shows a strip for a group the cook runs", async () => {
    vi.mocked(myOrgs).mockResolvedValue([{ id: "org-1", name: "Enamel Group" }]);
    vi.mocked(myGroupNumbers).mockResolvedValue({
      "org-1": { started: 4, landed: 1, median_days: 12.5 },
    });
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/1 of 4 dishes signed off, median 12.5 days/i)).toBeInTheDocument();
  });

  it("shows no strip for a group they do not run", async () => {
    // my_group_numbers has no key for a group the caller is not owner or chef of, and the
    // page must not invent a zero for it.
    vi.mocked(myOrgs).mockResolvedValue([{ id: "org-1", name: "Enamel Group" }]);
    vi.mocked(myGroupNumbers).mockResolvedValue({});
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    await screen.findByText("Enamel Group");
    expect(screen.queryByText(/signed off/i)).toBeNull();
    expect(screen.queryByText(/no dishes yet/i)).toBeNull();
  });

  it("a group with no dishes gets a sentence, not three zeros", async () => {
    vi.mocked(myOrgs).mockResolvedValue([{ id: "org-1", name: "Enamel Group" }]);
    vi.mocked(myGroupNumbers).mockResolvedValue({
      "org-1": { started: 0, landed: 0, median_days: null },
    });
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no dishes yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
  });

  it("a failed numbers call still renders the groups", async () => {
    // The links are the function and the figures are decoration, so losing the figures must
    // not cost the navigation.
    vi.mocked(myOrgs).mockResolvedValue([{ id: "org-1", name: "Enamel Group" }]);
    vi.mocked(myGroupNumbers).mockRejectedValue(new Error("The schema must be one of the following"));
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Enamel Group")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /dishes/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
