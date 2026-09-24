import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import MyKitchen from "./MyKitchen";
import { dayLabel, today } from "../lib/dates";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" } }),
}));
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([]),
  createPlan: vi.fn(), renamePlan: vi.fn(), deletePlan: vi.fn(), setShared: vi.fn(),
  listUpcoming: vi.fn().mockResolvedValue([]),
  setPlanDates: vi.fn(), setViewMode: vi.fn(),
}));

test("renders the My Kitchen heading and a create control", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: /my kitchen/i })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Plans"));
  expect(screen.getByRole("button", { name: /new plan/i })).toBeInTheDocument();
});

test("offers to start this week when up next is empty", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Start this week" })).toBeInTheDocument();
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

test("links today's empty breakfast slot to the covering plan", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listPlans as any).mockResolvedValue([
    {
      id: "p1", owner_id: "u1", family_id: "f1", name: "This week",
      view_mode: "calendar", is_shared: false, checked_items: [],
      start_date: today(), length_days: 7,
      created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
    },
  ]);
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByRole("link", { name: `Add breakfast on ${dayLabel(today())}` }))
    .toHaveAttribute("href", `/kitchen/p1?day=${today()}&slot=breakfast`);
});
