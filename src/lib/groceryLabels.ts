import { displayItem } from "./api/normalizeItem";
import type { GroceryLine } from "./api/types";

// Shared by GroceryPanel and UpcomingGroceryPanel, which render the same rows from
// different queries. These three were duplicated verbatim in both files; the
// redundant-quantity rule below would have had to be written twice and would
// eventually have been written differently.

export function totalLabel(t: { quantity: string; unit: string }): string {
  return [t.quantity, t.unit].filter(Boolean).join(" ").trim();
}

// The shopping line's own name. "(2 mL) salt" is a quantity extraction put in the
// item field; it is noise next to the totals, which already say the amount.
export function lineName(line: GroceryLine): string {
  return displayItem(line.name);
}

// A contribution says which recipe wants this and how much that recipe asks for.
// The "how much" is only worth printing when the totals do not already say it:
// with ONE contribution and a parsed total, the line read "0.42 tsp" immediately
// followed by "0.42 teaspoon (Ribs)", the same number twice in two styles.
// With several contributions the per-recipe amounts ARE the breakdown, so they
// stay; with no parsed total (a pinch, a range) the raw quantity is the only
// amount there is, so it stays too.
export function contribLabel(
  c: { quantity: string | null; unit: string | null; recipeTitle: string },
  opts: { redundant?: boolean } = {},
): string {
  const qty = opts.redundant ? "" : [c.quantity, c.unit].filter(Boolean).join(" ").trim();
  return qty ? `${qty} (${c.recipeTitle})` : `(${c.recipeTitle})`;
}

export function qtyIsRedundant(line: GroceryLine): boolean {
  return line.contributions.length === 1 && line.totals.length > 0;
}
