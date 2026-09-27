# Optional ingredients and alternatives

Some ingredients are not required: a handful of basil you add if you have it, or yogurt you use
when there is no cream. Today an ingredient is only quantity, unit, item and section, so both
have to be smuggled into the item text ("cream (or yogurt)"), where nothing can act on them and
they pollute ingredient matching and the grocery list.

## The constraint that drives the schema

**Editing a recipe DELETES and RE-INSERTS every ingredient row.** `replace_recipe_children`
(migration `0006`, redefined in `0009`) does `delete from recipe_ingredients where recipe_id =
...` then inserts from a jsonb array. **Every ingredient id is regenerated on every save.**

So an alternative cannot be a foreign key to another ingredient's id: the reference would die
the first time anyone edited the recipe. It cannot be a position reference either without
remapping every time a row is reordered.

`0009` already got bitten by the milder version of this: the RPC had a fixed column list, so
`section` was silently dropped on edit and the migration exists to fix it. **Any new ingredient
column MUST be added to that RPC in the same migration**, and that is the highest-risk line in
this change.

## Decisions (settled 2026-09-27, do not relitigate)

1. **Two separate concepts, not one.** `optional` is a property of a single ingredient ("add if
   you like"). An alternative is a relationship ("use this instead of that"). Collapsing them
   into one flag would make "optional" mean two different things in the grocery list.
2. **Alternatives are a GROUP KEY, not a reference.** `alt_group text`: rows in the same recipe
   sharing a non-null value are alternatives for each other. The key travels with the row
   through the delete-and-reinsert, and reordering cannot corrupt it, because there is nothing
   to keep in sync. A `substitute_for` id dies on every save; a position reference needs
   remapping on every drag.
3. **The primary is the lowest `position` in the group.** Implicit but deterministic, and it
   makes "make cream the main one" mean "put cream first" rather than a separate flag that can
   contradict the ordering.
4. **The grocery list buys the primary of each group and skips the rest.** Otherwise a dish with
   an alternative makes you buy cream AND yogurt. Optional ingredients ARE still bought, carrying
   a marker so they can be skipped in the shop: leaving them off entirely means noticing their
   absence, which is the failure mode that is easy to miss and annoying to recover from.
5. **`optional` joins the AI draft schema; alternatives do not.** A model can reasonably tell
   that "basil, to taste" is optional. Inferring that two lines are alternatives for each other
   is a different and less reliable judgement, and a wrong guess silently removes something from
   the shopping list. Alternatives stay manual.
6. **Per-plan swapping is OUT of scope.** "This week use yogurt" is per-meal-plan state, a second
   migration and a second chunk of UI. The recipe decides; the week does not. Revisit only if
   the recipe-level version proves useful.

## Schema

Migration `0019_optional_ingredients.sql`:

```sql
alter table recipe_ingredients
  add column optional boolean not null default false,
  add column alt_group text;
```

**And in the SAME migration**, redefine `replace_recipe_children` to carry both new columns
through, exactly as `0009` had to for `section`. The insert becomes:

```sql
insert into recipe_ingredients (recipe_id, position, quantity, unit, item, section, optional, alt_group)
select p_recipe_id, (ord - 1)::int, e->>'quantity', e->>'unit', e->>'item', e->>'section',
       coalesce((e->>'optional')::boolean, false), e->>'alt_group'
from jsonb_array_elements(p_ingredients) with ordinality as t(e, ord);
```

No RLS change: both columns live on a table whose policies already cover them.

## Types and the write path

`Ingredient` in `src/lib/api/types.ts` gains `optional?: boolean` and `alt_group?: string | null`.

`createRecipe` in `src/lib/api/recipes.ts` builds its insert rows by hand and must include both,
the same way it includes `section`. `updateRecipe` goes through the RPC and needs no change
beyond the migration. `getRecipe` selects `*`, so reads need no change.

## Grocery list

`getGroceryList` / `getUpcomingGroceryList` in `src/lib/api/mealPlans.ts` select
`recipe_id,quantity,unit,item`. They must also select `position,optional,alt_group`, and then,
per recipe:

- Keep every row with a null `alt_group`.
- For each non-null `alt_group`, keep only the row with the lowest `position`.
- Carry `optional` onto the resulting line so the UI can mark it.

**The filter belongs in a pure exported function**, `primaryIngredients(rows)`, tested directly:
it is the piece that decides what a family does and does not buy, and it must not be buried in
a query callback where it cannot be exercised.

`GroceryLine` gains `optional: boolean`. A merged line is optional only if EVERY contribution to
it was optional: if one recipe needs the garlic and another merely suggests it, you need garlic.

## UI

- **`IngredientEditor`**: a tick labelled "Optional", and an "Alternative to" picker listing the
  other ingredients in this recipe. Picking one puts this row in that row's group, creating a
  group key if the target has none. Clearing it sets `alt_group` to null. A row that is itself
  the primary of a group cannot be made an alternative of another row: chains of alternatives are
  not a thing anyone means.
- **`RecipeDetail` and `CookMode`**: an optional ingredient shows a quiet "optional" marker.
  Alternatives render indented under their primary as "or <quantity> <unit> <item>", not as
  separate numbered lines, because they are not additional things to fetch.
- **`GroceryPanel`**: an optional line carries the same quiet marker. Nothing is hidden.

## Testing

- `primaryIngredients`: a group of three keeps only the lowest position; null groups all survive;
  groups from different recipes with the same key do not collide; an empty list is not an error.
- Merged-line optionality: required plus optional merges to required.
- The editor: ticking Optional round-trips into the draft; picking an alternative sets the group;
  clearing it nulls the group.
- **An integration test that a recipe edit preserves `optional` and `alt_group`**, which is the
  `section` bug of `0009` happening again and the single most likely regression here.

## Out of scope

Per-plan swapping, AI-inferred alternatives, alternatives that are themselves optional (the group
already says "one of these"), and nested or chained alternatives.
