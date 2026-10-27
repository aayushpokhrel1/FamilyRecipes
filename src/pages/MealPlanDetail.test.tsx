import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import MealPlanDetail from "./MealPlanDetail";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "me" } }),
}));
// WHO IS LOOKING decides what this page offers, because plans_read admits any family member of
// a SHARED plan while every write policy admits the owner alone. The fixtures below say "me",
// which matches the plan's owner_id: the ordinary case of a cook opening their own plan. There
// was no auth mock at all before, so every test here was silently running as a signed-out
// viewer and would have gone on passing with the whole page gated off.
const viewer = { userId: "me" };
vi.mock("../context/AuthContext", () => ({ useAuth: () => viewer }));
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([{ id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "list", is_shared: false, checked_items: [], created_at: "", updated_at: "" }]),
  listItems: vi.fn().mockResolvedValue([]),
  addRecipe: vi.fn(), removeItem: vi.fn(), moveItem: vi.fn(), setViewMode: vi.fn(), setItemServings: vi.fn(),
  setPlanDates: vi.fn(), duplicatePlan: vi.fn(),
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

test("renders per-item day and meal-slot controls for a scheduled item", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listItems as any).mockResolvedValue([
    { id: "it1", plan_id: "p1", recipe_id: "r1", day: "2026-09-20", meal_slot: "dinner", position: 0 },
  ]);
  const rc = await import("../lib/api/recipes");
  (rc.listRecipes as any).mockResolvedValue([
    { id: "r1", family_id: "f1", author_id: "me", title: "Pancakes", story: null, provenance: null,
      servings: null, prep_minutes: null, cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "" },
  ]);
  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByLabelText("day")).toHaveValue("2026-09-20");
  expect(screen.getByLabelText("meal slot")).toHaveValue("dinner");
});

const recipe = (servings: number | null) => ({
  id: "r1", family_id: "f1", author_id: "me", title: "Pancakes", story: null, provenance: null,
  servings, prep_minutes: null, cook_minutes: null, visibility: "family", source_url: null,
  created_at: "", updated_at: "",
});

test("disables the servings stepper when the recipe records no servings", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listItems as any).mockResolvedValue([
    { id: "it1", plan_id: "p1", recipe_id: "r1", day: null, meal_slot: null, position: 0, servings: null },
  ]);
  const rc = await import("../lib/api/recipes");
  (rc.listRecipes as any).mockResolvedValue([recipe(null)]);
  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );
  const increase = await screen.findByLabelText("increase");
  expect(increase).toBeDisabled();
  expect(increase).toHaveAttribute("title", "This recipe does not record how many it serves, so it cannot be scaled.");
});

test("incrementing the servings stepper calls setItemServings", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listItems as any).mockResolvedValue([
    { id: "it1", plan_id: "p1", recipe_id: "r1", day: null, meal_slot: null, position: 0, servings: null },
  ]);
  const rc = await import("../lib/api/recipes");
  (rc.listRecipes as any).mockResolvedValue([recipe(4)]);
  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );
  const increase = await screen.findByLabelText("increase");
  await waitFor(() => expect(increase).toBeEnabled());
  expect(screen.getByLabelText("portions value")).toHaveTextContent("4");
  fireEvent.click(increase);
  await waitFor(() => expect(mp.setItemServings).toHaveBeenCalledWith("it1", 5));
});

test("duplicating a dated plan starts the clone the day after its last day", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listPlans as any).mockResolvedValue([
    { id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "list", is_shared: false,
      checked_items: [], start_date: "2026-09-21", length_days: 7, created_at: "", updated_at: "" },
  ]);
  (mp.duplicatePlan as any).mockResolvedValue("p2");
  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );
  const button = await screen.findByRole("button", { name: /duplicate to next week/i });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(mp.duplicatePlan).toHaveBeenCalledWith("p1", "2026-09-28"));
});

test("the duplicate button is disabled for an open-ended plan", async () => {
  const mp = await import("../lib/api/mealPlans");
  (mp.listPlans as any).mockResolvedValue([
    { id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "list", is_shared: false,
      checked_items: [], start_date: null, length_days: 7, created_at: "", updated_at: "" },
  ]);
  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("button", { name: /duplicate to next week/i })).toBeDisabled();
});

// The pure resolver in planDrop.test.ts decides what a drop MEANS, but it cannot notice the
// integration exploding. This renders the real calendar grid with dnd-kit mounted, which is
// what caught the sensors being declared below an early return: the hooks ran conditionally,
// React unmounted the component, and the page rendered as an empty div.
test("the calendar grid mounts with a move grip on each scheduled meal", async () => {
  const mp = await import("../lib/api/mealPlans");
  const rp = await import("../lib/api/recipes");
  (mp.listPlans as any).mockResolvedValue([
    { id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "calendar",
      is_shared: false, checked_items: [], start_date: "2026-09-28", length_days: 3,
      created_at: "", updated_at: "" },
  ]);
  (rp.listRecipes as any).mockResolvedValue([{ id: "r1", title: "Dal", servings: 4 }]);
  (mp.listItems as any).mockResolvedValue([
    { id: "i1", plan_id: "p1", recipe_id: "r1", day: "2026-09-28", meal_slot: "dinner",
      position: 0, servings: null, leftover_of: null },
  ]);

  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("button", { name: /move dal/i })).toBeInTheDocument();
  // The tap-to-fill path must survive: dragging is an addition, never the only way in.
  expect(screen.getAllByRole("button", { name: /add to .* on /i }).length).toBeGreaterThan(0);
});

// A SHARED PLAN IS SHARED TO READ. This is the second time this app has offered controls the
// database would refuse: RecipeDetail's canEdit carries a comment about having shown a
// stranger a Delete. A refused write does not raise, it matches no rows and resolves, so
// Remove did nothing and the item came back on the next refresh with no explanation.
test("offers a relative viewing a shared plan nothing it cannot carry out", async () => {
  viewer.userId = "someone-else";
  const mp = await import("../lib/api/mealPlans");
  // listPlans is re-stated rather than inherited: an earlier test in this file leaves it
  // returning a CALENDAR plan, and in that view an item whose day is outside the date range
  // renders in no cell at all. The first version of this test passed alone and failed in the
  // file for that reason, which is a fixture inheriting a different test's world.
  (mp.listPlans as any).mockResolvedValue([
    { id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "list",
      is_shared: true, checked_items: [], created_at: "", updated_at: "" },
  ]);
  (mp.listItems as any).mockResolvedValue([
    { id: "it1", plan_id: "p1", recipe_id: "r1", day: "2026-09-20", meal_slot: "dinner", position: 0 },
  ]);
  const rc = await import("../lib/api/recipes");
  (rc.listRecipes as any).mockResolvedValue([
    { id: "r1", family_id: "f1", author_id: "me", title: "Pancakes", story: null, provenance: null,
      servings: 4, prep_minutes: null, cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "" },
  ]);
  try {
    render(
      <MemoryRouter initialEntries={["/kitchen/p1"]}>
        <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
      </MemoryRouter>,
    );

    // The plan itself is readable, and says so.
    expect(await screen.findByRole("heading", { name: /this week/i })).toBeInTheDocument();
    expect(screen.getByText(/only the cook who made this plan can change it/i)).toBeInTheDocument();

    // And every control that writes is gone.
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /increase|decrease/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("day")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("meal slot")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add recipe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /calendar view|list view/i })).not.toBeInTheDocument();

    // The portion count is still SHOWN, because it is information rather than a control: a
    // read-only page that hides what is for dinner would be a different bug.
    expect(screen.getByLabelText("portions value")).toBeInTheDocument();
  } finally {
    viewer.userId = "me";
  }
});

// AN ITEM WITH NO DAY IS INVISIBLE IN THE WEEK GRID, and the grocery list below it is not.
//
// "Add to plan" on a recipe page creates exactly that item: day and meal_slot null, so you can
// gather recipes before deciding when to cook them. In the calendar view it appeared nowhere,
// while the plan's own grocery list already listed its ingredients, and My Kitchen said there
// was nothing to buy because it filters by day. Three surfaces, three different answers about
// the same week. Found by walking a fresh account in a browser on 2026-10-26.
test("the calendar view says when a recipe is not on a day yet", async () => {
  const mp = await import("../lib/api/mealPlans");
  const rp = await import("../lib/api/recipes");
  (mp.listPlans as any).mockResolvedValue([
    { id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "calendar",
      is_shared: false, checked_items: [], start_date: "2026-09-28", length_days: 3,
      created_at: "", updated_at: "" },
  ]);
  (rp.listRecipes as any).mockResolvedValue([{ id: "r1", title: "Dal", servings: 4 }]);
  (mp.listItems as any).mockResolvedValue([
    { id: "i1", plan_id: "p1", recipe_id: "r1", day: null, meal_slot: null,
      position: 0, servings: null, leftover_of: null },
  ]);

  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByText(/1 recipe is not on a day yet/i)).toBeInTheDocument();
  // And the way out is one tap, not a hunt: the same control that switches to the list view,
  // which is where a day can actually be set.
  expect(screen.getByRole("button", { name: /put it on a day/i })).toBeInTheDocument();
});

test("the calendar view says nothing when every recipe has a day", async () => {
  const mp = await import("../lib/api/mealPlans");
  const rp = await import("../lib/api/recipes");
  (mp.listPlans as any).mockResolvedValue([
    { id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "calendar",
      is_shared: false, checked_items: [], start_date: "2026-09-28", length_days: 3,
      created_at: "", updated_at: "" },
  ]);
  (rp.listRecipes as any).mockResolvedValue([{ id: "r1", title: "Dal", servings: 4 }]);
  (mp.listItems as any).mockResolvedValue([
    { id: "i1", plan_id: "p1", recipe_id: "r1", day: "2026-09-28", meal_slot: "dinner",
      position: 0, servings: null, leftover_of: null },
  ]);

  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );

  await screen.findByRole("button", { name: /move dal/i });
  expect(screen.queryByText(/not on a day yet/i)).not.toBeInTheDocument();
});
