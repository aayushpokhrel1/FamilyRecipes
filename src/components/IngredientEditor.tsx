import { useState } from "react";
import IngredientCatalogPicker from "./IngredientCatalogPicker";
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
  const [showPicker, setShowPicker] = useState(false);
  const [namingRow, setNamingRow] = useState<number | null>(null);
  const [typedSection, setTypedSection] = useState("");

  function update(index: number, patch: Partial<Ingredient>) {
    onChange(items.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const usedSections = Array.from(
    new Set(items.map((g) => g.section).filter((s): s is string => !!s && s.trim() !== "")),
  );

  function startNaming(index: number) {
    setTypedSection("");
    setNamingRow(index);
  }

  function commitNaming(index: number) {
    update(index, { section: typedSection.trim() || null });
    setNamingRow(null);
    setTypedSection("");
  }

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
          <select
            aria-label={`Section for ${g.item || "this ingredient"}`}
            value={g.section && g.section.trim() ? g.section : ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "__new") startNaming(i);
              else update(i, { section: value || null });
            }}
          >
            <option value="">No section</option>
            {usedSections.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="__new">New section...</option>
          </select>
          {namingRow === i && (
            <span className="section-namer">
              <input
                autoFocus
                value={typedSection}
                onChange={(e) => setTypedSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitNaming(i); }
                  else if (e.key === "Escape") { setNamingRow(null); setTypedSection(""); }
                }}
                placeholder="Section name"
                aria-label={`New section name for ${g.item || "this ingredient"}`}
              />
              <button type="button" onClick={() => commitNaming(i)}>Done</button>
            </span>
          )}
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
      <button type="button" onClick={() => setShowPicker(true)}>Add from list</button>
      <datalist id="ingredient-items">
        {mergeItemSuggestions(itemSuggestions).map((name) => <option key={name} value={name} />)}
      </datalist>
      {showPicker && (
        <IngredientCatalogPicker
          defaultSection={items[items.length - 1]?.section ?? null}
          onClose={() => setShowPicker(false)}
          onAdd={(names, section) =>
            onChange([
              ...items,
              ...names.map((item, k) => ({ position: items.length + k, quantity: "", unit: "", item, section })),
            ])
          }
        />
      )}
    </div>
  );
}
