# Optional ingredients and alternatives: implementation plan

Spec: `docs/superpowers/specs/2026-09-27-optional-and-alternative-ingredients-design.md`. Read its
Decisions section first; the group-key choice looks odd until you know that editing a recipe
deletes and re-inserts every ingredient row.

Verify each task with `npm run lint`, `npx tsc -b` and `npm test`. On Windows a `--verify` runs
through cmd.exe, so pass ONE command.

## Task 1: migration `0019_optional_ingredients.sql`

Two columns AND the RPC, in one migration:

```sql
alter table recipe_ingredients
  add column optional boolean not null default false,
  add column alt_group text;
```

Then `create or replace function replace_recipe_children(...)` copied from
`0009_ingredient_sections.sql` with both new columns added to the insert column list and the
select list, using `coalesce((e->>'optional')::boolean, false)` for the boolean.

**This is the highest-risk line in the change.** `0009` exists ONLY because `0006` had a fixed
column list that silently dropped `section` on every edit. Miss this and `optional` and
`alt_group` are lost the moment anyone edits a recipe, with no error.

Comment the migration to say so, so the next person adding a column finds the warning.

Do NOT apply to cloud; that is a human step at the end.

## Task 2: types and the write path

- `src/lib/api/types.ts`: `Ingredient` gains `optional?: boolean` and `alt_group?: string | null`.
- `src/lib/api/recipes.ts`, `createRecipe`: its hand-built insert rows must carry
  `optional: g.optional ?? false` and `alt_group: g.alt_group ?? null`, mirroring how `section`
  is carried.
- `updateRecipe` goes through the RPC; no change beyond Task 1.
- `getRecipe` selects `*`; no change.

## Task 3: `primaryIngredients`, the rule about what gets bought

New exported pure function (put it in `src/lib/api/grocery.ts` beside the existing grocery
helpers, or a new `src/lib/primaryIngredients.ts` if that file does not fit).

```ts
export function primaryIngredients<T extends { position: number; alt_group?: string | null }>(
  rows: T[],
): T[]
```

Rules:
- A row with a null/absent `alt_group` always survives.
- Among rows sharing a non-null `alt_group`, only the LOWEST `position` survives.
- Input order must not matter; do not assume rows arrive sorted.
- **Callers pass rows for ONE recipe at a time.** Two recipes could use the same group string,
  and merging them would silently drop an ingredient from a different dish. Say this in a
  comment, and pin it with a test that the function is called per recipe.

Tests (`*.test.ts` beside it), each failing if the behaviour is removed:
1. Three rows sharing a group keep only the lowest position.
2. Rows with no group all survive.
3. Unsorted input still keeps the lowest position, not the first seen.
4. Two groups in one recipe each keep their own primary.
5. An empty list returns empty, not an error.

## Task 4: wire it into the grocery list

`src/lib/api/mealPlans.ts`:
- Both ingredient selects (`getGroceryList` around L206 and the `getUpcomingGroceryList`
  equivalent) must select `position,optional,alt_group` as well.
- Apply `primaryIngredients` to each recipe's rows BEFORE the scaling loop, per recipe, never to
  the combined list.
- Carry `optional` onto `IngredientRow` and then onto `GroceryLine`.
- **A merged line is optional only if EVERY contribution was optional.** If one recipe requires
  garlic and another merely suggests it, you need garlic. Pin this with a test.

## Task 5: the editor

`src/components/IngredientEditor.tsx`:
- A checkbox per row, labelled so screen readers get the ingredient name, following the existing
  `aria-label={`Section for ${g.item || "this ingredient"}`}` pattern.
- An "Alternative to" select per row listing the OTHER ingredients in this recipe by item name.
  Choosing one puts this row into that row's group: if the target has an `alt_group`, reuse it;
  otherwise generate one (`crypto.randomUUID()`) and set it on BOTH rows. Choosing the blank
  option clears this row's `alt_group`.
- A row that is the primary of a group (lowest position with that group) must not be offered as
  an alternative target for its own members, and must not itself be made an alternative: chained
  alternatives are not a thing anyone means.

## Task 6: showing them

- `src/pages/RecipeDetail.tsx` and `src/pages/CookMode.tsx`: an optional ingredient gets a quiet
  marker (a `<span className="optional">optional</span>` styled like the existing `.leftover`
  chip in `src/index.css`). Non-primary group members render indented under their primary as
  "or <quantity> <unit> <item>" rather than as separate lines.
- `src/components/GroceryPanel.tsx`: the same quiet marker on an optional line.
- Add the `.optional` style next to `.leftover` in `src/index.css`, reusing its tokens rather
  than inventing new ones.

## Task 7: `optional` in AI extraction

`supabase/functions/extract-recipe/prompt.ts`: add `optional` (boolean, default false) to the
ingredient shape in `DRAFT_SCHEMA`, and one line to `SYSTEM_PROMPT` telling the model to set it
for ingredients the recipe itself calls optional or "to taste". **Do NOT add alternatives**: a
wrong guess silently removes something from a shopping list.

Needs a manual `npx supabase functions deploy extract-recipe` afterwards; Cloudflare does not
deploy the function.

## Task 8 (Aayush, not delegable): apply and verify

1. `npx supabase db push`, then `npx supabase migration list` to confirm `0019` is on cloud.
2. `npx supabase functions deploy extract-recipe` for Task 7.
3. **The regression that matters:** create a recipe with an optional ingredient and an
   alternative, save, EDIT it, save again, and confirm both survived. That is the `0009` bug
   repeating, and nothing else in this plan protects against it at runtime.
4. Check the grocery list for a plan containing that recipe: the alternative must not appear, and
   the optional item must appear marked.
