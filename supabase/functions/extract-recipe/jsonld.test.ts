import { describe, it, expect } from "vitest";
import { parseRecipeJsonLd } from "./jsonld";

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
    expect(result!.ingredients).toHaveLength(3);
    expect(result!.steps).toHaveLength(2);
    expect(result!.servings).toBe(4);
    expect(result!.prep_minutes).toBe(20);
  });

  it("returns null when there is no JSON-LD", () => {
    expect(parseRecipeJsonLd("<html><body>no jsonld</body></html>")).toBeNull();
  });
});
