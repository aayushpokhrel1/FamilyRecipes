import { test, expect } from "vitest";
import { buildGroceryList, type IngredientRow } from "./grocery";

test("groups the same ingredient across recipes into one line", () => {
  const lines = buildGroceryList(
    [
      { recipeTitle: "Bread", quantity: "2", unit: "cups", item: "Flour", scaled: false },
      { recipeTitle: "Pancakes", quantity: "1", unit: "cup", item: "flour", scaled: false },
      { recipeTitle: "Pancakes", quantity: "3", unit: null, item: "eggs", scaled: false },
    ],
    [],
    [],
  );
  const flour = lines.find((l) => l.key === "flour")!;
  expect(flour.name).toBe("Flour");
  expect(flour.contributions).toHaveLength(2);
  expect(lines.map((l) => l.key)).toEqual(["flour", "egg"]);
});

test("marks checked lines and appends manual items", () => {
  const lines = buildGroceryList(
    [{ recipeTitle: "Bread", quantity: "2", unit: "cups", item: "Flour", scaled: false }],
    [{ id: "m1", label: "Aluminium foil" }],
    ["flour"],
  );
  expect(lines.find((l) => l.key === "flour")!.checked).toBe(true);
  const manual = lines.find((l) => l.key === "manual:m1")!;
  expect(manual.manual).toBe(true);
  expect(manual.name).toBe("Aluminium foil");
  expect(manual.contributions).toHaveLength(0);
});

const row = (o: Partial<IngredientRow> & { item: string }): IngredientRow => ({
  recipeTitle: "R", quantity: null, unit: null, scaled: false, ...o,
});

test("sums contributions that share a unit", () => {
  const [line] = buildGroceryList([
    row({ item: "flour", quantity: "2", unit: "cups", recipeTitle: "A" }),
    row({ item: "flour", quantity: "1", unit: "cup", recipeTitle: "B" }),
  ], [], []);
  expect(line.totals).toEqual([{ quantity: "3", unit: "cup" }]);
  expect(line.partial).toBe(false);
});

test("converts within a family before summing", () => {
  const [line] = buildGroceryList([
    row({ item: "olive oil", quantity: "2", unit: "tbsp" }),
    row({ item: "olive oil", quantity: "1/4", unit: "cup" }),
  ], [], []);
  expect(line.totals).toEqual([{ quantity: "6", unit: "tbsp" }]);
  expect(line.partial).toBe(false);
});

test("reports one total per family and flags the line as partial", () => {
  const [line] = buildGroceryList([
    row({ item: "flour", quantity: "1", unit: "cup" }),
    row({ item: "flour", quantity: "500", unit: "g" }),
  ], [], []);
  expect(line.totals).toHaveLength(2);
  expect(line.partial).toBe(true);
});

test("an unparseable quantity does not merge and marks the line partial", () => {
  const [line] = buildGroceryList([
    row({ item: "salt", quantity: "1", unit: "tsp" }),
    row({ item: "salt", quantity: "a pinch", unit: null }),
  ], [], []);
  expect(line.totals).toEqual([{ quantity: "1", unit: "tsp" }]);
  expect(line.partial).toBe(true);
});

test("a manual line has no totals and is not partial", () => {
  const lines = buildGroceryList([], [{ id: "m1", label: "napkins" }], []);
  expect(lines[0].totals).toEqual([]);
  expect(lines[0].partial).toBe(false);
});

test("a staple line is flagged, not dropped", () => {
  const rows = [{ recipeTitle: "Dal", quantity: "1", unit: "teaspoon", item: "salt", scaled: false }];
  const lines = buildGroceryList(rows, [], [], { staples: new Set(["salt"]) });
  expect(lines).toHaveLength(1);
  expect(lines[0].staple).toBe(true);
});

test("a line that is not a staple is untouched", () => {
  const rows = [{ recipeTitle: "Dal", quantity: "2", unit: "cup", item: "lentils", scaled: false }];
  expect(buildGroceryList(rows, [], [], { staples: new Set(["salt"]) })[0].staple).toBe(false);
});

test("a staple matches through the normalizer, not by raw text", () => {
  const rows = [{ recipeTitle: "Cake", quantity: "2", unit: "cup", item: "all-purpose flour", scaled: false }];
  // normalizeItem("all-purpose flour") is "flour", which is what addItem stores
  expect(buildGroceryList(rows, [], [], { staples: new Set(["flour"]) })[0].staple).toBe(true);
});

test("a grocery line carries the aisle it belongs to", () => {
  const rows = [
    { recipeTitle: "Dal", quantity: "1", unit: "cup", item: "red lentils", scaled: false },
    { recipeTitle: "Dal", quantity: "1", unit: null, item: "onion", scaled: false },
    { recipeTitle: "Dal", quantity: "1", unit: null, item: "unobtainium", scaled: false },
  ];
  const lines = buildGroceryList(rows, [], []);
  expect(lines.find((l) => l.key === "onion")!.category).toBe("Produce");
  expect(lines.find((l) => l.key === "red lentil")!.category).toBe("Pantry & Grains");
  // unknown stays null so the panel can bucket it as Other rather than guess
  expect(lines.find((l) => l.key === "unobtainium")!.category).toBeNull();
});

test("a manual line has no aisle", () => {
  const lines = buildGroceryList([], [{ id: "m1", label: "birthday candles" }], []);
  expect(lines[0].category).toBeNull();
});

test("a family's own aisle tag beats the catalog", () => {
  const rows = [
    { recipeTitle: "Chila", quantity: "1", unit: "cup", item: "besan", scaled: false },
    { recipeTitle: "Chila", quantity: "1", unit: null, item: "onion", scaled: false },
  ];
  const categories = new Map([["besan", "Pantry & Grains"]]);
  const lines = buildGroceryList(rows, [], [], { categories });
  // the catalog has never heard of besan, the family has
  expect(lines.find((l) => l.key === "besan")!.category).toBe("Pantry & Grains");
  // and an ingredient the catalog does know is unaffected
  expect(lines.find((l) => l.key === "onion")!.category).toBe("Produce");
});

test("an override can correct the catalog, not only extend it", () => {
  const rows = [{ recipeTitle: "X", quantity: "1", unit: null, item: "tomato", scaled: false }];
  const lines = buildGroceryList(rows, [], [], { categories: new Map([["tomato", "Canned"]]) });
  expect(lines[0].category).toBe("Canned");
});
