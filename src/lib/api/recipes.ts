import { supabase } from "../supabaseClient";
import type { Recipe, RecipeDraft, Visibility } from "./types";

export async function createRecipe(familyId: string, draft: RecipeDraft, visibility: Visibility): Promise<Recipe> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Not signed in");
  const { data: rec, error } = await supabase.from("recipes").insert({
    family_id: familyId, author_id: user.user.id, title: draft.title,
    story: draft.story || null, provenance: draft.provenance || null,
    servings: draft.servings, prep_minutes: draft.prep_minutes, cook_minutes: draft.cook_minutes,
    visibility, source_url: draft.source_url,
  }).select().single();
  if (error) throw new Error(error.message);

  if (draft.ingredients.length) {
    const rows = draft.ingredients.map((g, i) => ({
      recipe_id: rec.id, position: i, quantity: g.quantity, unit: g.unit, item: g.item, section: g.section ?? null }));
    const { error: e2 } = await supabase.from("recipe_ingredients").insert(rows);
    if (e2) throw new Error(e2.message);
  }
  if (draft.steps.length) {
    const rows = draft.steps.map((s, i) => ({ recipe_id: rec.id, position: i, text: s.text }));
    const { error: e3 } = await supabase.from("recipe_steps").insert(rows);
    if (e3) throw new Error(e3.message);
  }
  return rec as Recipe;
}

// ponytail: child rows replaced (delete-all then insert); fine for small lists, diff positions only if a recipe grows to hundreds of lines
export async function updateRecipe(id: string, patch: Partial<RecipeDraft> & { visibility?: Visibility }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.story !== undefined) row.story = patch.story || null;
  if (patch.provenance !== undefined) row.provenance = patch.provenance || null;
  if (patch.servings !== undefined) row.servings = patch.servings;
  if (patch.prep_minutes !== undefined) row.prep_minutes = patch.prep_minutes;
  if (patch.cook_minutes !== undefined) row.cook_minutes = patch.cook_minutes;
  if (patch.visibility !== undefined) row.visibility = patch.visibility;
  if (patch.source_url !== undefined) row.source_url = patch.source_url;

  if (Object.keys(row).length) {
    const { error } = await supabase.from("recipes").update(row).eq("id", id);
    if (error) throw new Error(error.message);
  }

  // Replace ingredients and/or steps atomically (delete + insert in one tx) via
  // an RPC, so a mid-update failure can no longer leave a recipe with its old
  // rows deleted and no new ones inserted. Position is assigned server-side by
  // array order. null = leave as is; [] = clear.
  if (patch.ingredients !== undefined || patch.steps !== undefined) {
    const { error } = await supabase.rpc("replace_recipe_children", {
      p_recipe_id: id,
      p_ingredients: patch.ingredients ?? null,
      p_steps: patch.steps ?? null,
    });
    if (error) throw new Error(error.message);
  }
}

export async function getRecipe(id: string) {
  const [{ data: recipe }, { data: ingredients }, { data: steps }, { data: photos }] = await Promise.all([
    supabase.from("recipes").select("*").eq("id", id).single(),
    supabase.from("recipe_ingredients").select("*").eq("recipe_id", id).order("position"),
    supabase.from("recipe_steps").select("*").eq("recipe_id", id).order("position"),
    supabase.from("recipe_photos").select("*").eq("recipe_id", id),
  ]);
  if (!recipe) throw new Error("Recipe not found");
  return { recipe, ingredients: ingredients ?? [], steps: steps ?? [], photos: photos ?? [] };
}

// Search goes through the search_recipes RPC so the term is a bound parameter
// rather than an interpolated PostgREST filter expression (no more building
// `or=` strings out of user input). Matching is trigram-fuzzy plus substring,
// so typos and variants ("chiken", "tomatos") still find the recipe.
export async function listRecipes(
  familyId: string,
  opts: { search?: string; tagId?: string } = {},
): Promise<Recipe[]> {
  const { data, error } = await supabase.rpc("search_recipes", {
    p_family_id: familyId,
    p_search: opts.search ?? null,
    p_tag_id: opts.tagId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Recipe[];
}

export async function deleteRecipe(id: string) {
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listFamilyIngredientNames(familyId: string): Promise<string[]> {
  const { data: recs, error } = await supabase.from("recipes").select("id").eq("family_id", familyId);
  if (error) throw new Error(error.message);
  const ids = (recs ?? []).map((r: any) => r.id);
  if (!ids.length) return [];
  const { data, error: e2 } = await supabase.from("recipe_ingredients").select("item").in("recipe_id", ids);
  if (e2) throw new Error(e2.message);
  const names = new Set((data ?? []).map((r: any) => r.item as string).filter(Boolean));
  return Array.from(names).sort();
}
