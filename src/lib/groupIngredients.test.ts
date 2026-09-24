import { groupIngredientsBySection, groupIngredientsByCategory } from "./groupIngredients";
import type { Ingredient } from "./api/types";

const ing = (item: string, section: string | null = null): Ingredient =>
  ({ position: 0, quantity: null, unit: null, item, section });

test("section grouping keeps first-seen order and treats blank as ungrouped", () => {
  const groups = groupIngredientsBySection([
    ing("garlic", "For the sauce"), ing("salt", "  "), ing("basil", "For the sauce"),
  ]);
  expect(groups.map((g) => g.section)).toEqual(["For the sauce", null]);
  expect(groups[0].items).toHaveLength(2);
});

test("category grouping walks the catalog order, produce first", () => {
  const groups = groupIngredientsByCategory([
    ing("cumin"), ing("onion"), ing("butter"), ing("garlic"),
  ]);
  expect(groups.map((g) => g.section)).toEqual(["Produce", "Spices", "Dairy & Eggs"]);
  expect(groups[0].items.map((i) => i.item)).toEqual(["onion", "garlic"]);
});

test("an unknown ingredient lands in a trailing Other group, never dropped", () => {
  const groups = groupIngredientsByCategory([ing("dragonfruit shrub"), ing("onion")]);
  expect(groups.map((g) => g.section)).toEqual(["Produce", "Other"]);
  expect(groups.flatMap((g) => g.items)).toHaveLength(2);
});

test("every ingredient survives grouping", () => {
  const items = [ing("onion"), ing("cumin"), ing("mystery powder"), ing("butter")];
  expect(groupIngredientsByCategory(items).flatMap((g) => g.items)).toHaveLength(items.length);
});

test("category grouping honours a family's overrides too", () => {
  const groups = groupIngredientsByCategory(
    [ing("besan"), ing("onion")],
    new Map([["besan", "Pantry & Grains"]]),
  );
  expect(groups.map((g) => g.section)).toEqual(["Produce", "Pantry & Grains"]);
});

test("an aisle a family invented sorts after the known ones but before Other", () => {
  const groups = groupIngredientsByCategory(
    [ing("mystery item"), ing("patis"), ing("onion")],
    new Map([["pati", "Filipino pantry"]]),
  );
  expect(groups.map((g) => g.section)).toEqual(["Produce", "Filipino pantry", "Other"]);
});
