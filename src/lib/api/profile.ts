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
