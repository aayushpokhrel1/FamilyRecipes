import { supabase } from "../supabaseClient";
import type { RecipePhoto } from "./types";

export async function uploadRecipePhoto(recipeId: string, file: File, isCover: boolean): Promise<RecipePhoto> {
  const path = recipeId + "/" + crypto.randomUUID();
  const { error: upErr } = await supabase.storage.from("recipe-photos").upload(path, file);
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await supabase.from("recipe_photos")
    .insert({ recipe_id: recipeId, storage_path: path, is_cover: isCover }).select().single();
  if (error) throw new Error(error.message);
  return data as RecipePhoto;
}

// ponytail: always a signed URL (works for private and public); add public-URL fast path only if it matters
export async function getPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("recipe-photos").createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
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
