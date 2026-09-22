# Brief: Slice 2 — portions scaling UI

Add a display-only portions stepper that scales displayed ingredient quantities. Uses the
`scaleIngredientQty` function already in `src/lib/api/quantity.ts`. Never mutates the recipe.

## Create `src/components/PortionsStepper.tsx` EXACTLY

```tsx
import { useEffect, useState } from "react";

// Display-only servings control. Reports a scale factor to the parent.
// When base servings is known, the value is a servings count and factor = value/base.
// When base is null/0, the value is a plain multiplier and factor = value.
export default function PortionsStepper(
  { base, onFactorChange }: { base: number | null; onFactorChange: (factor: number) => void },
) {
  const usesServings = base !== null && base > 0;
  const start = usesServings ? (base as number) : 1;
  const stepSize = usesServings ? 1 : 0.5;
  const minValue = stepSize;
  const [value, setValue] = useState(start);

  useEffect(() => { setValue(start); }, [start]);
  useEffect(() => {
    onFactorChange(usesServings ? value / (base as number) : value);
  }, [value, usesServings, base, onFactorChange]);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="portions">
      <span>{usesServings ? "Serves" : "Scale"}</span>
      <button type="button" aria-label="decrease" disabled={value <= minValue}
        onClick={() => setValue((v) => Math.max(minValue, round2(v - stepSize)))}>-</button>
      <span aria-label="portions value">{usesServings ? value : `x${value}`}</span>
      <button type="button" aria-label="increase"
        onClick={() => setValue((v) => round2(v + stepSize))}>+</button>
      {value !== start && (
        <button type="button" onClick={() => setValue(start)}>Reset</button>
      )}
    </div>
  );
}
```

## Create `src/components/PortionsStepper.test.tsx` EXACTLY

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import PortionsStepper from "./PortionsStepper";

test("increments servings and reports the scaled factor", () => {
  const onFactor = vi.fn();
  render(<PortionsStepper base={2} onFactorChange={onFactor} />);
  expect(onFactor).toHaveBeenLastCalledWith(1);
  fireEvent.click(screen.getByLabelText("increase"));
  expect(screen.getByLabelText("portions value")).toHaveTextContent("3");
  expect(onFactor).toHaveBeenLastCalledWith(1.5);
});

test("uses a multiplier when base servings is unknown", () => {
  const onFactor = vi.fn();
  render(<PortionsStepper base={null} onFactorChange={onFactor} />);
  expect(onFactor).toHaveBeenLastCalledWith(1);
  fireEvent.click(screen.getByLabelText("increase"));
  expect(onFactor).toHaveBeenLastCalledWith(1.5);
});
```

## Edit `src/pages/RecipeDetail.tsx`

1. Add imports at the top (with the other imports):
```tsx
import { useState } from "react"; // ADD useState to the existing react import if not present
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
```
(The file already imports `useEffect, useState` from react, so no react import change is needed; just add the two new lines.)

2. Inside the component, add state near the other useState calls:
```tsx
  const [factor, setFactor] = useState(1);
```

3. In the Ingredients `<section>`, immediately after `<h2>Ingredients</h2>`, insert:
```tsx
          <PortionsStepper base={recipe.servings} onFactorChange={setFactor} />
```

4. In that same list, change the quantity span from:
```tsx
                <span className="qty">{[g.quantity, g.unit].filter(Boolean).join(" ")}</span>
```
to:
```tsx
                <span className="qty">{[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}</span>
```

## Edit `src/pages/CookMode.tsx`

1. Add imports:
```tsx
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
```

2. Add state near the other useState calls:
```tsx
  const [servings, setServings] = useState<number | null>(null);
  const [factor, setFactor] = useState(1);
```

3. In the `getRecipe(id).then((data) => { ... })` block, after `setSteps(data.steps);` add:
```tsx
        setServings(data.recipe.servings);
```

4. In the `showIngredients` list, immediately before the `<ul className="cook-ings">`, wrap so the stepper shows above it. Replace:
```tsx
      {showIngredients && (
        <ul className="cook-ings">
          {ingredients.map((g, i) => (
            <li key={i}>
              {[g.quantity, g.unit].filter(Boolean).join(" ")} <span>{g.item}</span>
            </li>
          ))}
        </ul>
      )}
```
with:
```tsx
      {showIngredients && (
        <div>
          <PortionsStepper base={servings} onFactorChange={setFactor} />
          <ul className="cook-ings">
            {ingredients.map((g, i) => (
              <li key={i}>
                {[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")} <span>{g.item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
```

## Constraints
- Do not modify any other file. Do not touch brief.md. Do not run any commands.
- No em/en dashes anywhere.
