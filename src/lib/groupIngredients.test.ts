import { test, expect } from "vitest";
import { groupIngredientsBySection } from "./groupIngredients";

test("groups by section, blank becomes null, order preserved", () => {
  const groups = groupIngredientsBySection([
    { position: 0, quantity: "1", unit: "cup", item: "flour", section: "Dredging" },
    { position: 1, quantity: null, unit: null, item: "salt", section: "Spices" },
    { position: 2, quantity: "1", unit: null, item: "egg", section: "  " },
    { position: 3, quantity: "2", unit: null, item: "breadcrumbs", section: "Dredging" },
  ]);
  expect(groups.map((g) => g.section)).toEqual(["Dredging", "Spices", null]);
  expect(groups[0].items.map((i) => i.item)).toEqual(["flour", "breadcrumbs"]);
});
