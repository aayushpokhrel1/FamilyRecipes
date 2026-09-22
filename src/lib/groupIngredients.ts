import type { Ingredient } from "./api/types";

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
