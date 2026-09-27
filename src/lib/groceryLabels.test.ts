import { expect, test } from "vitest";
import { contribLabel, lineName, qtyIsRedundant } from "./groceryLabels";
import type { GroceryLine } from "./api/types";

function line(over: Partial<GroceryLine>): GroceryLine {
  return {
    key: "k", name: "salt", contributions: [], checked: false, manual: false,
    totals: [], partial: false, staple: false, category: null, optional: false,
    ...over,
  } as GroceryLine;
}
const c = (quantity: string | null, unit: string | null, recipeTitle = "Ribs") =>
  ({ quantity, unit, recipeTitle, scaled: false });

// Aayush's report: the line read "0.42 tsp" and then, immediately after,
// "0.42 teaspoon (Boneless BBQ Pork Ribs)" in a fainter style. Same number twice.
test("a single contribution does not reprint the amount the totals already show", () => {
  const l = line({ contributions: [c("0.42", "teaspoon")], totals: [{ quantity: "0.42", unit: "tsp" }] });
  expect(qtyIsRedundant(l)).toBe(true);
  expect(contribLabel(l.contributions[0], { redundant: true })).toBe("(Ribs)");
});

// With several recipes the per-recipe amounts ARE the breakdown: that is the whole
// reason the contributions are listed, so they must survive.
test("several contributions keep their own amounts", () => {
  const l = line({
    contributions: [c("1", "cup", "Pilaf"), c("2", "cup", "Soup")],
    totals: [{ quantity: "3", unit: "cup" }],
  });
  expect(qtyIsRedundant(l)).toBe(false);
  expect(contribLabel(l.contributions[0])).toBe("1 cup (Pilaf)");
});

// No parsed total (a pinch, a range) means the raw quantity is the ONLY amount on
// the line. Hiding it would leave the cook with no measurement at all.
test("an unmeasurable single contribution keeps its quantity", () => {
  const l = line({ contributions: [c("a pinch", null)], totals: [] });
  expect(qtyIsRedundant(l)).toBe(false);
  expect(contribLabel(l.contributions[0])).toBe("a pinch (Ribs)");
});

test("a leaked quantity is not shown in the item name", () => {
  expect(lineName(line({ name: "(2 mL) salt" }))).toBe("salt");
  // Casing is preserved: this is the display name, not the matching key.
  expect(lineName(line({ name: "(1 mL) freshly ground black pepper" })))
    .toBe("freshly ground black pepper");
  expect(lineName(line({ name: "chicken (thighs)" }))).toBe("chicken (thighs)");
});
