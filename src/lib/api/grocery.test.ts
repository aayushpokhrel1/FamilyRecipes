import { test, expect } from "vitest";
import { buildGroceryList } from "./grocery";

test("groups the same ingredient across recipes into one line", () => {
  const lines = buildGroceryList(
    [
      { recipeTitle: "Bread", quantity: "2", unit: "cups", item: "Flour" },
      { recipeTitle: "Pancakes", quantity: "1", unit: "cup", item: "flour" },
      { recipeTitle: "Pancakes", quantity: "3", unit: null, item: "eggs" },
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
    [{ recipeTitle: "Bread", quantity: "2", unit: "cups", item: "Flour" }],
    [{ id: "m1", label: "Aluminium foil" }],
    ["flour"],
  );
  expect(lines.find((l) => l.key === "flour")!.checked).toBe(true);
  const manual = lines.find((l) => l.key === "manual:m1")!;
  expect(manual.manual).toBe(true);
  expect(manual.name).toBe("Aluminium foil");
  expect(manual.contributions).toHaveLength(0);
});
