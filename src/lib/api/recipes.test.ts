import { vi, test, expect } from "vitest";
const from = vi.fn();
const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  rpc: (...a: any[]) => rpc(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { createRecipe, listPublicRecipes, listPublicRecipesByAuthor, listRecipes, updateRecipe } from "./recipes";
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
test("listPublicRecipesByAuthor filters on both author_id and visibility", async () => {
  const filters: Array<[string, string]> = [];
  let order: [string, any] | null = null;
  from.mockImplementation((table: string) => {
    expect(table).toBe("recipes");
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: string) => {
        filters.push([column, value]);
        return builder;
      },
      order: (column: string, opts: any) => {
        order = [column, opts];
        return Promise.resolve({ data: [{ id: "r1", title: "Momo" }], error: null });
      },
    };
    return builder;
  });
  const rows = await listPublicRecipesByAuthor("c1");
  expect(filters).toEqual([["author_id", "c1"], ["visibility", "public"]]);
  expect(order).toEqual(["created_at", { ascending: false }]);
  expect(rows.map((r: any) => r.id)).toEqual(["r1"]);
});

test("listPublicRecipes with an empty authorIds makes NO request at all", async () => {
  // Following nobody must not degrade into showing everybody. If this ever regresses, the
  // Following filter silently becomes the All filter, which looks like it works.
  from.mockReset();
  rpc.mockReset();
  const rows = await listPublicRecipes({ authorIds: [] });
  expect(rows).toEqual([]);
  expect(from).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

test("listPublicRecipes routes a search through the RPC with a null family id", async () => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [{ id: "r1", author_id: "c1", title: "Momo" }], error: null });
  const rows = await listPublicRecipes({ search: " momo " });
  expect(rpc).toHaveBeenCalledWith("search_recipes", {
    p_family_id: null, p_search: "momo", p_tag_id: null,
  });
  expect(rows.map((r: any) => r.id)).toEqual(["r1"]);
});

test("listPublicRecipes filters a search by followed authors", async () => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [
    { id: "r1", author_id: "c1" }, { id: "r2", author_id: "c2" },
  ], error: null });
  const rows = await listPublicRecipes({ search: "momo", authorIds: ["c2"] });
  expect(rows.map((r: any) => r.id)).toEqual(["r2"]);
});

test("listPublicRecipes pages public recipes newest first", async () => {
  from.mockReset();
  const filters: Array<[string, string]> = [];
  let range: [number, number] | null = null;
  let order: [string, any] | null = null;
  from.mockImplementation((table: string) => {
    expect(table).toBe("recipes");
    const builder: any = {
      select: () => builder,
      eq: (c: string, v: string) => { filters.push([c, v]); return builder; },
      in: () => builder,
      order: (c: string, o: any) => { order = [c, o]; return builder; },
      range: (a: number, b: number) => { range = [a, b]; return Promise.resolve({ data: [], error: null }); },
    };
    return builder;
  });
  await listPublicRecipes({ limit: 24, offset: 24 });
  expect(filters).toEqual([["visibility", "public"]]);
  expect(order).toEqual(["created_at", { ascending: false }]);
  expect(range).toEqual([24, 47]);
});
