import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import { myOrgs } from "../../lib/api/kitchen/orgs";

vi.mock("../../lib/api/kitchen/orgs", () => ({ myOrgs: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

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
});
