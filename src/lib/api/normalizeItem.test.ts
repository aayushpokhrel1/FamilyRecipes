// src/lib/api/normalizeItem.test.ts
import { test, expect } from "vitest";
import { normalizeItem } from "./normalizeItem";

test("lowercases, trims, and collapses whitespace", () => {
  expect(normalizeItem("  Flour ")).toBe("flour");
  // deliberately not "all purpose flour": that is now a synonym for "flour",
  // so it would test the synonym map rather than whitespace collapsing
  expect(normalizeItem("tamarind   PASTE")).toBe("tamarind paste");
});
test("drops a trailing descriptor after a comma", () => {
  expect(normalizeItem("flour, sifted")).toBe("flour");
});
test("strips common prep/quality words", () => {
  expect(normalizeItem("chopped onions")).toBe("onion");
  expect(normalizeItem("fresh diced tomatoes")).toBe("tomato");
});
test("naive singularize on the last word", () => {
  expect(normalizeItem("eggs")).toBe("egg");
  expect(normalizeItem("tomatoes")).toBe("tomato");
  expect(normalizeItem("berries")).toBe("berry");
  expect(normalizeItem("green onions")).toBe("green onion");
});
test("does not over-strip a two-letter word or double-s", () => {
  expect(normalizeItem("glass")).toBe("glass");
});

test("normalizeItem maps known synonyms to a canonical name", () => {
  expect(normalizeItem("all-purpose flour")).toBe(normalizeItem("flour"));
  expect(normalizeItem("scallions")).toBe(normalizeItem("green onions"));
  expect(normalizeItem("garbanzo beans")).toBe(normalizeItem("chickpeas"));
});

test("synonyms apply after prep words and plurals are stripped", () => {
  expect(normalizeItem("Scallions, finely chopped")).toBe(normalizeItem("green onion"));
  expect(normalizeItem("All-Purpose Flour, sifted")).toBe(normalizeItem("flour"));
});

test("an unknown item is left alone", () => {
  expect(normalizeItem("tamarind paste")).toBe("tamarind paste");
});

// Aayush had salt in the cupboard and the grocery list kept telling him to buy
// it. The row read "(2 mL) salt": extraction had put the quantity in the item
// field, so the key was "(2 ml) salt" and no cupboard entry could ever match it.
test("a quantity that leaked into the item name does not break the match", () => {
  expect(normalizeItem("(2 mL) salt")).toBe("salt");
  expect(normalizeItem("salt (2 mL)")).toBe("salt");
  expect(normalizeItem("(400 g) chopped tomatoes")).toBe("tomato");
});

// A parenthetical WITHOUT a digit is usually a real distinction, and merging it
// away would silently drop an ingredient. That is the worse failure, so it stays.
test("a parenthetical with no number is left alone", () => {
  expect(normalizeItem("chicken (thighs)")).toBe("chicken (thighs)");
});
