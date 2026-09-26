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

// The bug these guard: supabase-js reports EVERY function failure with the same generic
// string and hides the real one in error.context. A quota error and a broken model name
// looked identical, which is how "edge function returned a non-2xx status code" became the
// only thing anyone could report.
function generic(): Error & { context?: unknown } {
  return new Error("Edge Function returned a non-2xx status code");
}

test("extractRecipe surfaces the function's own error, not the generic one", async () => {
  const { supabase } = await import("../supabaseClient");
  const err = generic();
  err.context = new Response(JSON.stringify({ error: "model error 429: quota exceeded" }), { status: 502 });
  (supabase.functions.invoke as any).mockResolvedValueOnce({ data: null, error: err });
  await expect(extractRecipe("image", "data:image/jpeg;base64,x")).rejects.toThrow(/429: quota exceeded/);
});

test("extractRecipe falls back to raw text when the body is not JSON", async () => {
  const { supabase } = await import("../supabaseClient");
  const err = generic();
  err.context = new Response("upstream exploded", { status: 500 });
  (supabase.functions.invoke as any).mockResolvedValueOnce({ data: null, error: err });
  await expect(extractRecipe("url", "https://x.dev")).rejects.toThrow(/upstream exploded/);
});

test("extractRecipe keeps the generic message when there is no response to read", async () => {
  const { supabase } = await import("../supabaseClient");
  (supabase.functions.invoke as any).mockResolvedValueOnce({ data: null, error: generic() });
  await expect(extractRecipe("text", "x")).rejects.toThrow(/non-2xx/);
});
