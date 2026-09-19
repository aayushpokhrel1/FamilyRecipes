// src/lib/api/mealPlans.test.ts
import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { createPlan, toggleChecked } from "./mealPlans";

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
