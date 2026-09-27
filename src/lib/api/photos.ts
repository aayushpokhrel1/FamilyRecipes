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
  // A year of cache-control is safe because `path` carries a fresh UUID: an object here is
  // written once and never rewritten, so a stale cache entry cannot exist. Supabase's default
  // is one hour, which had the browser re-fetching an unchanged image every hour.
  const { error: upErr } = await supabase.storage.from("recipe-photos")
    .upload(path, await shrink(file), { cacheControl: "31536000" });
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await supabase.from("recipe_photos")
    .insert({ recipe_id: recipeId, storage_path: path, is_cover: isCover }).select().single();
  if (error) throw new Error(error.message);
  const inserted = data as RecipePhoto;

  // Editing a recipe and picking a photo used to ADD a second cover rather than replace the
  // first, so covers accumulated and which one showed was down to row order. Clean up the old
  // ones AFTER the new row exists, so a failure here leaves two covers rather than none.
  //
  // Replaced covers are DELETED, not demoted. Demoting kept a row nothing would ever show and
  // a storage object nobody would ever fetch: invisible, permanent, and paid for. Only rows
  // that are currently `is_cover` are touched, so a photo deliberately uploaded as a non-cover
  // is left alone if this ever grows a gallery.
  if (isCover) {
    const { data: replaced, error: findErr } = await supabase.from("recipe_photos")
      .select("id,storage_path")
      .eq("recipe_id", recipeId).eq("is_cover", true).neq("id", inserted.id);
    if (findErr) throw new Error(findErr.message);
    const old = (replaced ?? []) as { id: string; storage_path: string }[];
    if (old.length > 0) {
      // Rows first, objects second, and that order is deliberate. A failure after the rows are
      // gone leaves an unreferenced object: wasted bytes nobody sees. The other order would
      // leave a row pointing at a deleted file, which renders as a broken image on the card.
      const { error: delErr } = await supabase.from("recipe_photos")
        .delete().in("id", old.map((p) => p.id));
      if (delErr) throw new Error(delErr.message);
      const { error: rmErr } = await supabase.storage.from("recipe-photos")
        .remove(old.map((p) => p.storage_path));
      // Deliberately not thrown: the photo IS replaced as far as the cook can tell, and failing
      // the whole save over leftover bytes would report a problem that is not theirs to fix.
      if (rmErr) console.warn("replaced photo left in storage:", rmErr.message);
    }
  }
  return inserted;
}

// Signing produces a DIFFERENT url every call, and a different url is a different cache key,
// so the browser re-downloaded the whole image on every page load no matter what
// cache-control said. Remembering the url until shortly before its token expires makes the
// src identical between visits, which is what turns the second view into a cache hit.
// The tradeoff is deliberate: a leaked url is now usable for a day rather than an hour. These
// are photos of family dinners, and the alternative was paying for every one on every view.
const SIGN_TTL_S = 24 * 3600;
const REFRESH_MARGIN_MS = 60 * 60 * 1000; // re-sign before expiry, never hand out a dead url
const CACHE_PREFIX = "photo-url:";

function cachedUrl(path: string): string | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return null;
    const { url, exp } = JSON.parse(raw) as { url: string; exp: number };
    return exp - Date.now() > REFRESH_MARGIN_MS ? url : null;
  } catch {
    return null; // no store, or a corrupt entry: sign a fresh one
  }
}

function rememberUrl(path: string, url: string): void {
  try {
    localStorage.setItem(CACHE_PREFIX + path, JSON.stringify({ url, exp: Date.now() + SIGN_TTL_S * 1000 }));
  } catch {
    // A disabled or full store costs a re-download, which is exactly the old behaviour.
    // ponytail: no eviction; entries are a few hundred bytes each and paths are never reused.
  }
}

// Signing out has to drop these. A remembered url is a bearer token for a private photo, and
// leaving a day's worth behind on a shared device would be handing the next person the keys.
export function forgetPhotoUrls(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* nothing stored means nothing to forget */ }
}

// ponytail: always a signed URL (works for private and public); add public-URL fast path only if it matters
export async function getPhotoUrl(path: string): Promise<string> {
  const hit = cachedUrl(path);
  if (hit) return hit;
  const { data, error } = await supabase.storage.from("recipe-photos").createSignedUrl(path, SIGN_TTL_S);
  if (error) throw new Error(error.message);
  rememberUrl(path, data.signedUrl);
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

  // Only the paths without a live remembered url need signing. On a revisit that is usually
  // none, so painting the grid costs one select instead of a select plus a signing round trip.
  const urlByPath = new Map<string, string>();
  const unsigned: string[] = [];
  for (const path of new Set(byRecipe.values())) {
    const hit = cachedUrl(path);
    if (hit) urlByPath.set(path, hit);
    else unsigned.push(path);
  }
  if (unsigned.length > 0) {
    const { data: signed, error: signErr } = await supabase.storage
      .from("recipe-photos").createSignedUrls(unsigned, SIGN_TTL_S);
    if (signErr) throw new Error(signErr.message);
    for (const s of signed ?? []) {
      if (!s.path || !s.signedUrl) continue;
      urlByPath.set(s.path, s.signedUrl);
      rememberUrl(s.path, s.signedUrl);
    }
  }
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
