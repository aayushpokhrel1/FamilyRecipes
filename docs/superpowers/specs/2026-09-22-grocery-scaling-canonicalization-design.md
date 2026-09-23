# Grocery list: portions scaling, ingredient canonicalization, unit-aware merging

Date: 2026-09-22
Status: designed, not built

Picks up three deferred roadmap items that all land on the same seam:

- `docs/superpowers/specs/2026-09-22-recipe-enrichment-design.md` line 110: "Feeding portions
  scaling into the grocery list (scale a planned recipe by target servings)".
- `docs/superpowers/specs/2026-09-18-my-kitchen-meal-planning-design.md` Roadmap items 1 and 2:
  synonym canonicalization and unit-aware quantity merging.

## Problem

The grocery list today groups ingredients by `normalizeItem(item)` and **never sums**. It shows
each contributing recipe's quantity verbatim. Three consequences:

1. "all-purpose flour" and "flour" become two lines, because normalization is spelling-level
   only (casing, prep words, plurals).
2. A line that genuinely is one ingredient still reads as "2 cups (Dal), 1 cup (Soup)" instead
   of "3 cups", so the shopper does the arithmetic.
3. A recipe planned for a different number of people than it was written for cannot be scaled.
   `quantity.ts` can already scale a quantity, but nothing feeds a target servings into the
   grocery build.

## Decisions

Each of these was chosen deliberately; the rejected alternative is recorded because the
reasoning is the part that rots first.

### D1. Canonicalization is a curated map now, with the LLM seam preserved

A hand-maintained `SYNONYMS` map inside `normalizeItem`. Zero cost, zero latency,
deterministic, unit-testable, works offline.

Rejected for now: an LLM canonicalization pass with a stored canonical column. It handles the
long tail but adds a migration, a backfill, per-call cost and latency, and would touch the
`extract-recipe` path. `normalizeItem` stays the single upgrade seam, exactly as its existing
`ponytail:` comment promises, so phase 2 can swap the internals without moving the call site.

### D2. Unit merging converts within a family, and families do not cross systems

Sums convert inside a unit family (tsp/tbsp/fl oz/cup, or g/kg) rather than only summing
exact unit matches.

**Metric and imperial are separate families:** volume-imperial, volume-metric,
weight-imperial, weight-metric. Merging happens only inside one system. This is a deliberate
simplification: cross-system conversion is where unit code turns into a swamp, and it would
produce output like "0.42 cups" from millilitres. Nothing in this app needs it. A line mixing
systems simply reports both totals.

Volume and weight never merge with each other regardless of system, because that needs
per-ingredient density (1 cup of flour is not 1 cup of water by weight).

### D3. A converted sum displays in the largest unit that keeps the value at or above 1

`2 tbsp + 1/4 cup` renders as `6 tbsp`, not `0.375 cup`. `500 g + 750 g` renders as `1.25 kg`.
After choosing the unit, the value goes through the existing `formatQuantity`, so the
established fraction rendering (halves, thirds, quarters) is reused rather than duplicated.

Rejected: "unit of the largest contribution" (still yields awkward fractions) and "fixed base
per family" (renders 1 tsp as 0.02 cup).

### D4. Target servings lives on the plan item, persisted

`meal_plan_items.servings`, nullable, `check (servings > 0)`. Null means "use the recipe's own
servings", so existing rows need no backfill and current behavior is unchanged.

Per item rather than per plan, because a plan legitimately mixes a dinner for 8 with a lunch
for 2. Persisted rather than UI-only, because the target must survive a reload and must be the
same for anyone the plan is shared with, read-only viewers included.

### D5. Scaling fails visibly, never silently

- A recipe with `servings = null` has no base to scale from, so the stepper is **disabled** for
  that plan item, with a tooltip saying why.
- An individual quantity that will not parse (for example "a pinch") passes through unchanged
  and is **marked unscaled** on its line.

The user must never be shown a half-scaled ingredient list that looks fully scaled. This also
matches what `scaleIngredientQty` already does: it returns its input unchanged when
`parseQuantity` returns null.

## Architecture

Three pure modules, one schema change, two UI touch points. All new logic is pure and
testable without a database or a browser.

### `src/lib/api/normalizeItem.ts` (edit)

Add `SYNONYMS: Record<string, string>`, applied as the LAST step, after the existing lowercase,
comma-strip, prep-word-removal and singularize passes. Order matters: "Scallions, chopped"
reduces to "scallion" and only then maps to "green onion", so the map holds singular canonical
forms and does not need plural or prep variants.

Exported signature is unchanged: `normalizeItem(item: string): string`. No caller changes.

Seed the map modestly with genuinely common pairs (all purpose flour to flour, scallion to
green onion, garbanzo bean to chickpea, coriander to cilantro, and similar). It is static data,
so growing it is a one-file change.

### `src/lib/api/units.ts` (new)

Pure, no app imports, mirroring how `quantity.ts` is written.

```ts
export type UnitFamily = "volume-imperial" | "volume-metric" | "weight-imperial" | "weight-metric";

export function normalizeUnit(unit: string | null): string | null;
export function unitFamily(unit: string | null): UnitFamily | null;
export function toBase(value: number, unit: string): number | null;
export function fromBase(base: number, family: UnitFamily): { value: number; unit: string };
```

- `normalizeUnit` folds freeform spellings to a canonical id: "Tablespoons", "tbsp", "T",
  "tablespoon" all become `tbsp`.
- Base units: `tsp` for volume-imperial, `ml` for volume-metric, `oz` for weight-imperial, `g`
  for weight-metric.
- `fromBase` walks that family's unit ladder from largest to smallest and returns the first
  unit whose value is at least 1, falling back to the smallest unit when everything is below 1.
- A unit that is not recognized returns `null` from `normalizeUnit` and `unitFamily`, which is
  how the caller decides a contribution cannot be merged. Countable ingredients with no unit
  ("4 eggs") therefore never merge with anything, which is correct.

### `src/lib/api/grocery.ts` (edit)

`buildGroceryList` keeps its signature and stays unaware of servings. Per line:

1. Bucket contributions by `unitFamily(normalizeUnit(c.unit))`.
2. A bucket merges only if EVERY member has a parseable quantity (`parseQuantity`) and a
   recognized unit in that family. Merge by summing `toBase` values, then `fromBase`, then
   `formatQuantity`.
3. Anything else stays an unmerged contribution.

`GroceryLine` gains:

```ts
totals: { quantity: string; unit: string }[];  // one per merged family, usually zero or one
partial: boolean;                               // some contributions could not be merged
```

`contributions` is unchanged, so the per-recipe provenance the panel already renders keeps
working. A single-contribution line produces a single total, which is the common case.

### `supabase/migrations/0011_plan_item_servings.sql` (new)

```sql
alter table meal_plan_items add column servings int check (servings is null or servings > 0);
```

Additive and nullable, so no backfill and no RLS change. The existing `meal_plan_items`
policies already gate the row; adding a column does not widen them.

### `src/lib/api/mealPlans.ts` (edit)

- Include `servings` in the plan-item select.
- Add `setItemServings(itemId: string, servings: number | null): Promise<void>`.
- In the grocery assembly, compute `factor = target / recipe.servings` for each plan item where
  both are present, apply `scaleIngredientQty` to each ingredient row before handing rows to
  `buildGroceryList`, and mark each row as scaled or not.

`IngredientRow` gains `scaled: boolean`, which flows through to the contribution so the panel
can mark it.

### UI

- `src/pages/MealPlanDetail.tsx`: a servings stepper per plan item, disabled with an
  explanatory tooltip when the recipe has no `servings`. Reuse the existing stepper styling
  from the RecipeDetail portions control rather than inventing a second look.
- `src/components/GroceryPanel.tsx`: show `totals` as the line's headline quantity, keep the
  per-recipe contributions as the breakdown, and render a "mixed units" marker when `partial`
  is true and an "unscaled" marker on contributions where `scaled` is false.

## Data flow

```
plan items (+ servings)  ->  scale rows via quantity.ts  ->  buildGroceryList
                                                                |
                              normalizeItem (+ SYNONYMS)  ------+  group key
                              units.ts (family + convert)  -----+  totals / partial
                                                                v
                                                          GroceryPanel
```

## Testing

Unit, all pure and fast:

- `units.test.ts`: spelling folding, family assignment, round-trip `toBase`/`fromBase`, the
  at-least-1 display ladder (2 tbsp + 1/4 cup gives 6 tbsp; 500 g + 750 g gives 1.25 kg),
  unknown units returning null.
- `normalizeItem.test.ts` (extend): synonym mapping, and that it applies after singularization
  and prep-word removal.
- `grocery.test.ts` (extend): same-unit sum, cross-unit same-family sum, mixed families
  producing two totals with `partial` true, an unparseable quantity staying separate, a manual
  line unaffected.
- Scaling: correct factor, quantities that will not parse passing through marked unscaled, and
  a recipe with null servings producing no factor at all.

Integration (`tests/integration/`): the migration applies, `servings` round-trips through
`setItemServings`, and the existing meal-plan RLS boundary still holds with the new column.

## Risks and notes

- **The synonym map is opinionated data, not logic.** Keep it small and obvious. A wrong entry
  silently merges two genuinely different ingredients, which is worse than not merging. Only
  add pairs that are truly the same thing.
- **`normalizeItem` is used as a stored grouping key** for grocery check state. Changing
  normalization changes those keys, so previously checked items may appear unchecked once after
  this ships. Acceptable one-time effect; do not attempt a key migration.
- Volume-to-weight merging is out of scope permanently unless per-ingredient density arrives.
- Scaling stays display-time only. Saving a scaled copy of a recipe remains a separate feature,
  as the enrichment spec already states.

## Out of scope

- LLM or embedding-based canonicalization (phase 2 behind the same seam).
- Cross-system unit conversion.
- Store or aisle categorization, export to external shopping apps (My Kitchen roadmap item 3).
