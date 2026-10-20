import { supabase } from "../../supabaseClient";
import type { Deviation, Dish, DishIngredient, DishStep, DishVersion, Snapshot } from "./types";

// Every call goes through .schema("kitchen"): these tables are not in the public schema, and
// the hosted project must also expose that schema BY HAND. See docs/OPERATIONS.md before
// blaming this file for "The schema must be one of the following".
const kitchen = () => supabase.schema("kitchen");

export async function listDishes(orgId: string): Promise<Dish[]> {
  const { data, error } = await kitchen()
    .from("dishes")
    .select("id,org_id,title,stage,trial_site_id,retired_at")
    .eq("org_id", orgId)
    .order("title");
  if (error) throw new Error(error.message);
  return (data ?? []) as Dish[];
}

export async function getDish(dishId: string): Promise<Dish | null> {
  // maybeSingle, not single: a dish the viewer's role may not read returns NO ROW rather than
  // an error, and that is a "not found" page, not a crash. The read ladder is in the database.
  const { data, error } = await kitchen()
    .from("dishes")
    .select("id,org_id,title,stage,trial_site_id,retired_at")
    .eq("id", dishId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Dish) ?? null;
}

export async function createDish(orgId: string, title: string): Promise<string> {
  const { data, error } = await kitchen().rpc("create_dish", { p_org: orgId, p_title: title });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listVersions(dishId: string): Promise<DishVersion[]> {
  const { data, error } = await kitchen()
    .from("dish_versions")
    .select("id,n,note,created_by,created_at")
    .eq("dish_id", dishId)
    .order("n", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DishVersion[];
}

export async function getVersion(
  versionId: string,
): Promise<{ ingredients: DishIngredient[]; steps: DishStep[] }> {
  const ing = await kitchen()
    .from("dish_ingredients")
    .select("position,quantity,unit,item,section")
    .eq("version_id", versionId)
    .order("position");
  if (ing.error) throw new Error(ing.error.message);
  const steps = await kitchen()
    .from("dish_steps")
    .select("position,text")
    .eq("version_id", versionId)
    .order("position");
  if (steps.error) throw new Error(steps.error.message);
  return {
    ingredients: (ing.data ?? []) as DishIngredient[],
    steps: (steps.data ?? []) as DishStep[],
  };
}

export async function reviseDish(
  dishId: string,
  note: string,
  ingredients: DishIngredient[],
  steps: DishStep[],
): Promise<string> {
  // One call, so a version and its children are written together. A half-written version is a
  // dish somebody cooks wrongly.
  const { data, error } = await kitchen().rpc("revise_dish", {
    p_dish: dishId,
    p_note: note,
    p_ingredients: ingredients,
    p_steps: steps,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function sendToTrial(dishId: string, siteId: string): Promise<void> {
  const { error } = await kitchen().rpc("send_to_trial", { p_dish: dishId, p_site: siteId });
  if (error) throw new Error(error.message);
}

export async function signOff(versionId: string): Promise<void> {
  const { error } = await kitchen().rpc("sign_off", { p_version: versionId });
  if (error) throw new Error(error.message);
}

export async function retireDish(dishId: string): Promise<void> {
  const { error } = await kitchen().rpc("retire_dish", { p_dish: dishId });
  if (error) throw new Error(error.message);
}

export async function unretireDish(dishId: string): Promise<void> {
  const { error } = await kitchen().rpc("unretire_dish", { p_dish: dishId });
  if (error) throw new Error(error.message);
}

/**
 * The version the sites are actually cooking: the latest APPROVED one, which is NOT the
 * latest one. A dish revised after sign-off keeps the approved version live until somebody
 * signs the new one off, and showing the newest instead would tell three kitchens to cook
 * something nobody approved.
 */
export async function menuVersionId(dishId: string): Promise<string | null> {
  const { data, error } = await kitchen().rpc("menu_version", { p_dish: dishId });
  if (error) throw new Error(error.message);
  return (data as string) ?? null;
}

export async function listDeviations(dishId: string): Promise<Deviation[]> {
  const { data, error } = await kitchen()
    .from("deviations")
    .select("id,site_id,note,created_at")
    .eq("dish_id", dishId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Deviation[];
}

export async function recordDeviation(
  dishId: string,
  siteId: string,
  note: string,
): Promise<string> {
  const { data, error } = await kitchen().rpc("record_deviation", {
    p_dish: dishId,
    p_site: siteId,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function publishDish(versionId: string): Promise<string> {
  const { data, error } = await kitchen().rpc("publish_dish", { p_version: versionId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function unpublishDish(dishId: string): Promise<void> {
  const { error } = await kitchen().rpc("unpublish_dish", { p_dish: dishId });
  if (error) throw new Error(error.message);
}

export async function getSnapshot(dishId: string): Promise<Snapshot | null> {
  const { data, error } = await kitchen()
    .from("published_snapshots")
    .select("recipe_id,version_id,published_at,unpublished_at")
    .eq("dish_id", dishId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Snapshot) ?? null;
}
