// src/lib/api/mealPlans.test.ts
import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { createPlan, toggleChecked, toggleCheckedAcross, getGroceryList } from "./mealPlans";

test("createPlan inserts with owner_id from the session", async () => {
  let payload: any;
  from.mockImplementation(() => ({
    insert: (p: any) => { payload = p; return { select: () => ({ single: () => ({ data: { id: "p1", ...p }, error: null }) }) }; },
  }));
  const plan = await createPlan("f1", "This week");
  expect(payload).toMatchObject({ owner_id: "me", family_id: "f1", name: "This week" });
  expect(plan.id).toBe("p1");
});

test("toggleChecked adds a key to checked_items", async () => {
  let updated: any;
  from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: () => ({ data: { checked_items: [] }, error: null }) }) }),
    update: (u: any) => { updated = u; return { eq: () => ({ error: null }) }; },
  }));
  await toggleChecked("p1", "flour", true);
  expect(updated.checked_items).toEqual(["flour"]);
});

test("toggleCheckedAcross calls through once per plan id", async () => {
  const touched: string[] = [];
  from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: () => ({ data: { checked_items: [] }, error: null }) }) }),
    update: () => ({ eq: (_col: string, id: string) => { touched.push(id); return { error: null }; } }),
  }));
  await toggleCheckedAcross(["p1", "p2"], "flour", true);
  expect(touched).toEqual(["p1", "p2"]);
});

test("getGroceryList scales each (recipe, servings) pair separately", async () => {
  // recipe serves 4; one item targets 8 (factor 2), the other leaves it alone
  // so the flour line carries a scaled 4 cups and an unscaled 2 cups
  from.mockImplementation((table: string) => {
    if (table === "meal_plans") {
      return { select: () => ({ eq: () => ({ single: () => ({ data: { checked_items: [], family_id: "f1" }, error: null }) }) }) };
    }
    if (table === "pantry_items") {
      // listPantry chains .eq().or().order(); the mock returns the same rows
      // at every step because this test is about scaling, not expiry.
      const rows = { data: [{ id: "s1", key: "flour", label: "Flour", kind: "keep", state: "have" }], error: null };
      return { select: () => ({ eq: () => ({ or: () => ({ order: () => rows }) }) }) };
    }
    if (table === "ingredient_categories") {
      // this family taught the app that besan is a pantry item
      return { select: () => ({ eq: () => ({ data: [{ key: "besan", category: "Pantry & Grains" }], error: null }) }) };
    }
    if (table === "meal_plan_items") {
      // .is("leftover_of", null) is chained after .eq, so the mock returns the
      // same rows either way: this test is about scaling, not leftovers.
      const rows = { data: [
        { recipe_id: "r1", servings: 8 },
        { recipe_id: "r1", servings: null },
      ], error: null };
      return { select: () => ({ eq: () => ({ ...rows, is: () => rows }) }) };
    }
    if (table === "meal_plan_manual_items") {
      return { select: () => ({ eq: () => ({ order: () => ({ data: [], error: null }) }) }) };
    }
    if (table === "recipes") {
      return { select: () => ({ in: () => ({ data: [{ id: "r1", title: "Cake", servings: 4 }], error: null }) }) };
    }
    if (table === "recipe_ingredients") {
      return { select: () => ({ in: () => ({ data: [
        { recipe_id: "r1", quantity: "2", unit: "cups", item: "flour" },
      ], error: null }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const lines = await getGroceryList("p1");
  const flour = lines.find((l) => l.name.includes("flour"))!;
  expect(flour.contributions).toHaveLength(2);
  expect(flour.contributions.some((c) => c.quantity === "4" && c.scaled)).toBe(true);
  expect(flour.contributions.some((c) => c.quantity === "2" && !c.scaled)).toBe(true);
  expect(flour.totals).toEqual([{ quantity: "6", unit: "cup" }]);
  // the family's staples reach buildGroceryList, so flour is flagged not dropped
  expect(flour.staple).toBe(true);
});

// The whole "do we need more rice" job: a staple you have is a quiet reminder,
// a staple you are low on or out of is a thing to buy, and a week item is this
// week's food rather than something you always keep.
test("only keep items you actually have are treated as staples", async () => {
  from.mockImplementation((table: string) => {
    if (table === "meal_plans") {
      return { select: () => ({ eq: () => ({ single: () => ({ data: { checked_items: [], family_id: "f1" }, error: null }) }) }) };
    }
    if (table === "pantry_items") {
      const rows = { data: [
        { id: "p1", key: "rice", label: "Rice", kind: "keep", state: "have" },
        { id: "p2", key: "cumin", label: "Cumin", kind: "keep", state: "out" },
        { id: "p3", key: "chicken", label: "Chicken", kind: "week", state: "have" },
      ], error: null };
      return { select: () => ({ eq: () => ({ or: () => ({ order: () => rows }) }) }) };
    }
    if (table === "ingredient_categories") {
      return { select: () => ({ eq: () => ({ data: [], error: null }) }) };
    }
    if (table === "meal_plan_items") {
      const rows = { data: [{ recipe_id: "r1", servings: null }], error: null };
      return { select: () => ({ eq: () => ({ ...rows, is: () => rows }) }) };
    }
    if (table === "meal_plan_manual_items") {
      return { select: () => ({ eq: () => ({ order: () => ({ data: [], error: null }) }) }) };
    }
    if (table === "recipes") {
      return { select: () => ({ in: () => ({ data: [{ id: "r1", title: "Pilaf", servings: 4 }], error: null }) }) };
    }
    if (table === "recipe_ingredients") {
      return { select: () => ({ in: () => ({ data: [
        { recipe_id: "r1", quantity: "1", unit: "cup", item: "rice" },
        { recipe_id: "r1", quantity: "1", unit: "teaspoon", item: "cumin" },
        { recipe_id: "r1", quantity: "2", unit: null, item: "chicken" },
      ], error: null }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const lines = await getGroceryList("p1");
  // Rice is had, so it is suppressed into the staples group.
  expect(lines.find((l) => l.key === "rice")!.staple).toBe(true);
  // Cumin is out, so it is a real line to buy.
  expect(lines.find((l) => l.key === "cumin")!.staple).toBe(false);
  // Chicken is this week's food, not a staple.
  expect(lines.find((l) => l.key === "chicken")!.staple).toBe(false);
});
