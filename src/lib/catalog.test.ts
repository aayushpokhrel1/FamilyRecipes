import { test, expect } from "vitest";
import { mergeItemSuggestions, CATALOG_ITEMS } from "./catalog";

test("merges history after catalog, deduped case-insensitively", () => {
  const result = mergeItemSuggestions(["Onion", "gochujang", "  "]);
  // catalog items come first
  expect(result.slice(0, CATALOG_ITEMS.length)).toEqual(CATALOG_ITEMS);
  // a new history item is appended
  expect(result).toContain("gochujang");
  // "Onion" duplicates catalog "onion" (case-insensitive) and blanks are dropped
  expect(result.filter((x) => x.toLowerCase() === "onion")).toHaveLength(1);
});
