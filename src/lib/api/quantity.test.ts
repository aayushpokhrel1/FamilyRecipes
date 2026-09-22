import { test, expect } from "vitest";
import { parseQuantity, formatQuantity, scaleIngredientQty } from "./quantity";

test("parseQuantity handles integers, decimals, fractions, mixed, ranges", () => {
  expect(parseQuantity("2")).toEqual({ min: 2, max: 2 });
  expect(parseQuantity("2.5")).toEqual({ min: 2.5, max: 2.5 });
  expect(parseQuantity("1/2")).toEqual({ min: 0.5, max: 0.5 });
  expect(parseQuantity("1 1/2")).toEqual({ min: 1.5, max: 1.5 });
  expect(parseQuantity("2-3")).toEqual({ min: 2, max: 3 });
  expect(parseQuantity("2 to 3")).toEqual({ min: 2, max: 3 });
});

test("parseQuantity returns null for non-numeric", () => {
  expect(parseQuantity("a pinch")).toBeNull();
  expect(parseQuantity("")).toBeNull();
  expect(parseQuantity(null)).toBeNull();
  expect(parseQuantity("to taste")).toBeNull();
});

test("parseQuantity tolerates trailing text after a leading number", () => {
  expect(parseQuantity("2 tablespoons")).toEqual({ min: 2, max: 2, suffix: "tablespoons" });
  expect(parseQuantity("1/2 cup")).toEqual({ min: 0.5, max: 0.5, suffix: "cup" });
  expect(parseQuantity("1 1/2 cups")).toEqual({ min: 1.5, max: 1.5, suffix: "cups" });
  expect(parseQuantity("2-3 cloves")).toEqual({ min: 2, max: 3, suffix: "cloves" });
  expect(parseQuantity("2 to 3 cloves")).toEqual({ min: 2, max: 3, suffix: "cloves" });
  expect(parseQuantity("1 28-ounce can")).toEqual({ min: 1, max: 1, suffix: "28-ounce can" });
  expect(parseQuantity("½ cup")).toEqual({ min: 0.5, max: 0.5, suffix: "cup" });
  // No leading number: still unparseable.
  expect(parseQuantity("half a cup")).toBeNull();
  expect(parseQuantity("2 to taste")).toEqual({ min: 2, max: 2, suffix: "to taste" });
});

test("formatQuantity renders friendly fractions", () => {
  expect(formatQuantity(2)).toBe("2");
  expect(formatQuantity(0.5)).toBe("1/2");
  expect(formatQuantity(1.5)).toBe("1 1/2");
  expect(formatQuantity(0.75)).toBe("3/4");
  expect(formatQuantity(0.25)).toBe("1/4");
});

test("scaleIngredientQty scales, keeps ranges, passes through non-numeric", () => {
  expect(scaleIngredientQty("2", 2)).toBe("4");
  expect(scaleIngredientQty("1/2", 3)).toBe("1 1/2");
  expect(scaleIngredientQty("2-3", 2)).toBe("4-6");
  expect(scaleIngredientQty("1", 0.5)).toBe("1/2");
  expect(scaleIngredientQty("a pinch", 2)).toBe("a pinch");
  expect(scaleIngredientQty(null, 2)).toBeNull();
  expect(scaleIngredientQty("2", NaN)).toBe("2");
});

test("scaleIngredientQty scales the number and leaves trailing text alone", () => {
  expect(scaleIngredientQty("2 tablespoons", 2)).toBe("4 tablespoons");
  expect(scaleIngredientQty("1/2 cup", 3)).toBe("1 1/2 cup");
  expect(scaleIngredientQty("2-3 cloves", 2)).toBe("4-6 cloves");
  expect(scaleIngredientQty("1 28-ounce can", 2)).toBe("2 28-ounce can");
  expect(scaleIngredientQty("half a cup", 2)).toBe("half a cup");
});
