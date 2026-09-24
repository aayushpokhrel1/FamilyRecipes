import { test, expect } from "vitest";
import { seedSuggestions } from "./seedSuggestions";

const recipes = [
  { recipe_id: "1", title: "A", items: ["Salt", "Onion", "Rice"] },
  { recipe_id: "2", title: "B", items: ["salt", "onions", "Chicken"] },
  { recipe_id: "3", title: "C", items: ["Salt", "Olive oil"] },
];

test("ranks by how many recipes use it", () => {
  expect(seedSuggestions(recipes)[0]).toBe("Salt");
});

test("merges spellings that normalize the same", () => {
  const out = seedSuggestions(recipes);
  expect(out.filter((s) => s.toLowerCase().startsWith("onion"))).toHaveLength(1);
});

test("returns the spelling the family actually writes", () => {
  expect(seedSuggestions(recipes)).toContain("Olive oil");
});

test("an empty vault suggests nothing rather than throwing", () => {
  expect(seedSuggestions([])).toEqual([]);
});

test("honours the limit", () => {
  expect(seedSuggestions(recipes, 2)).toHaveLength(2);
});
