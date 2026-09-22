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
