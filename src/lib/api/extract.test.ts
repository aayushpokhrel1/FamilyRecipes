import { vi, test, expect } from "vitest";
vi.mock("../supabaseClient", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
import { extractRecipe } from "./extract";
import type { RecipeDraft } from "./types";

const draft: RecipeDraft = {
  title: "Dal",
  story: "",
  provenance: "",
  servings: 4,
  prep_minutes: 5,
  cook_minutes: 20,
  ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "lentils" }],
  steps: [{ position: 0, text: "Boil" }],
  source_url: null,
};

test("extractRecipe returns the draft on success", async () => {
  const { supabase } = await import("../supabaseClient");
  (supabase.functions.invoke as any).mockResolvedValueOnce({ data: draft, error: null });
  const result = await extractRecipe("text", "x");
  expect(result).toEqual(draft);
});

test("extractRecipe throws on error", async () => {
  const { supabase } = await import("../supabaseClient");
  (supabase.functions.invoke as any).mockResolvedValueOnce({ data: null, error: { message: "boom" } });
  await expect(extractRecipe("text", "x")).rejects.toThrow("boom");
});
