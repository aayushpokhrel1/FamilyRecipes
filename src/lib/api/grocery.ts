import { normalizeItem } from "./normalizeItem";
import type { GroceryLine, GroceryContribution } from "./types";

export interface IngredientRow {
  recipeTitle: string; quantity: string | null; unit: string | null; item: string;
}

// Callers pass ingredient rows already de-duped at recipe level (a recipe placed
// in several slots contributes its ingredients once). Quantities are shown
// as-is, never summed.
export function buildGroceryList(
  rows: IngredientRow[],
  manual: { id: string; label: string }[],
  checkedKeys: string[],
): GroceryLine[] {
  const checked = new Set(checkedKeys);
  const order: string[] = [];
  const byKey = new Map<string, GroceryLine>();

  for (const r of rows) {
    const key = normalizeItem(r.item);
    if (!key) continue;
    let line = byKey.get(key);
    if (!line) {
      line = { key, name: r.item, contributions: [], checked: checked.has(key), manual: false };
      byKey.set(key, line);
      order.push(key);
    }
    const c: GroceryContribution = { quantity: r.quantity, unit: r.unit, recipeTitle: r.recipeTitle };
    line.contributions.push(c);
  }

  const lines = order.map((k) => byKey.get(k)!);
  for (const m of manual) {
    const key = `manual:${m.id}`;
    lines.push({ key, name: m.label, contributions: [], checked: checked.has(key), manual: true });
  }
  return lines;
}
