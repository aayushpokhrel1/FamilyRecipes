import type { Ingredient } from "../lib/api/types";
import { mergeItemSuggestions } from "../lib/catalog";

export default function IngredientEditor({
  items,
  onChange,
  itemSuggestions = [],
}: {
  items: Ingredient[];
  onChange: (items: Ingredient[]) => void;
  itemSuggestions?: string[];
}) {
  function update(index: number, patch: Partial<Ingredient>) {
    onChange(items.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const usedSections = Array.from(
    new Set(items.map((g) => g.section).filter((s): s is string => !!s && s.trim() !== "")),
  );

  return (
    <div>
      <h2>Ingredients</h2>
      {items.map((g, i) => (
        <div key={i} className="editor-row">
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
            list="ingredient-items"
          />
          <input
            value={g.section ?? ""}
            onChange={(e) => update(i, { section: e.target.value })}
            placeholder="Section"
            list="ingredient-sections"
          />
          <button type="button" onClick={() => remove(i)}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { position: items.length, quantity: "", unit: "", item: "", section: items[items.length - 1]?.section ?? null }])}
      >
        Add ingredient
      </button>
      <datalist id="ingredient-sections">
        {usedSections.map((s) => <option key={s} value={s} />)}
      </datalist>
      <datalist id="ingredient-items">
        {mergeItemSuggestions(itemSuggestions).map((name) => <option key={name} value={name} />)}
      </datalist>
    </div>
  );
}
