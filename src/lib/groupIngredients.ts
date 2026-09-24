import type { Ingredient } from "./api/types";
import { categoryFor, CATEGORY_ORDER } from "./catalog";

export const OTHER = "Other";

export interface IngredientGroup { section: string | null; items: Ingredient[] }

// Group ingredients by section label, preserving first-seen order. A blank or
// whitespace-only section is treated as ungrouped (null).
export function groupIngredientsBySection(items: Ingredient[]): IngredientGroup[] {
  const groups: IngredientGroup[] = [];
  for (const g of items) {
    const key = g.section && g.section.trim() ? g.section : null;
    let grp = groups.find((x) => x.section === key);
    if (!grp) { grp = { section: key, items: [] }; groups.push(grp); }
    grp.items.push(g);
  }
  return groups;
}

// Group by the aisle each ingredient belongs to, for the "group by category"
// view. Categories keep the catalog's running order (produce first), and
// anything the catalog does not know falls into a trailing "Other" group so no
// ingredient can be silently dropped from the list.
export function groupIngredientsByCategory(
  items: Ingredient[], overrides?: Map<string, string>,
): IngredientGroup[] {
  const byCategory = new Map<string, Ingredient[]>();
  for (const g of items) {
    const key = categoryFor(g.item, overrides) ?? OTHER;
    byCategory.set(key, [...(byCategory.get(key) ?? []), g]);
  }
  // Known aisles in catalog order, then any aisle a family invented, then Other
  // last so unrecognised things stay at the bottom of the list.
  const known = new Set<string>([...CATEGORY_ORDER, OTHER]);
  const ordered = [...CATEGORY_ORDER.filter((c) => byCategory.has(c))];
  ordered.push(...[...byCategory.keys()].filter((c) => !known.has(c)).sort());
  if (byCategory.has(OTHER)) ordered.push(OTHER);
  return ordered.map((section) => ({ section, items: byCategory.get(section)! }));
}
