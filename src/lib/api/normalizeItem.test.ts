// src/lib/api/normalizeItem.test.ts
import { test, expect } from "vitest";
import { normalizeItem } from "./normalizeItem";

test("lowercases, trims, and collapses whitespace", () => {
  expect(normalizeItem("  Flour ")).toBe("flour");
  expect(normalizeItem("all   purpose FLOUR")).toBe("all purpose flour");
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
