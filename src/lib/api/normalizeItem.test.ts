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
