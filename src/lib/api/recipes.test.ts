import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { createRecipe } from "./recipes";
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
