import { normalizeItem } from "./api/normalizeItem";
import type { CookNowRecipe } from "./cookNow";

// What to offer on an empty cupboard, drawn from the family's own recipes
// rather than a curated "everyone has salt" list. The assumption about what
// this household keeps then comes from this household, and it is visible and
// editable rather than hidden in the matcher.
export function seedSuggestions(recipes: CookNowRecipe[], limit = 20): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const r of recipes) {
    const seen = new Set<string>();
    for (const item of r.items) {
      const key = normalizeItem(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const prev = counts.get(key);
      counts.set(key, { label: prev?.label ?? item, n: (prev?.n ?? 0) + 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((c) => c.label);
}
