import { describe, expect, it } from "vitest";
import { stepSpeech } from "./stepSpeech";

describe("stepSpeech", () => {
  it("a step that mentions no ingredient returns just the step text", () => {
    const stepText = "Leave to rest.";
    const items = [
      { position: 1, quantity: "1", unit: null, item: "onion" }
    ];
    expect(stepSpeech(stepText, items, 1)).toBe(stepText);
  });

  it("a step text already ending in . does not gain a second one, and one ending in ? keeps it", () => {
    const stepText1 = "Fry the onion until soft.";
    const stepText2 = "Fry the onion until soft?";
    const items = [
      { position: 1, quantity: "1", unit: null, item: "onion" }
    ];
    expect(stepSpeech(stepText1, items, 1)).toBe("Fry the onion until soft. With 1 onion.");
    expect(stepSpeech(stepText2, items, 1)).toBe("Fry the onion until soft? With 1 onion.");
  });

  it("one matched ingredient reads ... With 1 onion.", () => {
    const stepText = "Fry the onion until soft";
    const items = [
      { position: 1, quantity: "1", unit: null, item: "onion" }
    ];
    expect(stepSpeech(stepText, items, 1)).toBe("Fry the onion until soft. With 1 onion.");
  });

  it("two matched ingredients join with and and no comma", () => {
    const stepText = "Fry the onion and garlic until soft";
    const items = [
      { position: 1, quantity: "1", unit: null, item: "onion" },
      { position: 2, quantity: "2", unit: null, item: "garlic" }
    ];
    expect(stepSpeech(stepText, items, 1)).toBe("Fry the onion and garlic until soft. With 1 onion and 2 garlic.");
  });

  it("three matched ingredients read A, B and C", () => {
    const stepText = "Fry the onion, garlic and pepper until soft";
    const items = [
      { position: 1, quantity: "1", unit: null, item: "onion" },
      { position: 2, quantity: "2", unit: null, item: "garlic" },
      { position: 3, quantity: "3", unit: null, item: "pepper" }
    ];
    expect(stepSpeech(stepText, items, 1)).toBe("Fry the onion, garlic and pepper until soft. With 1 onion, 2 garlic and 3 pepper.");
  });

  it("the amount is scaled by the factor", () => {
    const stepText = "Melt the butter.";
    const items = [
      { position: 1, quantity: "1", unit: "tbsp", item: "butter" }
    ];
    expect(stepSpeech(stepText, items, 2)).toBe("Melt the butter. With 2 tbsp butter.");
    // "1/2", not "0.5", because scaleIngredientQty formats a half as a fraction and this
    // speaks what the screen shows rather than formatting the same number a second way.
    expect(stepSpeech(stepText, items, 0.5)).toBe("Melt the butter. With 1/2 tbsp butter.");
  });

  it("an ingredient with quantity: null and unit: null speaks just its name", () => {
    const stepText = "Add the salt.";
    const items = [
      { position: 1, quantity: null, unit: null, item: "salt" }
    ];
    expect(stepSpeech(stepText, items, 1)).toBe("Add the salt. With salt.");
  });

  it("an empty or whitespace-only step text returns the empty string", () => {
    expect(stepSpeech("", [], 1)).toBe("");
    expect(stepSpeech(" ", [], 1)).toBe("");
  });
});
