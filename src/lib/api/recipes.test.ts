import { vi, test, expect } from "vitest";
const from = vi.fn();
const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  rpc: (...a: any[]) => rpc(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { createRecipe, listRecipes, updateRecipe } from "./recipes";
test("createRecipe inserts the recipe then ingredients with positions 0,1", async () => {
  const inserted: any[] = [];
  from.mockImplementation((table: string) => ({
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return { select: () => ({ single: () => ({ data: { id: "r1" }, error: null }) }) };
    },
  }));
  const draft = {
    title: "Dal", story: "", provenance: "", servings: 4, prep_minutes: 5, cook_minutes: 20,
    ingredients: [
      { position: 0, quantity: "1", unit: "cup", item: "lentils" },
      { position: 1, quantity: "2", unit: null, item: "tomatoes" },
    ],
    steps: [{ position: 0, text: "Boil" }],
    source_url: null,
  };
  const rec = await createRecipe("f1", draft as any, "family");
  expect(rec.id).toBe("r1");
  expect(inserted[0].table).toBe("recipes");
  expect(inserted[1].table).toBe("recipe_ingredients");
  expect(inserted[1].payload.map((r: any) => r.position)).toEqual([0, 1]);
});
test("listRecipes searches via the search_recipes RPC", async () => {
  rpc.mockClear();
  rpc.mockResolvedValueOnce({ data: [{ id: "r2", title: "Soup" }], error: null });
  const rows = await listRecipes("f1", { search: "chicken" });
  expect(rpc).toHaveBeenCalledWith("search_recipes", {
    p_family_id: "f1",
    p_search: "chicken",
    p_tag_id: null,
  });
  expect(rows.map((r: any) => r.id)).toContain("r2");
});
test("listRecipes passes a null search when none is given", async () => {
  rpc.mockClear();
  rpc.mockResolvedValueOnce({ data: [], error: null });
  await listRecipes("f1");
  expect(rpc).toHaveBeenCalledWith("search_recipes", {
    p_family_id: "f1",
    p_search: null,
    p_tag_id: null,
  });
});
test("updateRecipe sends only the provided child list to replace_recipe_children", async () => {
  rpc.mockClear();
  await updateRecipe("r1", { ingredients: [{ quantity: "1", unit: "cup", item: "rice" }] } as any);
  expect(rpc).toHaveBeenCalledWith("replace_recipe_children", {
    p_recipe_id: "r1",
    p_ingredients: [{ quantity: "1", unit: "cup", item: "rice" }],
    p_steps: null,
  });
});
