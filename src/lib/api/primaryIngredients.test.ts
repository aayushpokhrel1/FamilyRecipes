import { test, expect } from "vitest";
import { primaryIngredients } from "./primaryIngredients";

const row = (position: number, alt_group: string | null = null) => ({ position, alt_group });

test("keeps only the lowest position within a group", () => {
  const kept = primaryIngredients([
    row(0, "dairy"),
    row(1, "dairy"),
    row(2, "dairy"),
  ]);
  expect(kept.map((r) => r.position)).toEqual([0]);
});

test("rows with no group all survive", () => {
  const kept = primaryIngredients([row(0), row(1), row(2)]);
  expect(kept.map((r) => r.position)).toEqual([0, 1, 2]);
});

test("unsorted input still keeps the lowest position, not the first seen", () => {
  const kept = primaryIngredients([
    row(5, "dairy"),
    row(2, "dairy"),
    row(9, "dairy"),
  ]);
  expect(kept.map((r) => r.position)).toEqual([2]);
});

test("two groups in one recipe each keep their own primary", () => {
  const kept = primaryIngredients([
    row(0, "dairy"),
    row(1, "dairy"),
    row(2, "fat"),
    row(3, "fat"),
  ]);
  expect(kept.map((r) => r.position)).toEqual([0, 2]);
});

test("an empty list returns an empty list", () => {
  expect(primaryIngredients([])).toEqual([]);
});

test("an empty alt_group is treated as no group", () => {
  const kept = primaryIngredients([row(0, ""), row(1, "")]);
  expect(kept.map((r) => r.position)).toEqual([0, 1]);
});

test("survivors come back in position order", () => {
  const kept = primaryIngredients([row(3), row(1, "dairy"), row(2, "dairy"), row(0)]);
  expect(kept.map((r) => r.position)).toEqual([0, 1, 3]);
});
