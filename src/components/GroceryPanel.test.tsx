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
