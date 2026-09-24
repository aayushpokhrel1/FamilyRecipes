import { supabase } from "../supabaseClient";
import type { Preferences, Profile } from "./types";

export async function getMyProfile(): Promise<Profile> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { data: profile, error } = await supabase.from("profiles")
    .select("id,display_name,avatar_url,preferences").eq("id", data.user.id).single();
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
