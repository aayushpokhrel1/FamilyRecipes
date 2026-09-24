import { supabase } from "../supabaseClient";
import { normalizeItem } from "./normalizeItem";

export interface CategoryOverride { id: string; key: string; category: string }

// A family's own aisle assignments, keyed the same way the grocery list groups
// ingredients so a tag on "besan" also covers "Besan" and "besan flour".
export async function listCategoryOverrides(familyId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("ingredient_categories")
    .select("key,category").eq("family_id", familyId);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r: { key: string; category: string }) => [r.key, r.category]));
}

// Upsert on (family_id, key): tagging the same ingredient again corrects it
// rather than failing on the unique constraint or piling up rows.
export async function setCategoryOverride(
  familyId: string, item: string, category: string,
): Promise<void> {
  const key = normalizeItem(item);
  if (!key) return;
  const { error } = await supabase.from("ingredient_categories")
    .upsert({ family_id: familyId, key, category }, { onConflict: "family_id,key" });
  if (error) throw new Error(error.message);
}

// Takes the NORMALIZED key, not a written ingredient name: the settings list
// and the grocery list both hand back keys already.
export async function removeCategoryOverride(familyId: string, key: string): Promise<void> {
  const { error } = await supabase.from("ingredient_categories")
    .delete().eq("family_id", familyId).eq("key", key);
  if (error) throw new Error(error.message);
}
