import { inferCategory, CATEGORY_ORDER, mergeSectionSuggestions, SECTION_SUGGESTIONS } from "./catalog";

test("finds the aisle for a plain catalog item", () => {
  expect(inferCategory("onion")).toBe("Produce");
  expect(inferCategory("cumin")).toBe("Spices");
  expect(inferCategory("butter")).toBe("Dairy & Eggs");
});

test("matches through the normalizer, so plurals and prep words do not matter", () => {
  expect(inferCategory("Tomatoes")).toBe("Produce");
  expect(inferCategory("garlic, minced")).toBe("Produce");
  expect(inferCategory("chopped onions")).toBe("Produce");
});

test("falls back to the longest trailing match", () => {
  // not in the catalog verbatim, but the head word is
  expect(inferCategory("smoked paprika")).toBe("Spices");
  expect(inferCategory("fresh basil")).toBe("Herbs");
});

test("prefers the longer match when two could apply", () => {
  // "black pepper" is a spice; "bell pepper" is produce. Neither may borrow
  // the other's aisle just because both end in "pepper".
  expect(inferCategory("black pepper")).toBe("Spices");
  expect(inferCategory("bell pepper")).toBe("Produce");
});

test("returns null rather than guessing at something unknown", () => {
  expect(inferCategory("dragonfruit shrub")).toBeNull();
  expect(inferCategory("")).toBeNull();
});

test("category order starts at produce and lists every catalog category once", () => {
  expect(CATEGORY_ORDER[0]).toBe("Produce");
  expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
});

test("a catalog term at the head of the name still resolves", () => {
  // the written ingredient names a cut, the catalog knows the animal
  expect(inferCategory("chicken thighs")).toBe("Proteins");
  expect(inferCategory("beef chuck")).toBe("Proteins");
});

test("a tail match still wins over a head match", () => {
  // stock is a pantry item even though it starts with a protein
  expect(inferCategory("chicken stock")).toBe("Pantry & Grains");
});

test("salt is a seasoning, not a baking good", () => {
  expect(inferCategory("salt")).toBe("Spices");
  expect(inferCategory("kosher salt")).toBe("Spices");
});

test("cooking fats and cheeses beyond the western default resolve too", () => {
  expect(inferCategory("ghee")).toBe("Dairy & Eggs");
  expect(inferCategory("paneer")).toBe("Dairy & Eggs");
});

test("section suggestions put the family's own wording first", () => {
  const merged = mergeSectionSuggestions(["For the tadka", "For the sauce"]);
  expect(merged[0]).toBe("For the tadka");
  expect(merged).toContain("Garnish");
});

test("a family section that matches a common one is not offered twice", () => {
  const merged = mergeSectionSuggestions(["for the SAUCE "]);
  const sauces = merged.filter((s) => s.toLowerCase().includes("sauce"));
  expect(sauces).toEqual(["for the SAUCE"]);
});

test("blank history entries are ignored", () => {
  expect(mergeSectionSuggestions(["", "   "])).toEqual(SECTION_SUGGESTIONS);
});
