import { supabase } from "../supabaseClient";
import type { RecipePhoto } from "./types";

// A phone camera produces 3-4 MB of pixels nobody can see: the biggest this is ever drawn
// is a few hundred CSS pixels. Uploading the original made the recipe page visibly wait on
// a multi-megabyte download every time it was opened. Shrinking once, here, fixes it for
// every later read instead of paying for it on each one.
//
// createImageBitmap with imageOrientation "from-image" applies the EXIF rotation. Without
// it, photos taken in portrait upload on their side, which is the classic version of this
// bug. Anything that fails (an odd format, a browser without the API) falls back to the
// original file: a large photo is worse than a small one, but far better than no photo.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/jpeg") {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file; // never make it bigger
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function uploadRecipePhoto(recipeId: string, file: File, isCover: boolean): Promise<RecipePhoto> {
  const path = recipeId + "/" + crypto.randomUUID();
  const { error: upErr } = await supabase.storage.from("recipe-photos").upload(path, await shrink(file));
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
