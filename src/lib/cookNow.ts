import { normalizeItem } from "./api/normalizeItem";
import type { PantryState } from "./api/pantry";

export interface CookNowRecipe {
  recipe_id: string;
  title: string;
  items: string[];
}

export interface CookNowResult {
  recipe_id: string;
  title: string;
  total: number;
  haveCount: number;
  missing: string[];
  usesLow: string[];
}

// Matching runs on normalizeItem keys, the same key the grocery grouping and
// the cupboard itself use. One matching scheme in this app, not a second one
// that drifts out of step with the first.
//
// ponytail: matches client side over the whole family vault. Correct at family
// scale (tens to low hundreds of recipes); move to an RPC if a vault ever
// passes a few hundred.
export function cookNow(
  recipes: CookNowRecipe[],
  pantry: { key: string; state: PantryState }[],
): CookNowResult[] {
  const have = new Set(pantry.filter((p) => p.state !== "out").map((p) => p.key));
  const low = new Set(pantry.filter((p) => p.state === "low").map((p) => p.key));

  const results: CookNowResult[] = [];
  for (const r of recipes) {
    // Keep the first spelling of each key so results read the way the recipe
    // is written ("Chopped Onions"), not the way it is matched ("onion").
    const written = new Map<string, string>();
    for (const item of r.items) {
      const key = normalizeItem(item);
      if (key && !written.has(key)) written.set(key, item);
    }
    if (written.size === 0) continue;

    const missing: string[] = [];
    const usesLow: string[] = [];
    for (const [key, label] of written) {
      if (!have.has(key)) missing.push(label);
      else if (low.has(key)) usesLow.push(label);
    }
    results.push({
      recipe_id: r.recipe_id,
      title: r.title,
      total: written.size,
      haveCount: written.size - missing.length,
      missing,
      usesLow,
    });
  }

  results.sort((a, b) =>
    a.missing.length - b.missing.length ||
    b.haveCount - a.haveCount ||
    a.title.localeCompare(b.title));
  return results;
}
