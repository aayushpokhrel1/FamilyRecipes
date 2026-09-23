import { normalizeItem } from "./normalizeItem";
import { normalizeUnit, unitFamily, toBase, fromBase, type UnitFamily } from "./units";
import { parseQuantity, formatQuantity } from "./quantity";
import type { GroceryLine, GroceryContribution } from "./types";

export interface IngredientRow {
  recipeTitle: string; quantity: string | null; unit: string | null; item: string;
  scaled: boolean;
}

// Sum a line's contributions per unit family. A contribution merges only when
// its quantity is a single parseable value (not a range like "2-3") and its
// unit is recognized. Anything else leaves the line partial, so the UI can say
// the total is not the whole story.
function summarize(cs: GroceryContribution[]): { totals: { quantity: string; unit: string }[]; partial: boolean } {
  const byFamily = new Map<UnitFamily, number>();
  let partial = false;

  for (const c of cs) {
    const family = unitFamily(c.unit);
    const parsed = parseQuantity(c.quantity);
    const unit = normalizeUnit(c.unit);
    if (!family || !unit || !parsed || parsed.min !== parsed.max) { partial = true; continue; }
    const base = toBase(parsed.min, unit);
    if (base === null) { partial = true; continue; }
    byFamily.set(family, (byFamily.get(family) ?? 0) + base);
  }

  const totals = Array.from(byFamily.entries()).map(([family, base]) => {
    const { value, unit } = fromBase(base, family);
    return { quantity: formatQuantity(value), unit };
  });
  return { totals, partial: partial || totals.length > 1 };
}

// Callers pass ingredient rows already de-duped at recipe level (a recipe placed
// in several slots contributes its ingredients once). Each contribution keeps its
// own quantity, and the line carries the summed totals per unit family.
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
      line = {
        key, name: r.item, contributions: [], checked: checked.has(key), manual: false,
        totals: [], partial: false,
      };
      byKey.set(key, line);
      order.push(key);
    }
    const c: GroceryContribution = {
      quantity: r.quantity, unit: r.unit, recipeTitle: r.recipeTitle, scaled: r.scaled,
    };
    line.contributions.push(c);
  }

  const lines = order.map((k) => {
    const line = byKey.get(k)!;
    const { totals, partial } = summarize(line.contributions);
    return { ...line, totals, partial };
  });
  for (const m of manual) {
    const key = `manual:${m.id}`;
    lines.push({
      key, name: m.label, contributions: [], checked: checked.has(key), manual: true,
      totals: [], partial: false,
    });
  }
  return lines;
}
