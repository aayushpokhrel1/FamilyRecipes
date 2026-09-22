# Brief: Slice 4 — ingredient catalog (native datalist autocomplete)

Let people pick ingredient names from a list while typing, seeded from a static catalog plus
the family's previously used ingredient names.

## 1. Create `src/lib/catalog.ts`

Author a modest static catalog: the exact structure below, and fill each category's `items`
with about 12 to 16 common, singular, lowercase ingredient names (no quantities). Categories:
Produce, Herbs, Spices, Dairy & Eggs, Proteins, Pantry & Grains, Baking, Condiments & Sauces.
Use ordinary comma lists. Example items: Produce -> "onion","garlic","tomato","carrot",...;
Spices -> "cumin","paprika","cinnamon","black pepper",...; Baking -> "flour","sugar","baking
soda","vanilla extract",... Keep names generic and singular.

```ts
export interface CatalogCategory { category: string; items: string[] }

export const CATALOG: CatalogCategory[] = [
  { category: "Produce", items: [/* ~12-16 items */] },
  { category: "Herbs", items: [/* ... */] },
  { category: "Spices", items: [/* ... */] },
  { category: "Dairy & Eggs", items: [/* ... */] },
  { category: "Proteins", items: [/* ... */] },
  { category: "Pantry & Grains", items: [/* ... */] },
  { category: "Baking", items: [/* ... */] },
  { category: "Condiments & Sauces", items: [/* ... */] },
];

export const CATALOG_ITEMS: string[] = CATALOG.flatMap((c) => c.items);

// Catalog items first, then the family's own past names, deduped case-insensitively.
export function mergeItemSuggestions(history: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...CATALOG_ITEMS, ...history]) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
```

## 2. Create `src/lib/catalog.test.ts` EXACTLY

```ts
import { test, expect } from "vitest";
import { mergeItemSuggestions, CATALOG_ITEMS } from "./catalog";

test("merges history after catalog, deduped case-insensitively", () => {
  const result = mergeItemSuggestions(["Onion", "gochujang", "  "]);
  // catalog items come first
  expect(result.slice(0, CATALOG_ITEMS.length)).toEqual(CATALOG_ITEMS);
  // a new history item is appended
  expect(result).toContain("gochujang");
  // "Onion" duplicates catalog "onion" (case-insensitive) and blanks are dropped
  expect(result.filter((x) => x.toLowerCase() === "onion")).toHaveLength(1);
});
```

## 3. Edit `src/lib/api/recipes.ts` — add distinct family ingredient names

Append this exported function:
```ts
export async function listFamilyIngredientNames(familyId: string): Promise<string[]> {
  const { data: recs, error } = await supabase.from("recipes").select("id").eq("family_id", familyId);
  if (error) throw new Error(error.message);
  const ids = (recs ?? []).map((r: any) => r.id);
  if (!ids.length) return [];
  const { data, error: e2 } = await supabase.from("recipe_ingredients").select("item").in("recipe_id", ids);
  if (e2) throw new Error(e2.message);
  const names = new Set((data ?? []).map((r: any) => r.item as string).filter(Boolean));
  return Array.from(names).sort();
}
```

## 4. Edit `src/components/IngredientEditor.tsx`

(a) Add the import at the top:
```tsx
import { mergeItemSuggestions } from "../lib/catalog";
```

(b) Change the component signature to accept an optional `itemSuggestions` prop:
FROM:
```tsx
export default function IngredientEditor({
  items,
  onChange,
}: {
  items: Ingredient[];
  onChange: (items: Ingredient[]) => void;
}) {
```
TO:
```tsx
export default function IngredientEditor({
  items,
  onChange,
  itemSuggestions = [],
}: {
  items: Ingredient[];
  onChange: (items: Ingredient[]) => void;
  itemSuggestions?: string[];
}) {
```

(c) On the Item `<input>` (the one with `placeholder="Item"`), add `list="ingredient-items"`.

(d) Immediately before the closing `</div>` of the outer wrapper (next to the existing
`ingredient-sections` datalist), add:
```tsx
      <datalist id="ingredient-items">
        {mergeItemSuggestions(itemSuggestions).map((name) => <option key={name} value={name} />)}
      </datalist>
```

## 5. Wire the parents to pass family history

### `src/pages/RecipeCreate.tsx`
(a) Add to imports: `import { createRecipe, listFamilyIngredientNames } from "../lib/api/recipes";` (replace the existing `import { createRecipe } from "../lib/api/recipes";`). Also add `useEffect` to the react import.
(b) Add state + effect in the component:
```tsx
  const [itemSuggestions, setItemSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (activeFamily) listFamilyIngredientNames(activeFamily.id).then(setItemSuggestions).catch(() => setItemSuggestions([]));
  }, [activeFamily]);
```
(c) Pass the prop to the editor: change `<IngredientEditor items={draft.ingredients} onChange={...} />` to also pass `itemSuggestions={itemSuggestions}`.

### `src/pages/RecipeEdit.tsx`
(a) Change `import { getRecipe, updateRecipe } from "../lib/api/recipes";` to
`import { getRecipe, updateRecipe, listFamilyIngredientNames } from "../lib/api/recipes";`.
(b) Add state:
```tsx
  const [itemSuggestions, setItemSuggestions] = useState<string[]>([]);
```
(c) Add an effect (after the existing load effect) that fetches once `familyId` is set:
```tsx
  useEffect(() => {
    if (familyId) listFamilyIngredientNames(familyId).then(setItemSuggestions).catch(() => setItemSuggestions([]));
  }, [familyId]);
```
(d) Pass `itemSuggestions={itemSuggestions}` to the `<IngredientEditor ... />`.

## Constraints
- Use the code verbatim (fill the catalog item lists yourself per step 1). Do not modify any
  other file. Do not touch brief.md. Do not run any commands.
- No em/en dashes anywhere.
