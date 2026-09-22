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
