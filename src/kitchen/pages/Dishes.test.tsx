import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Dishes from "./Dishes";
import { listDishes, createDish } from "../../lib/api/kitchen/dishes";
import { myRole } from "../../lib/api/kitchen/orgs";

vi.mock("../../lib/api/kitchen/dishes", () => ({ listDishes: vi.fn(), createDish: vi.fn() }));
vi.mock("../../lib/api/kitchen/orgs", () => ({ myRole: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/orgs/o1/dishes"]}>
      <Routes>
        <Route path="/orgs/:id/dishes" element={<Dishes />} />
        <Route path="/orgs/:id/dishes/:dishId" element={<p>the dish page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(myRole).mockResolvedValue("chef");
  vi.mocked(listDishes).mockResolvedValue([
    { id: "d1", org_id: "o1", title: "Smoked onion tart", stage: "development", trial_site_id: null },
    { id: "d2", org_id: "o1", title: "House bread", stage: "menu", trial_site_id: null },
  ]);
});

describe("the dish list", () => {
  it("shows each dish with the stage it is at", async () => {
    renderPage();
    expect(await screen.findByText("Smoked onion tart")).toBeInTheDocument();
    expect(screen.getByText(/in development/i)).toBeInTheDocument();
    expect(screen.getByText(/on the menu/i)).toBeInTheDocument();
  });

  it("offers a chef the form to start one", async () => {
    renderPage();
    expect(await screen.findByLabelText(/new dish/i)).toBeInTheDocument();
  });

  it("does NOT offer a cook that form, because the database would refuse them", async () => {
    vi.mocked(myRole).mockResolvedValue("cook");
    renderPage();
    await screen.findByText("Smoked onion tart");
    expect(screen.queryByLabelText(/new dish/i)).not.toBeInTheDocument();
  });

  it("tells a cook with nothing to read why the list is empty", async () => {
    // A cook sees nothing until a dish reaches the menu. An empty page with no explanation
    // reads as broken, and this is the state most new staff will meet first.
    vi.mocked(myRole).mockResolvedValue("cook");
    vi.mocked(listDishes).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/nothing on the menu yet/i)).toBeInTheDocument();
  });

  it("creates a dish and goes straight to it", async () => {
    vi.mocked(createDish).mockResolvedValue("d3");
    renderPage();
    await userEvent.type(await screen.findByLabelText(/new dish/i), "Pickled walnuts");
    await userEvent.click(screen.getByRole("button", { name: /start the dish/i }));
    expect(createDish).toHaveBeenCalledWith("o1", "Pickled walnuts");
    expect(await screen.findByText("the dish page")).toBeInTheDocument();
  });

  it("shows the database's refusal rather than swallowing it", async () => {
    vi.mocked(createDish).mockRejectedValue(new Error("only an owner or a chef may start a dish"));
    renderPage();
    await userEvent.type(await screen.findByLabelText(/new dish/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /start the dish/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only an owner or a chef");
  });
});
