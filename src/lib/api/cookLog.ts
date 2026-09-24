import { supabase } from "../supabaseClient";
import type { CookEntry, NotCookedLately } from "./types";

// How long a recipe has to go unmade before it counts as forgotten. A season,
// roughly: long enough that a family's regulars never show up as suggestions,
// short enough that a dish from last month is not nagged about.
const NOT_COOKED_LATELY_DAYS = 90;

// cooked_at is left to the column default (now()), so the server's clock is the
// one that decides when this happened.
export async function logCooked(familyId: string, recipeId: string): Promise<CookEntry> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase.from("cook_log")
    .insert({ family_id: familyId, recipe_id: recipeId, cooked_by: auth.user.id })
    .select().single();
  if (error) throw new Error(error.message);
  return data as CookEntry;
}

// recipe id -> the most recent cooked_at for that family. PostgREST cannot
// group by, so the rows come back newest-first and the first one seen per
// recipe wins.
export async function lastCookedByRecipe(familyId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("cook_log")
    .select("recipe_id,cooked_at").eq("family_id", familyId).order("cooked_at", { ascending: false });
  if (error) throw new Error(error.message);
  const last = new Map<string, string>();
  for (const r of (data ?? []) as { recipe_id: string; cooked_at: string }[]) {
    if (!last.has(r.recipe_id)) last.set(r.recipe_id, r.cooked_at);
  }
  return last;
}

// "What has this family not made in a while": the family's recipes whose last
// cook is older than the threshold, plus the ones never cooked at all. Sorted
// oldest-first with never-cooked LAST, because a recipe nobody has ever cooked
// is a weaker suggestion than one the family loved and then forgot.
export async function notCookedLately(familyId: string, limit: number): Promise<NotCookedLately[]> {
  const { data: recipes, error } = await supabase.from("recipes")
    .select("id,title").eq("family_id", familyId);
  if (error) throw new Error(error.message);
  const last = await lastCookedByRecipe(familyId);

  const cutoff = Date.now() - NOT_COOKED_LATELY_DAYS * 24 * 60 * 60 * 1000;
  const stale: NotCookedLately[] = [];
  for (const r of (recipes ?? []) as { id: string; title: string }[]) {
    const cookedAt = last.get(r.id) ?? null;
    if (cookedAt === null) {
      stale.push({ recipe: { id: r.id, title: r.title }, lastCooked: null });
      continue;
    }
    if (new Date(cookedAt).getTime() < cutoff) {
      stale.push({ recipe: { id: r.id, title: r.title }, lastCooked: cookedAt });
    }
  }

  stale.sort((a, b) => {
    if (a.lastCooked === null && b.lastCooked === null) return 0;
    if (a.lastCooked === null) return 1;
    if (b.lastCooked === null) return -1;
    return a.lastCooked < b.lastCooked ? -1 : a.lastCooked > b.lastCooked ? 1 : 0;
  });
  return stale.slice(0, limit);
}
