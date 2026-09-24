import { supabase } from "../supabaseClient";
import { normalizeItem } from "./normalizeItem";
import { addDays, today } from "../dates";

export type PantryKind = "keep" | "week";
export type PantryState = "have" | "low" | "out";

export interface PantryItem {
  id: string;
  key: string;
  label: string;
  kind: PantryKind;
  state: PantryState;
  expires_on: string | null;
}

const COLS = "id,key,label,kind,state,expires_on";

// How long a "we have chicken" claim is trusted. After this it stops being
// returned, so a list nobody tends empties itself instead of lying.
export const WEEK_ITEM_DAYS = 7;

export async function listPantry(familyId: string): Promise<PantryItem[]> {
  const { data, error } = await supabase.from("pantry_items")
    .select(COLS).eq("family_id", familyId)
    .or(`expires_on.is.null,expires_on.gte.${today()}`)
    .order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as PantryItem[];
}

// Upsert, not insert: re-adding something already in the cupboard should
// refresh it rather than fail on the (family_id, key) unique constraint. That
// is also exactly what the grocery hook needs when you buy rice again.
export async function addItem(
  familyId: string, label: string, kind: PantryKind = "keep",
): Promise<PantryItem> {
  const key = normalizeItem(label);

  // Restocking must never DEMOTE a staple to a week item. Buying salt off the
  // grocery list used to overwrite kind with 'week', so something the family
  // always keeps would quietly expire out of the cupboard seven days later.
  // The guard lives here, not in the caller, because every route into the
  // cupboard goes through this function.
  let finalKind = kind;
  if (kind === "week") {
    const { data: existing } = await supabase.from("pantry_items")
      .select("kind").eq("family_id", familyId).eq("key", key).maybeSingle();
    if (existing?.kind === "keep") finalKind = "keep";
  }

  const row = {
    family_id: familyId,
    key,
    label: label.trim(),
    kind: finalKind,
    state: "have" as PantryState,
    expires_on: finalKind === "week" ? addDays(today(), WEEK_ITEM_DAYS) : null,
  };
  const { data, error } = await supabase.from("pantry_items")
    .upsert(row, { onConflict: "family_id,key" }).select(COLS).single();
  if (error) throw new Error(error.message);
  return data as PantryItem;
}

export async function setState(id: string, state: PantryState): Promise<void> {
  const { error } = await supabase.from("pantry_items").update({ state }).eq("id", id);
  if (error) throw new Error(error.message);
}

// Promoting a week item to the cupboard clears its expiry, otherwise it would
// quietly vanish a few days after being made permanent.
export async function setKind(id: string, kind: PantryKind): Promise<void> {
  const { error } = await supabase.from("pantry_items")
    .update({ kind, expires_on: kind === "week" ? addDays(today(), WEEK_ITEM_DAYS) : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeItem(id: string): Promise<void> {
  const { error } = await supabase.from("pantry_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
