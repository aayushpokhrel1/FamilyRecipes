import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import GroceryPanel from "./GroceryPanel";

// The panel links to /kitchen/cupboard, so it needs a router in the tree.
function renderPanel() {
  return render(<MemoryRouter><GroceryPanel planId="p1" /></MemoryRouter>);
}

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" } }),
}));
vi.mock("../lib/api/pantry", () => ({
  listPantry: vi.fn().mockResolvedValue([]),
  addItem: vi.fn(),
  removeItem: vi.fn(),
}));
vi.mock("../lib/api/mealPlans", () => ({
  getGroceryList: vi.fn().mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [{ quantity: "2", unit: "cups", recipeTitle: "Bread", scaled: false }], checked: false, manual: false, totals: [{ quantity: "2", unit: "cup" }], partial: false, staple: false },
  ]),
  toggleChecked: vi.fn(),
  addManualItem: vi.fn(),
  removeManualItem: vi.fn(),
}));

test("renders a grocery line with its source recipe", async () => {
  renderPanel();
  expect(await screen.findByText(/Flour/)).toBeInTheDocument();
  expect(screen.getByText(/Bread/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeInTheDocument();
});

test("shows the summed total as the line headline", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [{ quantity: "2", unit: "cups", recipeTitle: "Bread", scaled: false }], checked: false, manual: false, totals: [{ quantity: "3", unit: "cup" }], partial: false },
  ]);
  renderPanel();
  expect(await screen.findByText("3 cup")).toBeInTheDocument();
});

test("marks a partial line as mixed units", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [{ quantity: "1", unit: "cup", recipeTitle: "Bread", scaled: false }], checked: false, manual: false, totals: [{ quantity: "1", unit: "cup" }, { quantity: "500", unit: "g" }], partial: true },
  ]);
  renderPanel();
  expect(await screen.findByText("mixed units")).toBeInTheDocument();
});

test("does not say mixed units when a single contribution just cannot be measured", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "saffron", name: "Saffron", contributions: [{ quantity: "a pinch", unit: null, recipeTitle: "Dal", scaled: false }], checked: false, manual: false, totals: [], partial: true },
  ]);
  renderPanel();
  expect(await screen.findByText("Saffron")).toBeInTheDocument();
  expect(screen.queryByText("mixed units")).toBeNull();
});

test("marks an unscaled contribution on an otherwise scaled line", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [
      { quantity: "4", unit: "cups", recipeTitle: "Bread", scaled: true },
      { quantity: "a pinch", unit: null, recipeTitle: "Soup", scaled: false },
    ], checked: false, manual: false, totals: [{ quantity: "4", unit: "cup" }], partial: true, staple: false },
  ]);
  renderPanel();
  expect(await screen.findByText("unscaled")).toBeInTheDocument();
});

test("staple lines sit behind the check-you-have-these group", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "lentils", name: "Lentils", contributions: [{ quantity: "2", unit: "cup", recipeTitle: "Dal", scaled: false }], checked: false, manual: false, totals: [{ quantity: "2", unit: "cup" }], partial: false, staple: false },
    { key: "salt", name: "Salt", contributions: [{ quantity: "1", unit: "teaspoon", recipeTitle: "Dal", scaled: false }], checked: false, manual: false, totals: [{ quantity: "1", unit: "teaspoon" }], partial: false, staple: true },
  ]);
  renderPanel();
  expect(await screen.findByText("Lentils")).toBeInTheDocument();
  expect(screen.getByText("Check you have these (1)")).toBeInTheDocument();
  expect(screen.getByText("Salt")).toBeInTheDocument();
});

// The staples editor deliberately moved to /kitchen/cupboard so there is one
// place to change the cupboard. What this panel owes the user now is a way to
// get there.
test("links to the cupboard instead of editing it here", async () => {
  renderPanel();
  const link = await screen.findByRole("link", { name: /cupboard/i });
  expect(link).toHaveAttribute("href", "/kitchen/cupboard");
  expect(screen.queryByPlaceholderText("Add a staple")).not.toBeInTheDocument();
});

test("offers to put checked items in the cupboard", async () => {
  const mp = await import("../lib/api/mealPlans");
  const pantry = await import("../lib/api/pantry");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "rice", name: "Rice", contributions: [{ quantity: "2", unit: "cups", recipeTitle: "Pilaf", scaled: false }], checked: true, manual: false, totals: [{ quantity: "2", unit: "cup" }], partial: false, staple: false },
  ]);
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: /Put 1 item in the cupboard/i }));
  await waitFor(() => expect(pantry.addItem).toHaveBeenCalledWith("f1", "Rice", "week"));
});