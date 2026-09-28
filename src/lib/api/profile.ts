import { supabase } from "../supabaseClient";
import type { Byline, Preferences, Profile, PublicCook } from "./types";

export async function getMyProfile(): Promise<Profile> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { data: profile, error } = await supabase.from("profiles")
    .select("id,display_name,avatar_url,preferences,handle,public_name,bio").eq("id", data.user.id).single();
  if (error) throw new Error(error.message);
  return profile as Profile;
}

export async function updateDisplayName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Display name cannot be empty");
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles")
    .update({ display_name: trimmed }).eq("id", data.user.id);
  if (error) throw new Error(error.message);
}

export async function uploadAvatar(file: File): Promise<string> {
  // Trust-boundary checks: the storage policy only guards the path, not the payload.
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Images must be under 2 MB.");
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  // The user id MUST be the first path segment or the storage policy rejects the upload.
  const path = `${data.user.id}/${crypto.randomUUID()}`;
  const { error: upErr } = await supabase.storage.from("avatars").upload(path, file);
  if (upErr) throw new Error(upErr.message);
  const { error } = await supabase.from("profiles")
    .update({ avatar_url: path }).eq("id", data.user.id);
  if (error) throw new Error(error.message);
  return path;
}

// ponytail: always a signed URL (works for private and public); add public-URL fast path only if it matters
export async function getAvatarUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Merges the patch into the stored preferences rather than replacing the object, so a
// caller setting only householdSize does not wipe units. Read-then-write is last-write-wins
// across two tabs; that is fine for one user editing their own settings.
export async function updatePreferences(patch: Preferences): Promise<Preferences> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { data: row, error: readError } = await supabase.from("profiles")
    .select("preferences").eq("id", data.user.id).single();
  if (readError) throw new Error(readError.message);
  const merged: Preferences = { ...((row?.preferences ?? {}) as Preferences), ...patch };
  const { error } = await supabase.from("profiles")
    .update({ preferences: merged }).eq("id", data.user.id);
  if (error) throw new Error(error.message);
  return merged;
}

// Mirrors the check constraint in 0020 exactly. Kept as a validator rather than a
// transformer: silently lowercasing what someone typed means the handle they were shown is
// not the handle they got.
const HANDLE = /^[a-z0-9_]{3,30}$/;

export function handleError(handle: string): string | null {
  if (handle.length < 3) return "A handle needs at least 3 characters.";
  if (handle.length > 30) return "A handle can be at most 30 characters.";
  if (handle !== handle.toLowerCase()) return "A handle must be lowercase.";
  if (!HANDLE.test(handle)) return "Use only letters, numbers and underscores.";
  return null;
}

export async function updatePublicProfile(
  p: { handle: string; public_name: string; bio: string },
): Promise<void> {
  const problem = handleError(p.handle);
  if (problem) throw new Error(problem);
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles").update({
    handle: p.handle,
    public_name: p.public_name.trim() || null,
    bio: p.bio.trim() || null,
  }).eq("id", data.user.id);
  // The unique constraint is the only authority on whether a handle is free. Checking first
  // and inserting second is a race; letting the constraint answer is not.
  if (error) {
    if (error.code === "23505") throw new Error("That handle is taken.");
    throw new Error(error.message);
  }
}

// Clearing the handle is what unpublishing IS: every public view and the avatars policy are
// gated on `handle is not null`, so this revokes all of them at once.
export async function unpublishProfile(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles")
    .update({ handle: null }).eq("id", data.user.id);
  if (error) throw new Error(error.message);
}

// Reads the view, never the table: a stranger has no policy on profiles.
export async function getPublicCook(handle: string): Promise<PublicCook | null> {
  const { data, error } = await supabase.from("public_cooks")
    .select("id,handle,public_name,bio,avatar_url").eq("handle", handle).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PublicCook | null) ?? null;
}

// A missing byline is normal, not an error: the recipe may not be public, and the caller
// must not be able to tell those two cases apart.
export async function getByline(recipeId: string): Promise<Byline | null> {
  const { data } = await supabase.from("public_recipe_bylines")
    .select("handle,public_name,family_name").eq("recipe_id", recipeId).maybeSingle();
  return (data as Byline | null) ?? null;
}

// One query for a whole page of cards, never one per card. A feed of 24 recipes asking for
// 24 bylines separately is the kind of thing that looks fine locally and is obvious in
// production.
export async function getBylines(recipeIds: string[]): Promise<Map<string, Byline>> {
  if (recipeIds.length === 0) return new Map();
  const { data, error } = await supabase.from("public_recipe_bylines")
    .select("recipe_id,handle,public_name,family_name").in("recipe_id", recipeIds);
  if (error) throw new Error(error.message);
  const out = new Map<string, Byline>();
  for (const row of (data ?? []) as Array<Byline & { recipe_id: string }>) {
    out.set(row.recipe_id, { handle: row.handle, public_name: row.public_name, family_name: row.family_name });
  }
  return out;
}
