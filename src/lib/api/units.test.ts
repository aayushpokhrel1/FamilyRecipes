import { test, expect } from "vitest";
import { normalizeUnit, unitFamily, toBase, fromBase } from "./units";

test("normalizeUnit folds freeform spellings to a canonical id", () => {
  expect(normalizeUnit("Tablespoons")).toBe("tbsp");
  expect(normalizeUnit("TBSP")).toBe("tbsp");
  expect(normalizeUnit(" tablespoon ")).toBe("tbsp");
  expect(normalizeUnit("cups")).toBe("cup");
  expect(normalizeUnit("grams")).toBe("g");
  expect(normalizeUnit("kilogram")).toBe("kg");
  expect(normalizeUnit("fl oz")).toBe("fl oz");
});

test("normalizeUnit returns null for nothing and for unknown units", () => {
  expect(normalizeUnit(null)).toBeNull();
  expect(normalizeUnit("")).toBeNull();
  expect(normalizeUnit("pinch")).toBeNull();
  expect(normalizeUnit("can")).toBeNull();
});

test("unitFamily keeps metric and imperial apart", () => {
  expect(unitFamily("tbsp")).toBe("volume-imperial");
  expect(unitFamily("ml")).toBe("volume-metric");
  expect(unitFamily("lb")).toBe("weight-imperial");
  expect(unitFamily("kg")).toBe("weight-metric");
  expect(unitFamily("pinch")).toBeNull();
});

test("toBase converts into the family base unit", () => {
  expect(toBase(1, "tbsp")).toBe(3);      // base tsp
  expect(toBase(1, "cup")).toBe(48);
  expect(toBase(1, "kg")).toBe(1000);     // base g
  expect(toBase(1, "lb")).toBe(16);       // base oz
  expect(toBase(1, "pinch")).toBeNull();
});

test("fromBase picks the largest unit that keeps the value at or above 1", () => {
  // 2 tbsp (6 tsp) + 1/4 cup (12 tsp) = 18 tsp, which is 6 tbsp, not 0.375 cup
  expect(fromBase(18, "volume-imperial")).toEqual({ value: 6, unit: "tbsp" });
  expect(fromBase(96, "volume-imperial")).toEqual({ value: 2, unit: "cup" });
  expect(fromBase(1250, "weight-metric")).toEqual({ value: 1.25, unit: "kg" });
});

test("fromBase falls back to the smallest unit below 1", () => {
  expect(fromBase(0.5, "volume-imperial")).toEqual({ value: 0.5, unit: "tsp" });
});
