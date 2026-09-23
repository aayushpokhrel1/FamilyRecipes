# Recipe Enrichment Design

**Date:** 2026-09-22
**Status:** Approved design, pre-implementation

## Summary

A set of recipe-side enhancements plus a My Kitchen entry point:

1. **Add-to-plan from a recipe** — put a recipe into a My Kitchen plan without opening the plan.
2. **AI prefill on edit** — use the existing AI extract panel while editing a saved recipe, appending to it rather than replacing.
3. **Portions scaling** — a display-only servings toggle that scales ingredient quantities by the unitary method, built on a small quantity parser.
4. **Ingredient sections** — group a recipe's ingredients under named components ("Spices", "For dredging", "Sauce").
5. **Ingredient catalog** — pick ingredients from a list instead of typing: native autocomplete first, plus a categorized multi-select popup.

(6. My Kitchen "Up next" landing is a separate spec, handled with the design session.)

## Goals

- Faster, more consistent recipe entry (catalog + sections), and quantities that adapt to how many people you are cooking for (scaling).
- Close the loop between the vault and My Kitchen (add-to-plan).
- Let AI help extend an existing recipe, not just create a new one.
- Keep all Supabase access inside `src/lib/api/`; keep non-trivial logic in pure, tested functions.

## Non-goals (this epic)

- Unit conversion or cross-recipe quantity merging in the grocery list (still deferred; scaling only multiplies a single value, no unit math).
- LLM/synonym ingredient canonicalization (the catalog is a UX-driven partial substitute; full canonicalization stays on the roadmap).
- A server-side, user-managed ingredient catalog table (the catalog ships as static seed data plus per-family history; a table comes only if users need to manage a shared custom list).
- My Kitchen landing/calendar redesign (separate).

## Decisions

| # | Feature | Decision |
|---|---------|----------|
| 1 | Add-to-plan | An "Add to plan" control on `RecipeDetail` lists the caller's plans and calls `addRecipe(planId, recipeId)` with no day/slot (scheduled later in My Kitchen). |
| 2 | Prefill on edit | Mount `AiPrefillPanel` in `RecipeEdit`; its result is **merged**: prefilled ingredients and steps are appended, empty scalar fields (servings/prep/cook/story/provenance/source_url) are filled, existing non-empty text is never overwritten. |
| 3 | Portions scaling | Pure `parseQuantity` / `formatQuantity` / `scaleQuantity`; a display-only stepper on `RecipeDetail` (and `CookMode`) re-renders quantities. Base = `recipe.servings`; when null, a plain x-multiplier. Never mutates the saved recipe. Non-numeric quantities pass through unchanged. |
| 4 | Ingredient sections | Nullable `section text` on `recipe_ingredients` (migration `0009`); free-text label per ingredient, grouped by label preserving order; null = a default "Ingredients" group. |
| 5 | Ingredient catalog | A static JSON catalog grouped by category, bundled in the app. Entry surfaces: (a) a native `<datalist>` on the item field seeded from the catalog + the family's past ingredient names; (b) a categorized multi-select **popup** ("Add from list") that adds several items at once, optionally into the current section. |

## Architecture / data model

- **Migration `0009_ingredient_sections.sql`:** `alter table recipe_ingredients add column section text;` Nothing else. RLS unchanged (child-of-recipe policies already cover the column).
- **Type change:** `Ingredient` gains `section: string | null`. `RecipeDraft.ingredients` carries it through create/edit. `replace_recipe_children` RPC and `createRecipe` insert must include `section` (see Risks).
- **Quantity parsing:** `src/lib/api/quantity.ts` (pure): `parseQuantity(text): {min:number; max:number}|null` (a single value has min==max; ranges like "2-3" keep both), `formatQuantity(n): string` (decimal to nice fraction/mixed), `scaleIngredientQty(quantity: string|null, factor: number): string|null` (parses, scales min and max, reformats; returns the original string when unparseable). Unit-agnostic: only the numeric part changes.
- **Catalog:** `src/lib/catalog.ts` exports a typed constant: `CATALOG: { category: string; items: string[] }[]` (spices, produce, dairy, pantry, proteins, herbs, baking, condiments, ...). No network, no DB. Family-history suggestions come from a new `listFamilyIngredientNames(familyId)` in `src/lib/api/recipes.ts` (distinct `item` across the family's recipes).
- **UI boundaries:** the catalog popup is its own component (`IngredientCatalogPicker`); the portions stepper is its own component (`PortionsStepper`) reused by RecipeDetail and CookMode; sections rendering lives in the existing display/editor components.

## Feature detail

### 1. Add-to-plan (RecipeDetail)
- A `<select>` of the caller's plans (`listPlans()`) + an "Add to plan" button; on click `addRecipe(planId, recipeId)`, show a brief "Added to <plan>" confirmation. Empty state when the user has no plans: a link to My Kitchen.

### 2. AI prefill on edit (RecipeEdit)
- Render `AiPrefillPanel` above the form. Its `onPrefill(draft)` merges into the current draft:
  - `ingredients: [...current, ...incoming]`, `steps: [...current, ...incoming]`.
  - scalars: fill only where current is null/empty (`servings`, `prep_minutes`, `cook_minutes`, `story`, `provenance`, `source_url`).
  - `title`: never overwritten on edit.
- Incoming ingredients have `section: null` (AI does not set sections yet).

### 3. Portions scaling
- `PortionsStepper` shows the effective servings (default = `recipe.servings`, or x1 when null) with -/+ controls and a reset. It reports a `factor` to the parent.
- RecipeDetail (and CookMode) render each ingredient's quantity through `scaleIngredientQty(quantity, factor)`.
- `parseQuantity` handles: integer, decimal, `a/b`, `a b/c` (mixed), unicode fractions (½ ⅓ ¼ ¾ ⅔), and `x-y` / `x to y` ranges. Anything else returns null and the ingredient renders unchanged.
- `formatQuantity` renders to at most 1/8 granularity as a mixed fraction when close, else a 2-decimal number.

### 4. Ingredient sections
- `IngredientEditor`: each row gains an optional "Section" text input with a `<datalist>` of sections already used in this recipe (consistent labels). Display groups by section.
- `RecipeDetail` / `CookMode`: group ingredients by `section`; render a subheading per non-null section, ungrouped ones under "Ingredients". Order preserved by `position`.

### 5. Ingredient catalog
- **Datalist:** the item input in `IngredientEditor` gets `list=` pointing at a `<datalist>` merged from `CATALOG` items + `listFamilyIngredientNames`. Type-to-filter, pick to fill. Zero custom UI.
- **Popup:** an "Add from list" button opens `IngredientCatalogPicker`, a modal listing categories (collapsible) with checkboxes; a search box filters across all categories; the current section (if any) is preselected as the target. Confirm adds one new ingredient row per checked item (blank qty/unit, `item` = catalog name, `section` = chosen). Picking is additive and never edits existing rows.

## Error handling / edge cases

- Scaling with `factor` NaN or base 0: treat as x1 (no scaling); the stepper never lets base be 0.
- `recipe.servings` null: stepper shows a plain multiplier; scaling still works.
- Prefill on edit with an empty extract result: no-op merge (nothing appended).
- Sections: a whitespace-only label normalizes to null (ungrouped).
- Catalog popup with zero checked items: closes without adding.
- Add-to-plan when the recipe is already in the chosen plan at (no day, no slot): the unique constraint makes it a no-op; surface "already in that plan".

## Testing

- **Unit (pure, highest value):** `quantity.ts` — parsing (int/decimal/fraction/mixed/unicode/range), `formatQuantity`, `scaleIngredientQty` (scales, passes through non-numeric, handles ranges). Prefill merge helper (append + fill-empty + never-overwrite). Catalog datalist/source merge (dedup catalog + history).
- **Component:** PortionsStepper changes the displayed quantity; IngredientCatalogPicker adds checked items as rows; RecipeEdit shows the prefill panel and appends on prefill; RecipeDetail shows the "Add to plan" control and grouped sections.
- **Integration:** none new required (RLS unchanged); the `0009` column is exercised by create/edit round-trips in existing flows.

## Build order (slices, each shippable + reviewable)

1. **Quantity core** — `quantity.ts` + tests (foundation; no UI).
2. **Portions scaling UI** — `PortionsStepper` + wire into RecipeDetail and CookMode.
3. **Sections** — migration `0009`, `Ingredient.section`, API insert/replace carry it, IngredientEditor field, grouped display in RecipeDetail/CookMode.
4. **Catalog datalist** — `catalog.ts`, `listFamilyIngredientNames`, datalist on the item field.
5. **Catalog popup** — `IngredientCatalogPicker` modal, "Add from list".
6. **Prefill on edit** — merge helper + `AiPrefillPanel` in RecipeEdit.
7. **Add-to-plan** — control on RecipeDetail.

## Risks / notes

- **`replace_recipe_children` RPC (migration `0006`) must persist `section`.** If the RPC builds child rows from a fixed column list, it needs `section` added, or edits silently drop sections. Slice 3 must check the RPC definition and update it (a new migration) if it does not pass `section` through. This is the one place sections can leak.
- Catalog seed data is curated by hand; start modest (a few dozen common items per category) and grow. It is static, so growing it is a one-file change.
- Portions scaling is display-only by design; if users later want to *save* a scaled version, that is a separate feature (do not conflate).

## Roadmap (still deferred)

> Status update 2026-09-22: the first two items below were built in a follow-up slice. See
> `docs/superpowers/specs/2026-09-22-grocery-scaling-canonicalization-design.md`.

- ~~LLM/synonym ingredient canonicalization and cross-recipe unit-aware quantity merging in the grocery list.~~
  **Partly done.** The curated *synonym* map and unit-aware merging within a unit family are
  built. The *LLM* canonicalization pass is still deferred, behind the same `normalizeItem`
  seam. Cross-system (metric to imperial) conversion is now explicitly out of scope.
- ~~Feeding portions scaling into the grocery list (scale a planned recipe by target servings) — unlocked by `quantity.ts`, but its own slice.~~
  **Done.** Migration `0011` adds `meal_plan_items.servings`; `getGroceryList` scales rows and
  de-dupes by `(recipe_id, servings)`.
- ~~My Kitchen "Up next" landing / week calendar (separate spec, design session).~~ **Done**,
  see `docs/superpowers/specs/2026-09-23-my-kitchen-week-design.md` (migration `0012`).
- Server-side user-managed ingredient catalog.
