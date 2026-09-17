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
