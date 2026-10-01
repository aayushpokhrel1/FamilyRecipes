import { supabase } from "../supabaseClient";
import type { RecipeDraft, SavedDraft, Visibility } from "./types";

// The row keeps title in its own column and everything else in body. These two helpers are
// the ONLY place that conversion happens, so a field added to RecipeDraft is added here once.
export function toRow(draft: RecipeDraft, visibility: Visibility) {
  return {
    title: draft.title,
    body: {
      story: draft.story,
      provenance: draft.provenance,
      servings: draft.servings,
      prep_minutes: draft.prep_minutes,
      cook_minutes: draft.cook_minutes,
      ingredients: draft.ingredients,
      steps: draft.steps,
      source_url: draft.source_url,
      visibility,
    },
  };
}

// body is schemaless, so a row written by an older version of the app can be missing fields.
// Every one of them gets a default here rather than surfacing as undefined in the UI. title
// always comes from the COLUMN, never from body.
export function fromRow(row: any): SavedDraft {
  const body = row.body ?? {};
  return {
    id: row.id,
    author_id: row.author_id,
    target_family_id: row.target_family_id,
    target_recipe_id: row.target_recipe_id ?? null,
    draft: {
      title: row.title,
      story: body.story ?? "",
      provenance: body.provenance ?? "",
      servings: body.servings ?? null,
      prep_minutes: body.prep_minutes ?? null,
      cook_minutes: body.cook_minutes ?? null,
      ingredients: body.ingredients ?? [],
      steps: body.steps ?? [],
      source_url: body.source_url ?? null,
    },
    visibility: body.visibility ?? "private",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listDrafts(): Promise<SavedDraft[]> {
  const { data, error } = await supabase.from("recipe_drafts")
    .select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

export async function getDraft(id: string): Promise<SavedDraft> {
  const { data, error } = await supabase.from("recipe_drafts")
    .select().eq("id", id).single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

export async function saveDraft(
  draft: RecipeDraft,
  familyId: string,
  visibility: Visibility,
  id?: string,
): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Not signed in");

  if (id) {
    const { error } = await supabase.from("recipe_drafts")
      .update({ ...toRow(draft, visibility), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  const { data, error } = await supabase.from("recipe_drafts")
    .insert({ ...toRow(draft, visibility), author_id: user.user.id, target_family_id: familyId })
    .select().single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.from("recipe_drafts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
