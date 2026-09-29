import { supabase } from "../supabaseClient";

// Copy a public recipe into a family vault. The database does the copying, so a future
// ingredient column is carried without a change here: see 0027_save_recipe_to_vault.sql.
export async function saveToVault(sourceRecipeId: string, familyId: string): Promise<string> {
  const { data, error } = await supabase.rpc("save_recipe_to_vault", {
    p_source: sourceRecipeId,
    p_family: familyId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// Which of these recipes are already in the family's vault. ONE call for a whole page of
// cards, never one per card: the same rule Potluck already follows for bylines.
export async function listSavedSourceIds(
  familyId: string,
  sourceIds: string[],
): Promise<Set<string>> {
  if (!sourceIds.length) return new Set();
  const { data, error } = await supabase
    .from("recipes")
    .select("source_recipe_id")
    .eq("family_id", familyId)
    .in("source_recipe_id", sourceIds);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: { source_recipe_id: string }) => r.source_recipe_id));
}
