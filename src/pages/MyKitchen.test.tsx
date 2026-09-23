import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import MyKitchen from "./MyKitchen";
import { today } from "../lib/dates";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" } }),
}));
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([]),
  createPlan: vi.fn(), renamePlan: vi.fn(), deletePlan: vi.fn(), setShared: vi.fn(),
  listUpcoming: vi.fn().mockResolvedValue([]),
}));

test("renders the My Kitchen heading and a create control", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: /my kitchen/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /new plan/i })).toBeInTheDocument();
});

test("says nothing is planned when up next is empty", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByText("Nothing planned yet.")).toBeInTheDocument();
});

test("shows today's dinner with its plan name and a cook link", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listUpcoming as any).mockResolvedValue([
    {
      id: "i1", day: today(), meal_slot: "dinner", servings: 4,
      recipe: { id: "r1", title: "Chicken adobo", servings: 2 },
      plan: { id: "p1", name: "Week of" },
      isLeftover: false, readOnly: true,
    },
  ]);
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByText("Chicken adobo")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  expect(screen.getByText("Week of")).toBeInTheDocument();
  expect(screen.getByText("shared")).toBeInTheDocument();
  expect(screen.getByText("4 servings")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Cook" })).toHaveAttribute("href", "/recipes/r1/cook");
});
