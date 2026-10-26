// The sentence Cook Mode reads out for one step.
//
// The amounts are the whole reason this is not just the step text: they are what a cook would
// otherwise wipe their hands and pick the phone up to re-read. Pure and separate from the
// component, like ingredientsForStep next door, so the wording can be tested without rendering
// anything and without a speech engine.
//
// IT SPEAKS WHAT THE SCREEN SHOWS, including fractions: scaleIngredientQty formats a half as
// "1/2", and that string goes to the speech engine as it stands rather than being reformatted
// here. Two copies of the formatting rule would drift, and the one on screen is the one that
// has to be right.
import type { Ingredient } from "./api/types";
import { ingredientsForStep } from "./groupIngredients";
import { scaleIngredientQty } from "./api/quantity";
import { displayItem } from "./api/normalizeItem";

/**
* Generates a speech string for a cooking step, including ingredient quantities scaled by a factor.
* @param stepText - The text of the cooking step.
* @param items - The list of ingredients.
* @param factor - The scaling factor for ingredient quantities.
* @returns The generated speech string.
*/
export function stepSpeech(stepText: string, items: Ingredient[], factor: number): string {
  let base = stepText.trim();
  if (base === "") {
    return "";
  }

  if (!["!", "?", "."].includes(base.slice(-1))) {
    base += ".";
  }

  const matched = ingredientsForStep(items, stepText);
  if (matched.length === 0) {
    return base;
  }

  const phrases = matched.map((g) => {
    const parts = [
      scaleIngredientQty(g.quantity, factor),
      g.unit,
      displayItem(g.item),
    ].filter((part): part is string => part !== null && part !== undefined && part !== "");
    return parts.join(" ");
  });

  let list: string;
  if (phrases.length === 1) {
    list = phrases[0];
  } else if (phrases.length === 2) {
    list = `${phrases[0]} and ${phrases[1]}`;
  } else {
    list = `${phrases.slice(0, -1).join(", ")} and ${phrases.slice(-1)}`;
  }

  return `${base} With ${list}.`;
}