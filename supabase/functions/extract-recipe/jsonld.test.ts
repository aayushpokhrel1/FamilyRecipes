import { describe, it, expect } from "vitest";
import { parseRecipeJsonLd, splitIngredient } from "./jsonld";

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
