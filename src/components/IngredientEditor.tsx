import type { Ingredient } from "../lib/api/types";

export default function IngredientEditor({
  items,
  onChange,
}: {
  items: Ingredient[];
  onChange: (items: Ingredient[]) => void;
}) {
  function update(index: number, patch: Partial<Ingredient>) {
    onChange(items.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div>
      <h2>Ingredients</h2>
      {items.map((g, i) => (
        <div key={i}>
          <input
            value={g.quantity ?? ""}
            onChange={(e) => update(i, { quantity: e.target.value })}
            placeholder="Qty"
          />
          <input
            value={g.unit ?? ""}
            onChange={(e) => update(i, { unit: e.target.value })}
            placeholder="Unit"
          />
          <input
            value={g.item}
            onChange={(e) => update(i, { item: e.target.value })}
            placeholder="Item"
          />
          <button type="button" onClick={() => remove(i)}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { position: items.length, quantity: "", unit: "", item: "" }])}
      >
        Add ingredient
      </button>
    </div>
  );
}
