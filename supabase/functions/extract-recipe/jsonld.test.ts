import { describe, it, expect } from "vitest";
import { parseRecipeJsonLd, splitIngredient, cleanText } from "./jsonld";

describe("parseRecipeJsonLd", () => {
  it("maps a JSON-LD Recipe block to a draft", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test",
      recipeIngredient: ["1 cup flour", "2 eggs", "pinch salt"],
      recipeInstructions: ["Mix", "Bake"],
      recipeYield: "4",
      prepTime: "PT20M",
    })}</script></head><body>hi</body></html>`;

    const result = parseRecipeJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Test");
    expect(result!.ingredients).toEqual([
      { position: 0, quantity: "1", unit: "cup", item: "flour" },
      { position: 1, quantity: "2", unit: null, item: "eggs" },
      { position: 2, quantity: null, unit: null, item: "pinch salt" },
    ]);
    expect(result!.steps).toHaveLength(2);
    expect(result!.servings).toBe(4);
    expect(result!.prep_minutes).toBe(20);
  });

  it("returns null when there is no JSON-LD", () => {
    expect(parseRecipeJsonLd("<html><body>no jsonld</body></html>")).toBeNull();
  });

  it("decodes HTML entities in title, story, ingredients and steps", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Salt &amp; Pepper&nbsp;Chicken",
      description: "A simple&nbsp;weeknight dish &amp; family favorite",
      recipeIngredient: ["1 cup flour&nbsp;sifted", "salt &amp; pepper"],
      recipeInstructions: ["Mix&nbsp;well &amp; bake", "Serve&nbsp;hot"],
    })}</script></head><body>hi</body></html>`;

    const result = parseRecipeJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Salt & Pepper Chicken");
    expect(result!.story).toBe("A simple weeknight dish & family favorite");
    expect(result!.ingredients.map((i) => i.item)).toEqual(["flour sifted", "salt & pepper"]);
    expect(result!.steps.map((s) => s.text)).toEqual(["Mix well & bake", "Serve hot"]);

    const all = [
      result!.title,
      result!.story,
      ...result!.ingredients.map((i) => i.item),
      ...result!.steps.map((s) => s.text),
    ].join("\n");
    expect(all).not.toContain("&nbsp;");
    expect(all).not.toContain("&amp;");
  });
});

describe("cleanText", () => {
  test("folds &nbsp; into a normal space", () => {
    const result = cleanText("Cook, stirring occasionally,&nbsp;until");
    expect(result).toBe("Cook, stirring occasionally, until");
    expect(result).not.toContain("\u00A0");
  });

  test("decodes common named and numeric entities", () => {
    expect(cleanText("salt &amp; pepper")).toBe("salt & pepper");
    expect(cleanText("it&#39;s")).toBe("it's");
    expect(cleanText("it&#x27;s")).toBe("it's");
    expect(cleanText("it&rsquo;s")).toBe("it\u2019s");
    expect(cleanText("350&deg;F")).toBe("350\u00B0F");
  });

  test("decodes named entities case-insensitively", () => {
    expect(cleanText("a&NBSP;b")).toBe("a b");
    expect(cleanText("a&AMP;b")).toBe("a&b");
  });

  test("leaves unknown entities untouched", () => {
    expect(cleanText("&notarealentity;")).toBe("&notarealentity;");
  });

  test("leaves a bare ampersand alone", () => {
    expect(cleanText("salt & pepper")).toBe("salt & pepper");
  });

  test("does not collapse internal whitespace", () => {
    expect(cleanText("a  b")).toBe("a  b");
    expect(cleanText("a\nb")).toBe("a\nb");
  });

  test("trims", () => {
    expect(cleanText("  hello  ")).toBe("hello");
  });
});

describe("splitIngredient", () => {
  const cases: Array<[string, string | null, string | null, string]> = [
    ["2 cups all-purpose flour", "2", "cup", "all-purpose flour"],
    ["1 1/2 tsp kosher salt", "1 1/2", "teaspoon", "kosher salt"],
    ["1/2 cup of milk", "1/2", "cup", "milk"],
    ["3 large eggs", "3", null, "large eggs"],
    ["2-3 tablespoons olive oil", "2-3", "tablespoon", "olive oil"],
    ["2 to 3 cloves garlic, minced", "2-3", "clove", "garlic, minced"],
    ["1 (28-ounce) can crushed tomatoes", "1", "can", "(28-ounce) crushed tomatoes"],
    ["500 g beef chuck", "500", "gram", "beef chuck"],
    ["1.5 lbs potatoes", "1.5", "pound", "potatoes"],
    ["Salt and pepper to taste", null, null, "Salt and pepper to taste"],
    ["Zest of 1 lemon", null, null, "Zest of 1 lemon"],
  ];
  for (const [line, quantity, unit, item] of cases) {
    test(line, () => expect(splitIngredient(line)).toEqual({ quantity, unit, item }));
  }
});
