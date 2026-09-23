// src/lib/api/mealPlans.test.ts
import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { createPlan, toggleChecked, getGroceryList } from "./mealPlans";

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

test("getGroceryList scales each (recipe, servings) pair separately", async () => {
  // recipe serves 4; one item targets 8 (factor 2), the other leaves it alone
  // so the flour line carries a scaled 4 cups and an unscaled 2 cups
  from.mockImplementation((table: string) => {
    if (table === "meal_plans") {
      return { select: () => ({ eq: () => ({ single: () => ({ data: { checked_items: [] }, error: null }) }) }) };
    }
    if (table === "meal_plan_items") {
      return { select: () => ({ eq: () => ({ data: [
        { recipe_id: "r1", servings: 8 },
        { recipe_id: "r1", servings: null },
      ], error: null }) }) };
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
});
