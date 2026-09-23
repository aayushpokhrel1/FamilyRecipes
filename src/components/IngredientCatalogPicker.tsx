import { useState } from "react";
import { CATALOG } from "../lib/catalog";

// Modal: pick a category (Produce, Spices, ...) then check its ingredients; a search box cuts
// across every category at once. Checks survive switching categories.
export default function IngredientCatalogPicker(
  { onAdd, onClose, defaultSection }:
  { onAdd: (names: string[], section: string | null) => void; onClose: () => void; defaultSection?: string | null },
) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [section, setSection] = useState(defaultSection ?? "");
  const [category, setCategory] = useState(CATALOG[0].category);

  const q = query.trim().toLowerCase();
  const shown = q
    ? CATALOG
      .map((c) => ({ category: c.category, items: c.items.filter((i) => i.toLowerCase().includes(q)) }))
      .filter((c) => c.items.length > 0)
    : CATALOG.filter((c) => c.category === category);

  const selected = Object.keys(checked).filter((n) => checked[n]);

  function toggle(name: string) {
    setChecked((prev) => ({ ...prev, [name]: !prev[name] }));
  }
  function confirm() {
    if (selected.length) onAdd(selected, section.trim() || null);
    onClose();
  }

  return (
    <div className="catalog-overlay" role="dialog" aria-label="Add ingredients from list">
      <div className="catalog-modal plate">
        <h3>Add ingredients from list</h3>
        <div className="catalog-fields">
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all categories" aria-label="search ingredients" />
          <input value={section} onChange={(e) => setSection(e.target.value)}
            placeholder="Section (optional)" aria-label="target section" />
        </div>
        {!q && (
          <div className="catalog-cats" role="group" aria-label="categories">
            {CATALOG.map((c) => (
              <button key={c.category} type="button" className="chip"
                aria-pressed={c.category === category} onClick={() => setCategory(c.category)}>
                {c.category}
              </button>
            ))}
          </div>
        )}
        <div className="catalog-list">
          {shown.map((c) => (
            <section key={c.category}>
              {q && <h4>{c.category}</h4>}
              <div className="catalog-items">
                {c.items.map((name) => (
                  <label key={name}>
                    <input type="checkbox" checked={!!checked[name]} onChange={() => toggle(name)} />
                    {name}
                  </label>
                ))}
              </div>
            </section>
          ))}
          {shown.length === 0 && <p>No matches.</p>}
        </div>
        <div className="catalog-actions">
          <button type="button" className="action" onClick={confirm}>
            Add selected{selected.length ? ` (${selected.length})` : ""}
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
