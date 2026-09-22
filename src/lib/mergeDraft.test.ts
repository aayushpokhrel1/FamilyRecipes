import { test, expect } from "vitest";
import { mergeDraft } from "./mergeDraft";
import type { RecipeDraft } from "./api/types";

const base = (o: Partial<RecipeDraft>): RecipeDraft => ({
  title: "", story: "", provenance: "", servings: null, prep_minutes: null, cook_minutes: null,
  ingredients: [], steps: [], source_url: null, ...o,
});

test("appends lists, fills empty scalars, never overwrites existing text", () => {
  const current = base({
    title: "Nana's Dal", servings: 4,
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "lentils" }],
    steps: [{ position: 0, text: "Boil" }],
  });
  const incoming = base({
    title: "Dal Extracted", servings: 8, story: "from a blog",
    ingredients: [{ position: 0, quantity: "2", unit: null, item: "tomato" }],
    steps: [{ position: 0, text: "Simmer" }],
  });
  const merged = mergeDraft(current, incoming);
  expect(merged.title).toBe("Nana's Dal");
  expect(merged.servings).toBe(4);
  expect(merged.story).toBe("from a blog");
  expect(merged.ingredients.map((i) => i.item)).toEqual(["lentils", "tomato"]);
  expect(merged.steps.map((s) => s.text)).toEqual(["Boil", "Simmer"]);
});
