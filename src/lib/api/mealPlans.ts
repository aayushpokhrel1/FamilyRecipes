import { supabase } from "../supabaseClient";
import { buildGroceryList, type IngredientRow } from "./grocery";
import { parseQuantity, scaleIngredientQty } from "./quantity";
import type { MealPlan, MealPlanItem, ManualItem, MealPlanViewMode, MealSlot, GroceryLine } from "./types";

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

// RLS returns the caller's own plans plus any shared to their families.
export async function listPlans(): Promise<MealPlan[]> {
  const { data, error } = await supabase.from("meal_plans").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MealPlan[];
}

export async function createPlan(familyId: string, name: string): Promise<MealPlan> {
  const uid = await myId();
  const { data, error } = await supabase.from("meal_plans")
    .insert({ owner_id: uid, family_id: familyId, name }).select().single();
  if (error) throw new Error(error.message);
  return data as MealPlan;
}

export async function renamePlan(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("meal_plans").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function setViewMode(id: string, mode: MealPlanViewMode): Promise<void> {
  const { error } = await supabase.from("meal_plans").update({ view_mode: mode }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function setShared(id: string, isShared: boolean): Promise<void> {
  const { error } = await supabase.from("meal_plans").update({ is_shared: isShared }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase.from("meal_plans").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listItems(planId: string): Promise<MealPlanItem[]> {
  const { data, error } = await supabase.from("meal_plan_items")
    .select("id,plan_id,recipe_id,day,meal_slot,position,servings").eq("plan_id", planId).order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as MealPlanItem[];
}

export async function addRecipe(
  planId: string, recipeId: string, opts: { day?: string | null; mealSlot?: MealSlot | null } = {},
): Promise<MealPlanItem> {
  const { count } = await supabase.from("meal_plan_items")
    .select("*", { count: "exact", head: true }).eq("plan_id", planId);
  const { data, error } = await supabase.from("meal_plan_items").insert({
    plan_id: planId, recipe_id: recipeId,
    day: opts.day ?? null, meal_slot: opts.mealSlot ?? null, position: count ?? 0,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as MealPlanItem;
}

export async function removeItem(itemId: string): Promise<void> {
  const { error } = await supabase.from("meal_plan_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

// null means "use the recipe's own servings"
export async function setItemServings(itemId: string, servings: number | null): Promise<void> {
  const { error } = await supabase.from("meal_plan_items")
    .update({ servings }).eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function moveItem(
  itemId: string, patch: { day?: string | null; mealSlot?: MealSlot | null; position?: number },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.day !== undefined) row.day = patch.day;
  if (patch.mealSlot !== undefined) row.meal_slot = patch.mealSlot;
  if (patch.position !== undefined) row.position = patch.position;
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from("meal_plan_items").update(row).eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function listManualItems(planId: string): Promise<ManualItem[]> {
  const { data, error } = await supabase.from("meal_plan_manual_items").select("*").eq("plan_id", planId).order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualItem[];
}
export async function addManualItem(planId: string, label: string): Promise<ManualItem> {
  const { count } = await supabase.from("meal_plan_manual_items")
    .select("*", { count: "exact", head: true }).eq("plan_id", planId);
  const { data, error } = await supabase.from("meal_plan_manual_items")
    .insert({ plan_id: planId, label, position: count ?? 0 }).select().single();
  if (error) throw new Error(error.message);
  return data as ManualItem;
}
export async function removeManualItem(id: string): Promise<void> {
  const { error } = await supabase.from("meal_plan_manual_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ponytail: read-modify-write of the checked_items array; last-write-wins is
// fine for a single owner ticking their own list. A per-key table only if
// multiple devices ever edit one plan concurrently.
export async function toggleChecked(planId: string, key: string, checked: boolean): Promise<void> {
  const { data: plan, error } = await supabase.from("meal_plans").select("checked_items").eq("id", planId).single();
  if (error) throw new Error(error.message);
  const set = new Set<string>((plan?.checked_items ?? []) as string[]);
  if (checked) set.add(key); else set.delete(key);
  const { error: uErr } = await supabase.from("meal_plans").update({ checked_items: Array.from(set) }).eq("id", planId);
  if (uErr) throw new Error(uErr.message);
}

// Derived at read time: gather ingredients from the plan's DISTINCT
// (recipe, servings) pairs, scale each pair's rows to its target, then group by
// normalized name. Never stored.
export async function getGroceryList(planId: string): Promise<GroceryLine[]> {
  const [{ data: plan, error: pErr }, { data: items, error: iErr }, { data: manual, error: mErr }] = await Promise.all([
    supabase.from("meal_plans").select("checked_items").eq("id", planId).single(),
    supabase.from("meal_plan_items").select("recipe_id,servings").eq("plan_id", planId),
    supabase.from("meal_plan_manual_items").select("id,label").eq("plan_id", planId).order("position"),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (iErr) throw new Error(iErr.message);
  if (mErr) throw new Error(mErr.message);

  // De-dupe by the (recipe_id, servings) pair, not by recipe alone: the same
  // recipe planned for 8 and for 2 must contribute twice, scaled differently.
  // The same recipe at the same servings still contributes once.
  const pairs = new Map<string, { recipeId: string; servings: number | null }>();
  for (const r of (items ?? []) as any[]) {
    pairs.set(`${r.recipe_id}:${r.servings ?? ""}`, { recipeId: r.recipe_id, servings: r.servings ?? null });
  }
  const recipeIds = Array.from(new Set(Array.from(pairs.values()).map((p) => p.recipeId)));
  let rows: IngredientRow[] = [];
  if (recipeIds.length) {
    const [{ data: recipes }, { data: ings }] = await Promise.all([
      supabase.from("recipes").select("id,title,servings").in("id", recipeIds),
      supabase.from("recipe_ingredients").select("recipe_id,quantity,unit,item").in("recipe_id", recipeIds),
    ]);
    const recipeById = new Map((recipes ?? []).map((r: any) => [r.id, r]));
    const ingsByRecipe = new Map<string, any[]>();
    for (const g of (ings ?? []) as any[]) {
      const list = ingsByRecipe.get(g.recipe_id) ?? [];
      list.push(g);
      ingsByRecipe.set(g.recipe_id, list);
    }
    for (const { recipeId, servings: target } of pairs.values()) {
      const recipe = recipeById.get(recipeId);
      if (!recipe) continue;
      // Only scale when we have both a target and a base to scale from. A recipe
      // with no servings has no base, so its rows pass through untouched.
      const factor = target && recipe.servings ? target / recipe.servings : null;
      for (const g of ingsByRecipe.get(recipeId) ?? []) {
        const canScale = factor !== null && factor !== 1 && parseQuantity(g.quantity) !== null;
        rows.push({
          recipeTitle: recipe.title ?? "",
          quantity: canScale ? scaleIngredientQty(g.quantity, factor!) : g.quantity,
          unit: g.unit,
          item: g.item,
          scaled: canScale,
        });
      }
    }
  }
  const manualList = ((manual ?? []) as any[]).map((m) => ({ id: m.id, label: m.label }));
  return buildGroceryList(rows, manualList, ((plan?.checked_items ?? []) as string[]));
}
