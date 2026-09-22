import { useState } from "react";
import { CATALOG } from "../lib/catalog";

// Modal: browse the catalog by category, search across all, multi-select, and add the checked
// names as ingredients under an optional section. Presentation only; styling comes later.
export default function IngredientCatalogPicker(
  { onAdd, onClose, defaultSection }:
  { onAdd: (names: string[], section: string | null) => void; onClose: () => void; defaultSection?: string | null },
) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [section, setSection] = useState(defaultSection ?? "");

  const q = query.trim().toLowerCase();
  const filtered = CATALOG
    .map((c) => ({ category: c.category, items: c.items.filter((i) => !q || i.toLowerCase().includes(q)) }))
    .filter((c) => c.items.length > 0);

  function toggle(name: string) {
    setChecked((prev) => ({ ...prev, [name]: !prev[name] }));
  }
  function confirm() {
    const names = Object.keys(checked).filter((n) => checked[n]);
    if (names.length) onAdd(names, section.trim() || null);
    onClose();
  }

  return (
    <div className="catalog-overlay" role="dialog" aria-label="Add ingredients from list">
      <div className="catalog-modal">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ingredients" aria-label="search ingredients" />
        <input value={section} onChange={(e) => setSection(e.target.value)}
          placeholder="Section (optional)" aria-label="target section" />
        <div className="catalog-list">
          {filtered.map((c) => (
            <section key={c.category}>
              <h4>{c.category}</h4>
              {c.items.map((name) => (
                <label key={name}>
                  <input type="checkbox" checked={!!checked[name]} onChange={() => toggle(name)} />
                  {name}
                </label>
              ))}
            </section>
          ))}
          {filtered.length === 0 && <p>No matches.</p>}
        </div>
        <div className="catalog-actions">
          <button type="button" onClick={confirm}>Add selected</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
