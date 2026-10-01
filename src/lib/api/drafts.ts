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
    base_updated_at: row.base_updated_at ?? null,
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

// An EDIT draft is saveDraft plus the two columns that make it one: the recipe it is against
// and the recipe's updated_at at the moment the edit started. It goes through the same toRow
// as a create draft, because a second converter is how the two drift apart and start dropping
// a field that only one of them knows about.
export async function saveEditDraft(
  recipeId: string,
  draft: RecipeDraft,
  familyId: string,
  visibility: Visibility,
  baseUpdatedAt: string,
  id?: string,
): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Not signed in");

  const row = {
    ...toRow(draft, visibility),
    target_recipe_id: recipeId,
    base_updated_at: baseUpdatedAt,
  };

  if (id) {
    const { error } = await supabase.from("recipe_drafts")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  const { data, error } = await supabase.from("recipe_drafts")
    .insert({ ...row, author_id: user.user.id, target_family_id: familyId })
    .select().single();
  if (error) throw new Error(error.message);
  return data.id;
}

// The translation from the database's refusal to something the UI can branch on happens HERE,
// in the api layer, and not in the component. The api layer is the seam: a component that
// checked for the Postgres SQLSTATE 'DRF01' would spread database detail through the UI, and
// every other caller of this function would have to know the code too. One name, set once,
// and the page asks a question about a recipe that moved rather than about Postgres.
export async function publishEdit(draftId: string, force = false): Promise<string> {
  const { data, error } = await supabase.rpc("publish_recipe_edit", {
    p_draft: draftId,
    p_force: force,
  });
  if (error) {
    if (error.code === "DRF01") {
      const moved = new Error("The recipe changed since this edit was started.");
      moved.name = "RecipeMoved";
      throw moved;
    }
    throw new Error(error.message);
  }
  return data as string;
}
