import { test, expect } from "vitest";
import { cookNow, type CookNowRecipe } from "./cookNow";

const recipes: CookNowRecipe[] = [
  { recipe_id: "r1", title: "Chicken rice", items: ["Chicken thighs", "rice", "onion"] },
  { recipe_id: "r2", title: "Pilaf", items: ["rice", "onion", "cumin"] },
  { recipe_id: "r3", title: "Plain rice", items: ["Rice"] },
];

test("ranks by how much is missing, fewest first", () => {
  const out = cookNow(recipes, [
    { key: "chicken thigh", state: "have" },
    { key: "rice", state: "have" },
    { key: "onion", state: "have" },
  ]);
  expect(out.map((r) => r.title)).toEqual(["Chicken rice", "Plain rice", "Pilaf"]);
  expect(out[0].missing).toEqual([]);
  expect(out[2].missing).toEqual(["cumin"]);
});

test("an item marked out is not had", () => {
  const out = cookNow(recipes, [
    { key: "rice", state: "have" },
    { key: "onion", state: "out" },
  ]);
  const pilaf = out.find((r) => r.recipe_id === "r2")!;
  expect(pilaf.missing).toEqual(["onion", "cumin"]);
});

test("low still counts as had, but is reported", () => {
  const out = cookNow(recipes, [
    { key: "rice", state: "low" },
    { key: "onion", state: "have" },
    { key: "cumin", state: "have" },
  ]);
  const pilaf = out.find((r) => r.recipe_id === "r2")!;
  expect(pilaf.missing).toEqual([]);
  expect(pilaf.usesLow).toEqual(["rice"]);
});

// The chosen rule: no hidden "everyone has salt" set. An ingredient the
// cupboard has never heard of is missing.
test("an unknown ingredient is missing, not assumed", () => {
  const out = cookNow([{ recipe_id: "r", title: "T", items: ["saffron"] }], []);
  expect(out[0].missing).toEqual(["saffron"]);
  expect(out[0].haveCount).toBe(0);
});

// A degenerate empty case shipped an unreachable cook log last week. A recipe
// with nothing in it is not a recipe you can cook.
test("a recipe with no ingredients is excluded, not a perfect match", () => {
  const out = cookNow([{ recipe_id: "r", title: "Empty", items: [] }], [
    { key: "rice", state: "have" },
  ]);
  expect(out).toEqual([]);
});

test("an empty cupboard returns everything as all-missing rather than throwing", () => {
  const out = cookNow(recipes, []);
  expect(out).toHaveLength(3);
  expect(out.every((r) => r.haveCount === 0)).toBe(true);
});

test("reports the ingredient as written, not the normalized key", () => {
  const out = cookNow([{ recipe_id: "r", title: "T", items: ["Chopped Onions"] }], []);
  expect(out[0].missing).toEqual(["Chopped Onions"]);
});

test("the same ingredient twice counts once", () => {
  const out = cookNow([{ recipe_id: "r", title: "T", items: ["onion", "onions"] }], [
    { key: "onion", state: "have" },
  ]);
  expect(out[0].total).toBe(1);
  expect(out[0].missing).toEqual([]);
});
