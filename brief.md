# Brief: Slice 3 — ingredient sections

Let each ingredient carry an optional free-text section label ("Spices", "For dredging",
"Sauce"). Group by it in the recipe and cook views. Persist it through create AND edit (the
edit path goes through an RPC that currently drops unknown columns, so the RPC must be updated).

## 1. Create `supabase/migrations/0009_ingredient_sections.sql` EXACTLY

```sql
-- Ingredient sections: group a recipe's ingredients under named components.
alter table recipe_ingredients add column section text;

-- replace_recipe_children (0006) inserted a fixed column list without `section`,
-- so edits would drop it. Redefine it to carry section through.
create or replace function replace_recipe_children(
  p_recipe_id uuid, p_ingredients jsonb, p_steps jsonb
) returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_ingredients is not null then
    delete from recipe_ingredients where recipe_id = p_recipe_id;
    insert into recipe_ingredients (recipe_id, position, quantity, unit, item, section)
    select p_recipe_id, (ord - 1)::int, e->>'quantity', e->>'unit', e->>'item', e->>'section'
    from jsonb_array_elements(p_ingredients) with ordinality as t(e, ord);
  end if;
  if p_steps is not null then
    delete from recipe_steps where recipe_id = p_recipe_id;
    insert into recipe_steps (recipe_id, position, text)
    select p_recipe_id, (ord - 1)::int, e->>'text'
    from jsonb_array_elements(p_steps) with ordinality as t(e, ord);
  end if;
end; $$;
```

## 2. Edit `src/lib/api/types.ts`

Change the `Ingredient` interface to add an optional `section` (keep it optional so existing
constructions do not break):

FROM:
```ts
export interface Ingredient { id?: string; position: number; quantity: string | null; unit: string | null; item: string; }
```
TO:
```ts
export interface Ingredient { id?: string; position: number; quantity: string | null; unit: string | null; item: string; section?: string | null; }
```

## 3. Edit `src/lib/api/recipes.ts` — persist section on create

In `createRecipe`, the ingredient insert maps rows. Change:
```ts
    const rows = draft.ingredients.map((g, i) => ({
      recipe_id: rec.id, position: i, quantity: g.quantity, unit: g.unit, item: g.item }));
```
to:
```ts
    const rows = draft.ingredients.map((g, i) => ({
      recipe_id: rec.id, position: i, quantity: g.quantity, unit: g.unit, item: g.item, section: g.section ?? null }));
```
(The edit path uses the `replace_recipe_children` RPC, already handled by the migration above.)

## 4. Create `src/lib/groupIngredients.ts` EXACTLY

```ts
import type { Ingredient } from "./api/types";

export interface IngredientGroup { section: string | null; items: Ingredient[] }

// Group ingredients by section label, preserving first-seen order. A blank or
// whitespace-only section is treated as ungrouped (null).
export function groupIngredientsBySection(items: Ingredient[]): IngredientGroup[] {
  const groups: IngredientGroup[] = [];
  for (const g of items) {
    const key = g.section && g.section.trim() ? g.section : null;
    let grp = groups.find((x) => x.section === key);
    if (!grp) { grp = { section: key, items: [] }; groups.push(grp); }
    grp.items.push(g);
  }
  return groups;
}
```

## 5. Create `src/lib/groupIngredients.test.ts` EXACTLY

```ts
import { test, expect } from "vitest";
import { groupIngredientsBySection } from "./groupIngredients";

test("groups by section, blank becomes null, order preserved", () => {
  const groups = groupIngredientsBySection([
    { position: 0, quantity: "1", unit: "cup", item: "flour", section: "Dredging" },
    { position: 1, quantity: null, unit: null, item: "salt", section: "Spices" },
    { position: 2, quantity: "1", unit: null, item: "egg", section: "  " },
    { position: 3, quantity: "2", unit: null, item: "breadcrumbs", section: "Dredging" },
  ]);
  expect(groups.map((g) => g.section)).toEqual(["Dredging", "Spices", null]);
  expect(groups[0].items.map((i) => i.item)).toEqual(["flour", "breadcrumbs"]);
});
```

## 6. Edit `src/components/IngredientEditor.tsx`

Add a Section input per row (with a datalist of sections already used in this recipe) and make
a new ingredient inherit the previous row's section.

(a) At the top of the component body (before `return`), add:
```tsx
  const usedSections = Array.from(
    new Set(items.map((g) => g.section).filter((s): s is string => !!s && s.trim() !== "")),
  );
```

(b) In each row, immediately AFTER the Item `<input>` (the one with `placeholder="Item"`) and
BEFORE the Remove button, add:
```tsx
          <input
            value={g.section ?? ""}
            onChange={(e) => update(i, { section: e.target.value })}
            placeholder="Section"
            list="ingredient-sections"
          />
```

(c) Change the "Add ingredient" onChange to inherit the last row's section:
FROM:
```tsx
        onClick={() => onChange([...items, { position: items.length, quantity: "", unit: "", item: "" }])}
```
TO:
```tsx
        onClick={() => onChange([...items, { position: items.length, quantity: "", unit: "", item: "", section: items[items.length - 1]?.section ?? null }])}
```

(d) Immediately before the closing `</div>` of the component's outer wrapper (after the Add
ingredient button), add the datalist:
```tsx
      <datalist id="ingredient-sections">
        {usedSections.map((s) => <option key={s} value={s} />)}
      </datalist>
```

## 7. Edit `src/pages/RecipeDetail.tsx` — grouped ingredient display

(a) Add import:
```tsx
import { groupIngredientsBySection } from "../lib/groupIngredients";
```

(b) In the Ingredients section, REPLACE this block:
```tsx
          <ul className="ing-list">
            {ingredients.map((g, i) => (
              <li key={i}>
                <span className="qty">{[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}</span>
                <span>{g.item}</span>
              </li>
            ))}
          </ul>
```
WITH:
```tsx
          {groupIngredientsBySection(ingredients).map((grp) => (
            <div key={grp.section ?? "_"}>
              {grp.section && <h3 className="ing-section">{grp.section}</h3>}
              <ul className="ing-list">
                {grp.items.map((g, i) => (
                  <li key={i}>
                    <span className="qty">{[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}</span>
                    <span>{g.item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
```

## 8. Edit `src/pages/CookMode.tsx` — grouped ingredient display

(a) Add import:
```tsx
import { groupIngredientsBySection } from "../lib/groupIngredients";
```

(b) REPLACE this block:
```tsx
          <ul className="cook-ings">
            {ingredients.map((g, i) => (
              <li key={i}>
                {[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")} <span>{g.item}</span>
              </li>
            ))}
          </ul>
```
WITH:
```tsx
          {groupIngredientsBySection(ingredients).map((grp) => (
            <div key={grp.section ?? "_"}>
              {grp.section && <h3 className="ing-section">{grp.section}</h3>}
              <ul className="cook-ings">
                {grp.items.map((g, i) => (
                  <li key={i}>
                    {[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")} <span>{g.item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
```

## Constraints
- Use the code verbatim. Do not modify any other file. Do not touch brief.md. Do not run commands.
- No em/en dashes anywhere.
