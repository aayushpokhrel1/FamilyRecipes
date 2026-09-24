import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import MyKitchen from "./MyKitchen";
import { addDays, dayLabel, today } from "../lib/dates";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" } }),
}));
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([]),
  createPlan: vi.fn(), renamePlan: vi.fn(), deletePlan: vi.fn(), setShared: vi.fn(),
  listUpcoming: vi.fn().mockResolvedValue([]),
  setPlanDates: vi.fn(), setViewMode: vi.fn(),
  duplicatePlan: vi.fn(),
  getUpcomingGroceryList: vi.fn().mockResolvedValue({ lines: [], planIds: [] }),
  toggleCheckedAcross: vi.fn(),
}));
vi.mock("../lib/api/photos", () => ({
  getCoverPhotoUrl: vi.fn().mockResolvedValue(null),
}));
vi.mock("../lib/api/pantry", () => ({
  listPantry: vi.fn().mockResolvedValue([]),
}));
vi.mock("../lib/api/cookLog", () => ({
  notCookedLately: vi.fn().mockResolvedValue([]),
}));

// The pantry mock is shared across tests, so a test that queues a one-shot
// value has to hand the default back or it leaks into the next one.
async function resetPantry() {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValue([]);
}

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
  // Twice on purpose: once in the hero spotlight, once in its own day row.
  expect(await screen.findAllByText("Chicken adobo")).toHaveLength(2);
  expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  expect(screen.getByText("Week of")).toBeInTheDocument();
  expect(screen.getByText("shared")).toBeInTheDocument();
  expect(screen.getByText("4 servings")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Cook" })).toHaveAttribute("href", "/recipes/r1/cook");
  (mp.listUpcoming as any).mockResolvedValue([]);
});

test("heroes the next item up with a cook link", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listUpcoming as any).mockResolvedValue([
    {
      id: "i1", day: today(), meal_slot: "dinner", servings: 4,
      recipe: { id: "r1", title: "Chicken adobo", servings: 2 },
      plan: { id: "p1", name: "Week of" },
      isLeftover: false, readOnly: false,
    },
  ]);
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "Chicken adobo" })).toBeInTheDocument();
  expect(screen.getByText("Today · dinner")).toBeInTheDocument();
  expect(screen.getByText("4 servings · Week of")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Cook this" })).toHaveAttribute("href", "/recipes/r1/cook");
  (mp.listUpcoming as any).mockResolvedValue([]);
});

test("repeats the last finished week onto today", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listPlans as any).mockResolvedValue([
    {
      id: "p0", owner_id: "u1", family_id: "f1", name: "Last week",
      view_mode: "calendar", is_shared: false, checked_items: [],
      start_date: addDays(today(), -7), length_days: 7,
      created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
    },
  ]);
  (mp.duplicatePlan as any).mockResolvedValue("p9");
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Repeat last week" }));
  expect(mp.duplicatePlan).toHaveBeenCalledWith("p0", today());
  (mp.listPlans as any).mockResolvedValue([]);
});

test("does not offer to repeat when a plan already covers the window", async () => {
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
  expect(await screen.findByRole("link", { name: `Add something on ${dayLabel(today())}` }))
    .toHaveAttribute("href", `/kitchen/p1?day=${today()}&slot=dinner`);
  expect(screen.queryByRole("button", { name: "Repeat last week" })).not.toBeInTheDocument();
  (mp.listPlans as any).mockResolvedValue([]);
});

test("links today's empty day to the covering plan", async () => {
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
  expect(await screen.findByRole("link", { name: `Add something on ${dayLabel(today())}` }))
    .toHaveAttribute("href", `/kitchen/p1?day=${today()}&slot=dinner`);
  (mp.listPlans as any).mockResolvedValue([]);
});

test("lists recipes not made in a while with their last-cooked labels", async () => {
  const cl = await import("../lib/api/cookLog");
  (cl.notCookedLately as any).mockResolvedValue([
    { recipe: { id: "r1", title: "Dal" }, lastCooked: "2026-03-04T12:00:00Z" },
    { recipe: { id: "r2", title: "Biryani" }, lastCooked: null },
  ]);
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "Not made in a while" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dal" })).toHaveAttribute("href", "/recipes/r1");
  expect(screen.getByText("last made March 2026")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Biryani" })).toHaveAttribute("href", "/recipes/r2");
  expect(screen.getByText("never cooked")).toBeInTheDocument();
  (cl.notCookedLately as any).mockResolvedValue([]);
});

test("summarises the cupboard with something worth acting on", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValueOnce([
    { id: "1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
    { id: "2", key: "oil", label: "Oil", kind: "keep", state: "low", expires_on: null },
    { id: "3", key: "cumin", label: "Cumin", kind: "keep", state: "out", expires_on: null },
  ]);
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByText(/2 to restock/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /cupboard/i })).toHaveAttribute("href", "/kitchen/cupboard");
  await resetPantry();
});

// A cupboard nobody is short of anything in still has to say something, and
// "All stocked" is the thing worth saying.
test("says all stocked when nothing needs buying", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValueOnce([
    { id: "1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
  ]);
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByText(/All stocked/i)).toBeInTheDocument();
});

// The cupboard summary is the only link to /kitchen/cupboard on this page, so
// an empty cupboard must still offer the way in.
test("still links to the cupboard when it is empty", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByText("Nothing in yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Set up the cupboard" }))
    .toHaveAttribute("href", "/kitchen/cupboard");
});

// With no plan covering the days, the day blocks render nothing at all: no
// heading, no slot label rows.
test("renders no slot rows when no plan covers the days", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  await screen.findByRole("button", { name: "Start this week" });
  expect(screen.queryByText("breakfast")).not.toBeInTheDocument();
  expect(screen.queryByText("lunch")).not.toBeInTheDocument();
  expect(screen.queryByText("dinner")).not.toBeInTheDocument();
});

// Only PEEK_DAYS day headings render by default; the control reveals the rest.
test("peeks at two days and reveals the rest on demand", async () => {
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
  expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Tomorrow" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: dayLabel(addDays(today(), 2)) })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show 2 more days" }));
  expect(screen.getByRole("heading", { name: dayLabel(addDays(today(), 2)) })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: dayLabel(addDays(today(), 3)) })).toBeInTheDocument();
  (mp.listPlans as any).mockResolvedValue([]);
});

// With no plan at all, every day renders nothing, so "Show 2 more days" was a
// button that visibly did nothing. Found by pressing it.
test("does not offer to show more days when there is nothing to show", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  await screen.findByRole("button", { name: "Start this week" });
  expect(screen.queryByRole("button", { name: /Show \d+ more days/ })).not.toBeInTheDocument();
});
