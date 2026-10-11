import type { DishIngredient, DishStep } from "../../lib/api/kitchen/types";

/**
 * Plain rows of ingredients and steps, controlled by the caller.
 *
 * Deliberately NOT the family app's IngredientEditor: that one is typed against the family
 * Ingredient, which this app may not import, and it carries the catalog picker and aisle
 * suggestions, which are home-shopping ideas rather than kitchen ones.
 */
export default function DishEditor({
  ingredients,
  steps,
  onChange,
}: {
  ingredients: DishIngredient[];
  steps: DishStep[];
  onChange: (next: { ingredients: DishIngredient[]; steps: DishStep[] }) => void;
}) {
  const setIngredient = (i: number, patch: Partial<DishIngredient>) =>
    onChange({
      ingredients: ingredients.map((row, n) => (n === i ? { ...row, ...patch } : row)),
      steps,
    });
  const setStep = (i: number, text: string) =>
    onChange({ ingredients, steps: steps.map((row, n) => (n === i ? { ...row, text } : row)) });

  // position is 1-based and recomputed on every add, so a deleted row never leaves a gap the
  // database would store.
  const renumber = (rows: { position: number }[]) =>
    rows.map((row, i) => ({ ...row, position: i + 1 }));

  return (
    <>
      <h3>Ingredients</h3>
      {ingredients.map((row, i) => (
        <div key={i}>
          <label htmlFor={`qty-${i}`}>Quantity</label>
          <input
            id={`qty-${i}`}
            value={row.quantity ?? ""}
            onChange={(e) => setIngredient(i, { quantity: e.target.value })}
          />
          <label htmlFor={`unit-${i}`}>Unit</label>
          <input
            id={`unit-${i}`}
            value={row.unit ?? ""}
            onChange={(e) => setIngredient(i, { unit: e.target.value })}
          />
          <label htmlFor={`item-${i}`}>Ingredient</label>
          <input
            id={`item-${i}`}
            value={row.item}
            onChange={(e) => setIngredient(i, { item: e.target.value })}
          />
          <button
            type="button"
            onClick={() =>
              onChange({
                ingredients: renumber(ingredients.filter((_, n) => n !== i)) as DishIngredient[],
                steps,
              })
            }
          >
            Remove ingredient {i + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            ingredients: [
              ...ingredients,
              { position: ingredients.length + 1, quantity: "", unit: "", item: "", section: null },
            ],
            steps,
          })
        }
      >
        Add an ingredient
      </button>

      <h3>Method</h3>
      {steps.map((row, i) => (
        <div key={i}>
          <label htmlFor={`step-${i}`}>Step {i + 1}</label>
          <textarea id={`step-${i}`} value={row.text} onChange={(e) => setStep(i, e.target.value)} />
          <button
            type="button"
            onClick={() =>
              onChange({
                ingredients,
                steps: renumber(steps.filter((_, n) => n !== i)) as DishStep[],
              })
            }
          >
            Remove step {i + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({ ingredients, steps: [...steps, { position: steps.length + 1, text: "" }] })
        }
      >
        Add a step
      </button>
    </>
  );
}
