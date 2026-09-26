import { supabase } from "../supabaseClient";
import type { RecipePhoto } from "./types";

export async function uploadRecipePhoto(recipeId: string, file: File, isCover: boolean): Promise<RecipePhoto> {
  const path = recipeId + "/" + crypto.randomUUID();
  const { error: upErr } = await supabase.storage.from("recipe-photos").upload(path, file);
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await supabase.from("recipe_photos")
    .insert({ recipe_id: recipeId, storage_path: path, is_cover: isCover }).select().single();
  if (error) throw new Error(error.message);
  const inserted = data as RecipePhoto;

  // Editing a recipe and picking a photo used to ADD a second cover rather than replace the
  // first, so covers accumulated and which one showed was down to row order. Demote the old
  // ones AFTER the new row exists, so a failure here leaves two covers rather than none.
  // ponytail: demotes rather than deletes, so a replaced photo still occupies storage.
  // Add a cleanup when someone actually swaps photos often enough for that to matter.
  if (isCover) {
    const { error: demoteErr } = await supabase.from("recipe_photos")
      .update({ is_cover: false })
      .eq("recipe_id", recipeId).eq("is_cover", true).neq("id", inserted.id);
    if (demoteErr) throw new Error(demoteErr.message);
  }
  return inserted;
}

// ponytail: always a signed URL (works for private and public); add public-URL fast path only if it matters
export async function getPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("recipe-photos").createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Cover URLs for a whole list of recipes. Deliberately NOT getCoverPhotoUrl in a loop:
// that is a query and a signing round trip per card, and a vault of fifty recipes would
// make a hundred requests to paint one page. One select, then one batch signing call.
export async function listCoverPhotoUrls(recipeIds: string[]): Promise<Map<string, string>> {
  const byRecipe = new Map<string, string>();
  if (recipeIds.length === 0) return byRecipe;

  const { data, error } = await supabase.from("recipe_photos")
    .select("recipe_id,storage_path,is_cover").in("recipe_id", recipeIds)
    .order("is_cover", { ascending: false });
  if (error) throw new Error(error.message);

  // Covers sort first, so the first row seen for a recipe is the one to show.
  for (const row of (data ?? []) as { recipe_id: string; storage_path: string }[]) {
    if (!byRecipe.has(row.recipe_id)) byRecipe.set(row.recipe_id, row.storage_path);
  }
  if (byRecipe.size === 0) return byRecipe;

  const { data: signed, error: signErr } = await supabase.storage
    .from("recipe-photos").createSignedUrls([...byRecipe.values()], 3600);
  if (signErr) throw new Error(signErr.message);

  const urlByPath = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl]));
  const out = new Map<string, string>();
  for (const [recipeId, path] of byRecipe) {
    const url = urlByPath.get(path);
    if (url) out.set(recipeId, url);
  }
  return out;
}

// The one picture a card or hero shows. A recipe with no photo is normal, not
// an error, so this resolves null rather than throwing.
export async function getCoverPhotoUrl(recipeId: string): Promise<string | null> {
  const { data, error } = await supabase.from("recipe_photos")
    .select("storage_path").eq("recipe_id", recipeId)
    .order("is_cover", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return getPhotoUrl((data as { storage_path: string }).storage_path);
}
