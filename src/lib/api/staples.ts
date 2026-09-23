import { supabase } from "../supabaseClient";
import { normalizeItem } from "./normalizeItem";

export interface Staple { id: string; key: string; label: string }

export async function listStaples(familyId: string): Promise<Staple[]> {
  const { data, error } = await supabase.from("pantry_staples")
    .select("id,key,label").eq("family_id", familyId).order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as Staple[];
}

// Store the normalized key so a staple typed as "all-purpose flour" also
// suppresses a recipe line reading "flour": the same rule the grocery grouping
// already uses, rather than a second matching scheme.
export async function addStaple(familyId: string, label: string): Promise<Staple> {
  const { data, error } = await supabase.from("pantry_staples")
    .insert({ family_id: familyId, key: normalizeItem(label), label: label.trim() })
    .select("id,key,label").single();
  if (error) throw new Error(error.message);
  return data as Staple;
}

export async function removeStaple(id: string): Promise<void> {
  const { error } = await supabase.from("pantry_staples").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
