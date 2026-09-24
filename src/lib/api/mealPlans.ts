import { supabase } from "../supabaseClient";
import { buildGroceryList, type IngredientRow } from "./grocery";
import { listPantry } from "./pantry";
import { listCategoryOverrides } from "./ingredientCategories";
import { parseQuantity, scaleIngredientQty } from "./quantity";
import { addDays, today } from "../dates";
import type { MealPlan, MealPlanItem, ManualItem, MealPlanViewMode, MealSlot, GroceryLine, UpcomingItem } from "./types";

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
export async function setPlanDates(
  id: string, startDate: string | null, lengthDays: number,
): Promise<void> {
  const { error } = await supabase.from("meal_plans")
    .update({ start_date: startDate, length_days: lengthDays }).eq("id", id);
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
    .select("id,plan_id,recipe_id,day,meal_slot,position,servings,leftover_of").eq("plan_id", planId).order("position");
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

// A leftover copies its source's recipe so it renders normally in its slot,
// and carries leftover_of so the grocery list skips it.
export async function addLeftover(
  planId: string, sourceItemId: string,
  opts: { day: string | null; mealSlot: MealSlot | null },
): Promise<MealPlanItem> {
  const { data: src, error: sErr } = await supabase.from("meal_plan_items")
    .select("recipe_id").eq("id", sourceItemId).single();
  if (sErr) throw new Error(sErr.message);
  const { data, error } = await supabase.from("meal_plan_items")
    .insert({
      plan_id: planId, recipe_id: (src as { recipe_id: string }).recipe_id,
      day: opts.day, meal_slot: opts.mealSlot, leftover_of: sourceItemId,
    })
    .select("id,plan_id,recipe_id,day,meal_slot,position,servings,leftover_of").single();
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


// What is coming up across every plan the caller can READ, which RLS already
// defines as "mine, or shared with a family I am in" (plan_items_read =
// can_read_plan). So this needs no ownership filter and no RPC: asking for the
// rows IS asking the right question.
export async function listUpcoming(days: number): Promise<UpcomingItem[]> {
  const from = today();
  const to = addDays(from, days);
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("meal_plan_items")
    .select("id,day,meal_slot,servings,leftover_of,recipes(id,title,servings),meal_plans(id,name,owner_id)")
    .gte("day", from).lt("day", to).order("day");
  if (error) throw new Error(error.message);

  const SLOT_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2 };
  return ((data ?? []) as any[])
    .filter((r) => r.recipes && r.meal_plans)
    .map((r) => ({
      id: r.id, day: r.day, meal_slot: r.meal_slot, servings: r.servings,
      recipe: r.recipes,
      plan: { id: r.meal_plans.id, name: r.meal_plans.name },
      isLeftover: r.leftover_of !== null,
      readOnly: r.meal_plans.owner_id !== auth?.user?.id,
    }))
    .sort((a, b) => a.day === b.day
      ? (SLOT_ORDER[a.meal_slot ?? ""] ?? 9) - (SLOT_ORDER[b.meal_slot ?? ""] ?? 9)
      : (a.day < b.day ? -1 : 1));
}

// Clone a plan onto a new start date. The shifting and the leftover repointing
// happen inside the duplicate_plan RPC so a half-cloned plan is impossible.
export async function duplicatePlan(id: string, newStartDate: string): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_plan", { p_id: id, p_start: newStartDate });
  if (error) throw new Error(error.message);
  return data as string;
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

// The shared half of every grocery list: turn a set of meal_plan_items rows
// into scaled ingredient rows, then hand them to buildGroceryList with the
// family's staples and aisle tags. Both getGroceryList and
// getUpcomingGroceryList call this; only the query that produced `items` and
// the checked/manual inputs differ between them.
async function groceryLinesFromItems(
  items: { recipe_id: string; servings: number | null }[],
  manualList: { id: string; label: string }[],
  checkedKeys: string[],
  familyId: string | null | undefined,
): Promise<GroceryLine[]> {
  // De-dupe by the (recipe_id, servings) pair, not by recipe alone: the same
  // recipe planned for 8 and for 2 must contribute twice, scaled differently.
  // The same recipe at the same servings still contributes once.
  const pairs = new Map<string, { recipeId: string; servings: number | null }>();
  for (const r of items) {
    pairs.set(`${r.recipe_id}:${r.servings ?? ""}`, { recipeId: r.recipe_id, servings: r.servings ?? null });
  }
  const recipeIds = Array.from(new Set(Array.from(pairs.values()).map((p) => p.recipeId)));
  const rows: IngredientRow[] = [];
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
  // The cupboard is family-scoped, so a plan with no family (or a family with
  // none recorded) simply flags nothing.
  const pantry = familyId ? await listPantry(familyId) : [];
  // A family's own aisle tags beat the shared catalog, so an ingredient the
  // catalog has never heard of stops falling into Other once they tag it.
  const categories = familyId ? await listCategoryOverrides(familyId) : new Map<string, string>();
  return buildGroceryList(
    rows, manualList, checkedKeys,
    {
      // An item you are low on or out of is a thing to BUY, not a thing to
      // assume you have. This one filter is the whole "do we need more rice"
      // job. A week item is never a staple: it is this week's food, and it
      // belongs on the list like anything else.
      staples: new Set(
        pantry.filter((p) => p.kind === "keep" && p.state === "have").map((p) => p.key),
      ),
      categories,
    },
  );
}

// Derived at read time: gather ingredients from the plan's DISTINCT
// (recipe, servings) pairs, scale each pair's rows to its target, then group by
// normalized name. Never stored.
export async function getGroceryList(planId: string): Promise<GroceryLine[]> {
  const [{ data: plan, error: pErr }, { data: items, error: iErr }, { data: manual, error: mErr }] = await Promise.all([
    supabase.from("meal_plans").select("checked_items,family_id").eq("id", planId).single(),
    // A leftover is the same pot eaten again, so it buys nothing. This is the
    // ONLY place leftovers are filtered out: buildGroceryList never needs to
    // know the concept exists.
    supabase.from("meal_plan_items").select("recipe_id,servings").eq("plan_id", planId).is("leftover_of", null),
    supabase.from("meal_plan_manual_items").select("id,label").eq("plan_id", planId).order("position"),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (iErr) throw new Error(iErr.message);
  if (mErr) throw new Error(mErr.message);

  const manualList = ((manual ?? []) as any[]).map((m) => ({ id: m.id, label: m.label }));
  return groceryLinesFromItems(
    (items ?? []) as any[], manualList, ((plan?.checked_items ?? []) as string[]),
    (plan as { family_id?: string } | null)?.family_id,
  );
}

// The same list, but merged across every plan the caller can read in the next
// `days` days: what My Kitchen shows, so the shopping list matches the window
// on screen. The window is worked out exactly as listUpcoming does it.
export async function getUpcomingGroceryList(days: number): Promise<{
  lines: GroceryLine[];
  planIds: string[];
}> {
  const from = today();
  const to = addDays(from, days);
  // RLS already limits these rows to plans the caller can read, so asking for
  // the window IS asking the right question; no ownership filter needed.
  const { data: items, error } = await supabase.from("meal_plan_items")
    .select("plan_id,recipe_id,servings")
    .gte("day", from).lt("day", to)
    .is("leftover_of", null);
  if (error) throw new Error(error.message);

  const rows = (items ?? []) as { plan_id: string; recipe_id: string; servings: number | null }[];
  const planIds = Array.from(new Set(rows.map((r) => r.plan_id)));
  if (!planIds.length) return { lines: [], planIds };

  const { data: plans, error: pErr } = await supabase.from("meal_plans")
    .select("id,checked_items,family_id").in("id", planIds);
  if (pErr) throw new Error(pErr.message);

  // A merged line can be ticked in any of the plans it came from, so the
  // checked set is the union of theirs.
  const checked = new Set<string>();
  for (const p of (plans ?? []) as any[]) {
    for (const key of (p.checked_items ?? []) as string[]) checked.add(key);
  }
  // Staples are family-scoped and every plan in a merged view belongs to the
  // same family, so the first plan that has one answers for all of them.
  const familyId = ((plans ?? []) as any[]).find((p) => p.family_id)?.family_id ?? null;
  // Manual items belong to one plan and have no meaning in a merged view.
  const lines = await groceryLinesFromItems(rows, [], Array.from(checked), familyId);
  return { lines, planIds };
}

// A merged line can come from two plans at once, so ticking it has to tick it
// in both or the merged view and the per-plan view would disagree the next time
// you opened either. Sequential, not Promise.all: toggleChecked is a
// read-modify-write of an array, and concurrent writes to the same row would
// lose one.
export async function toggleCheckedAcross(planIds: string[], key: string, checked: boolean): Promise<void> {
  for (const planId of planIds) {
    await toggleChecked(planId, key, checked);
  }
}
