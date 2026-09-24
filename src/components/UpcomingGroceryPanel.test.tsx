import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import UpcomingGroceryPanel from "./UpcomingGroceryPanel";

vi.mock("../lib/api/mealPlans", () => ({
  getUpcomingGroceryList: vi.fn().mockResolvedValue({
    lines: [
      { key: "onion", name: "Onion", contributions: [{ quantity: "2", unit: null, recipeTitle: "Dal", scaled: false }], checked: false, manual: false, totals: [{ quantity: "2", unit: "" }], partial: false, staple: false, category: "Produce" },
      { key: "mystery", name: "Mystery sauce", contributions: [{ quantity: "1", unit: "jar", recipeTitle: "Dal", scaled: false }], checked: false, manual: false, totals: [{ quantity: "1", unit: "jar" }], partial: false, staple: false, category: null },
    ],
    planIds: ["p1"],
  }),
  toggleCheckedAcross: vi.fn(),
}));

test("groups lines under their aisle, with a null category under Other", async () => {
  render(<UpcomingGroceryPanel days={4} />);
  expect(await screen.findByText("Onion")).toBeInTheDocument();
  expect(screen.getByText("Produce")).toBeInTheDocument();
  expect(screen.getByText("Other")).toBeInTheDocument();
  expect(screen.getByText("Mystery sauce")).toBeInTheDocument();
});

test("staple lines sit under Check you have these, not their aisle", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getUpcomingGroceryList as any).mockResolvedValue({
    lines: [
      { key: "onion", name: "Onion", contributions: [{ quantity: "2", unit: null, recipeTitle: "Dal", scaled: false }], checked: false, manual: false, totals: [{ quantity: "2", unit: "" }], partial: false, staple: false, category: "Produce" },
      { key: "salt", name: "Salt", contributions: [{ quantity: "1", unit: "teaspoon", recipeTitle: "Dal", scaled: false }], checked: false, manual: false, totals: [{ quantity: "1", unit: "teaspoon" }], partial: false, staple: true, category: "Spices" },
    ],
    planIds: ["p1"],
  });
  render(<UpcomingGroceryPanel days={4} />);
  expect(await screen.findByText("Salt")).toBeInTheDocument();
  expect(screen.getByText("Check you have these (1)")).toBeInTheDocument();
  expect(screen.queryByText("Spices")).toBeNull();
});

test("ticking a line toggles it across the panel's plans", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.getUpcomingGroceryList as any).mockResolvedValue({
    lines: [
      { key: "onion", name: "Onion", contributions: [{ quantity: "2", unit: null, recipeTitle: "Dal", scaled: false }], checked: false, manual: false, totals: [{ quantity: "2", unit: "" }], partial: false, staple: false, category: "Produce" },
    ],
    planIds: ["p1", "p2"],
  });
  render(<UpcomingGroceryPanel days={4} />);
  fireEvent.click(await screen.findByRole("checkbox"));
  expect(mp.toggleCheckedAcross).toHaveBeenCalledWith(["p1", "p2"], "onion", true);
});
