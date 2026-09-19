import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import MealPlanDetail from "./MealPlanDetail";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "me" } }),
}));
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([{ id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "list", is_shared: false, checked_items: [], created_at: "", updated_at: "" }]),
  listItems: vi.fn().mockResolvedValue([]),
  addRecipe: vi.fn(), removeItem: vi.fn(), setViewMode: vi.fn(),
}));
vi.mock("../lib/api/recipes", () => ({ listRecipes: vi.fn().mockResolvedValue([]) }));
vi.mock("../components/GroceryPanel", () => ({ default: () => <div>grocery</div> }));

test("shows the plan name and a view toggle", async () => {
  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: /this week/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /calendar view|list view/i })).toBeInTheDocument();
});
