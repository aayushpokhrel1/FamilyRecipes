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
      recipe_id: rec.id, position: i, quantity: g.quantity, unit: g.unit, item: g.item }));
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

  if (patch.ingredients) {
    const { error: dErr } = await supabase.from("recipe_ingredients").delete().eq("recipe_id", id);
    if (dErr) throw new Error(dErr.message);
    if (patch.ingredients.length) {
      const rows = patch.ingredients.map((g, i) => ({
        recipe_id: id, position: i, quantity: g.quantity, unit: g.unit, item: g.item }));
      const { error: iErr } = await supabase.from("recipe_ingredients").insert(rows);
      if (iErr) throw new Error(iErr.message);
    }
  }

  if (patch.steps) {
    const { error: dErr } = await supabase.from("recipe_steps").delete().eq("recipe_id", id);
    if (dErr) throw new Error(dErr.message);
    if (patch.steps.length) {
      const rows = patch.steps.map((s, i) => ({ recipe_id: id, position: i, text: s.text }));
      const { error: sErr } = await supabase.from("recipe_steps").insert(rows);
      if (sErr) throw new Error(sErr.message);
    }
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

export async function listRecipes(familyId: string, opts: { search?: string; tagId?: string } = {}) {
  let q = supabase.from("recipes").select("*").eq("family_id", familyId).order("created_at", { ascending: false });
  if (opts.tagId) {
    const { data: links, error: tErr } = await supabase.from("recipe_tags")
      .select("recipe_id").eq("tag_id", opts.tagId);
    if (tErr) throw new Error(tErr.message);
    const ids = (links ?? []).map((r: any) => r.recipe_id);
    if (ids.length === 0) return [];
    q = q.in("id", ids);
  }
  if (opts.search) q = q.ilike("title", `%${opts.search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Recipe[];
}

export async function deleteRecipe(id: string) {
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
