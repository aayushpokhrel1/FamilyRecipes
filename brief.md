# Brief: Slice 5 — ingredient catalog popup (categorized multi-select)

A modal palette that lists the catalog by category with checkboxes and a search box; picking
items adds them as new ingredient rows, optionally under a section.

## 1. Create `src/components/IngredientCatalogPicker.tsx` EXACTLY

```tsx
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
```

## 2. Create `src/components/IngredientCatalogPicker.test.tsx` EXACTLY

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import IngredientCatalogPicker from "./IngredientCatalogPicker";

test("adds checked items with the chosen section", () => {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<IngredientCatalogPicker onAdd={onAdd} onClose={onClose} defaultSection="Spices" />);
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: /add selected/i }));
  expect(onAdd).toHaveBeenCalledTimes(1);
  const [names, section] = onAdd.mock.calls[0];
  expect(names.length).toBe(1);
  expect(section).toBe("Spices");
  expect(onClose).toHaveBeenCalled();
});

test("search narrows the catalog to nothing for a nonsense query", () => {
  render(<IngredientCatalogPicker onAdd={() => {}} onClose={() => {}} />);
  expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("search ingredients"), { target: { value: "zzzznotreal" } });
  expect(screen.queryAllByRole("checkbox").length).toBe(0);
});
```

## 3. Edit `src/components/IngredientEditor.tsx`

(a) Change the top import line `import type { Ingredient } from "../lib/api/types";` to ALSO
import useState and the picker (add two lines):
```tsx
import { useState } from "react";
import IngredientCatalogPicker from "./IngredientCatalogPicker";
```

(b) At the start of the component body (before `function update`), add:
```tsx
  const [showPicker, setShowPicker] = useState(false);
```

(c) Immediately AFTER the existing "Add ingredient" `</button>`, add an "Add from list" button:
```tsx
      <button type="button" onClick={() => setShowPicker(true)}>Add from list</button>
```

(d) Immediately before the closing `</div>` of the component's outer wrapper (next to the
datalists), add the picker:
```tsx
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
```

## Constraints
- Use the code verbatim. Do not modify any other file. Do not touch brief.md. Do not run commands.
- No em/en dashes anywhere.
