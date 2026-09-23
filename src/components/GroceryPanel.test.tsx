import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import GroceryPanel from "./GroceryPanel";

vi.mock("../lib/api/mealPlans", () => ({
  getGroceryList: vi.fn().mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [{ quantity: "2", unit: "cups", recipeTitle: "Bread", scaled: false }], checked: false, manual: false, totals: [{ quantity: "2", unit: "cup" }], partial: false },
  ]),
  toggleChecked: vi.fn(),
  addManualItem: vi.fn(),
  removeManualItem: vi.fn(),
}));

test("renders a grocery line with its source recipe", async () => {
  render(<GroceryPanel planId="p1" />);
  expect(await screen.findByText(/Flour/)).toBeInTheDocument();
  expect(screen.getByText(/Bread/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeInTheDocument();
});

test("shows the summed total as the line headline", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [{ quantity: "2", unit: "cups", recipeTitle: "Bread", scaled: false }], checked: false, manual: false, totals: [{ quantity: "3", unit: "cup" }], partial: false },
  ]);
  render(<GroceryPanel planId="p1" />);
  expect(await screen.findByText("3 cup")).toBeInTheDocument();
});

test("marks a partial line as mixed units", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [{ quantity: "1", unit: "cup", recipeTitle: "Bread", scaled: false }], checked: false, manual: false, totals: [{ quantity: "1", unit: "cup" }, { quantity: "500", unit: "g" }], partial: true },
  ]);
  render(<GroceryPanel planId="p1" />);
  expect(await screen.findByText("mixed units")).toBeInTheDocument();
});

test("marks an unscaled contribution on an otherwise scaled line", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getGroceryList as any).mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [
      { quantity: "4", unit: "cups", recipeTitle: "Bread", scaled: true },
      { quantity: "a pinch", unit: null, recipeTitle: "Soup", scaled: false },
    ], checked: false, manual: false, totals: [{ quantity: "4", unit: "cup" }], partial: true },
  ]);
  render(<GroceryPanel planId="p1" />);
  expect(await screen.findByText("unscaled")).toBeInTheDocument();
});
