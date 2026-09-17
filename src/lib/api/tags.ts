import { supabase } from "../supabaseClient";
import type { Tag } from "./types";

export async function listTags(familyId: string): Promise<Tag[]> {
  const { data, error } = await supabase.from("tags")
    .select("*").eq("family_id", familyId).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Tag[];
}

export async function ensureTag(familyId: string, name: string): Promise<Tag> {
  const { data: existing, error } = await supabase.from("tags")
    .select("*").eq("family_id", familyId).eq("name", name).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing as Tag;
  const { data, error: iErr } = await supabase.from("tags")
    .insert({ family_id: familyId, name }).select().single();
  if (iErr) throw new Error(iErr.message);
  return data as Tag;
}

export async function setRecipeTags(recipeId: string, tagIds: string[]): Promise<void> {
  const { error } = await supabase.from("recipe_tags").delete().eq("recipe_id", recipeId);
  if (error) throw new Error(error.message);
  if (tagIds.length) {
    const rows = tagIds.map((tag_id) => ({ recipe_id: recipeId, tag_id }));
    const { error: iErr } = await supabase.from("recipe_tags").insert(rows);
    if (iErr) throw new Error(iErr.message);
  }
}

export async function recipeIdsForTag(tagId: string): Promise<string[]> {
  const { data, error } = await supabase.from("recipe_tags").select("recipe_id").eq("tag_id", tagId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.recipe_id);
}

export async function getRecipeTagIds(recipeId: string): Promise<string[]> {
  const { data, error } = await supabase.from("recipe_tags").select("tag_id").eq("recipe_id", recipeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.tag_id);
}
