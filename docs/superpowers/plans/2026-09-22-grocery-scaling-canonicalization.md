# Grocery Scaling, Canonicalization and Unit-Aware Merging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grocery list merge equivalent ingredients, sum their quantities across compatible units, and reflect a per-plan-item servings target.

**Architecture:** Two new pure modules plus edits to three existing pure modules, one additive migration, and two UI touch points. All arithmetic lives in pure functions that need no database and no browser. `normalizeItem` stays the single canonicalization seam; `buildGroceryList` stays unaware of servings, because scaling is applied to rows before they reach it.

**Tech Stack:** TypeScript (strict), React 19, Supabase/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-grocery-scaling-canonicalization-design.md`

## Global Constraints

- All Supabase access stays inside `src/lib/api/`. Nothing outside it imports the client.
- Verify with `npx tsc -b` and `npm test`. Never `tsc --noEmit`.
- Migration changes verify with `npx supabase db reset` (needs Docker). Integration tests run with `npm run test:int` and require `SB_URL`, `SB_ANON_KEY`, `SB_SERVICE_KEY` exported first.
- Migrations are additive and never edited once applied. The next free number is `0011`.
- No new npm dependencies.
- `units.ts` and `quantity.ts` are pure: no app imports, no Supabase, no React.
- Never use em dashes or en dashes in code, comments, or commit messages.

---

### Task 1: Unit conversion module

**Files:**
- Create: `src/lib/api/units.ts`
- Test: `src/lib/api/units.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type UnitFamily = "volume-imperial" | "volume-metric" | "weight-imperial" | "weight-metric"`; `normalizeUnit(unit: string | null): string | null`; `unitFamily(unit: string | null): UnitFamily | null`; `toBase(value: number, unit: string): number | null`; `fromBase(base: number, family: UnitFamily): { value: number; unit: string }`.

**Key design note for the implementer:** the display ladder deliberately excludes `fl oz`, `pint`, `quart` and `gallon` even though parsing accepts them. A strict largest-first ladder renders 18 tsp as "3 fl oz" and 96 tsp as "1 pint", where a cook expects "6 tbsp" and "2 cups". Parsing and display use different lists on purpose.

- [ ] **Step 1: Write the failing test**

Create `src/lib/api/units.test.ts`:

```ts
import { test, expect } from "vitest";
import { normalizeUnit, unitFamily, toBase, fromBase } from "./units";

test("normalizeUnit folds freeform spellings to a canonical id", () => {
  expect(normalizeUnit("Tablespoons")).toBe("tbsp");
  expect(normalizeUnit("TBSP")).toBe("tbsp");
  expect(normalizeUnit(" tablespoon ")).toBe("tbsp");
  expect(normalizeUnit("cups")).toBe("cup");
  expect(normalizeUnit("grams")).toBe("g");
  expect(normalizeUnit("kilogram")).toBe("kg");
  expect(normalizeUnit("fl oz")).toBe("fl oz");
});

test("normalizeUnit returns null for nothing and for unknown units", () => {
  expect(normalizeUnit(null)).toBeNull();
  expect(normalizeUnit("")).toBeNull();
  expect(normalizeUnit("pinch")).toBeNull();
  expect(normalizeUnit("can")).toBeNull();
});

test("unitFamily keeps metric and imperial apart", () => {
  expect(unitFamily("tbsp")).toBe("volume-imperial");
  expect(unitFamily("ml")).toBe("volume-metric");
  expect(unitFamily("lb")).toBe("weight-imperial");
  expect(unitFamily("kg")).toBe("weight-metric");
  expect(unitFamily("pinch")).toBeNull();
});

test("toBase converts into the family base unit", () => {
  expect(toBase(1, "tbsp")).toBe(3);      // base tsp
  expect(toBase(1, "cup")).toBe(48);
  expect(toBase(1, "kg")).toBe(1000);     // base g
  expect(toBase(1, "lb")).toBe(16);       // base oz
  expect(toBase(1, "pinch")).toBeNull();
});

test("fromBase picks the largest unit that keeps the value at or above 1", () => {
  // 2 tbsp (6 tsp) + 1/4 cup (12 tsp) = 18 tsp, which is 6 tbsp, not 0.375 cup
  expect(fromBase(18, "volume-imperial")).toEqual({ value: 6, unit: "tbsp" });
  expect(fromBase(96, "volume-imperial")).toEqual({ value: 2, unit: "cup" });
  expect(fromBase(1250, "weight-metric")).toEqual({ value: 1.25, unit: "kg" });
});

test("fromBase falls back to the smallest unit below 1", () => {
  expect(fromBase(0.5, "volume-imperial")).toEqual({ value: 0.5, unit: "tsp" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api/units.test.ts`
Expected: FAIL, cannot resolve `./units`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/api/units.ts`:

```ts
// Pure unit conversion for grocery merging. No app imports.
// Metric and imperial are separate families on purpose: cross-system
// conversion would render "0.42 cups" from millilitres and nothing here
// needs it. Volume and weight never merge, that needs per-ingredient density.
export type UnitFamily =
  | "volume-imperial" | "volume-metric" | "weight-imperial" | "weight-metric";

const ALIASES: Record<string, string> = {
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", t: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp",
  "fl oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  cup: "cup", cups: "cup", c: "cup",
  pint: "pint", pints: "pint", pt: "pint",
  quart: "quart", quarts: "quart", qt: "quart",
  gallon: "gallon", gallons: "gallon", gal: "gallon",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
};

// value of one unit expressed in its family's base unit
const IN_BASE: Record<string, number> = {
  tsp: 1, tbsp: 3, "fl oz": 6, cup: 48, pint: 96, quart: 192, gallon: 768,
  ml: 1, l: 1000,
  oz: 1, lb: 16,
  g: 1, kg: 1000,
};

const FAMILY_OF: Record<string, UnitFamily> = {
  tsp: "volume-imperial", tbsp: "volume-imperial", "fl oz": "volume-imperial",
  cup: "volume-imperial", pint: "volume-imperial", quart: "volume-imperial",
  gallon: "volume-imperial",
  ml: "volume-metric", l: "volume-metric",
  oz: "weight-imperial", lb: "weight-imperial",
  g: "weight-metric", kg: "weight-metric",
};

// Largest first, but only the units recipes actually use. "fl oz", "pint",
// "quart" and "gallon" are parsed but never displayed: a strict size ordering
// would render 18 tsp as "3 fl oz" and 96 tsp as "1 pint", where a cook expects
// "6 tbsp" and "2 cups". Parsing and display are different lists on purpose.
const DISPLAY_LADDER: Record<UnitFamily, string[]> = {
  "volume-imperial": ["cup", "tbsp", "tsp"],
  "volume-metric": ["l", "ml"],
  "weight-imperial": ["lb", "oz"],
  "weight-metric": ["kg", "g"],
};

export function normalizeUnit(unit: string | null): string | null {
  if (!unit) return null;
  const s = unit.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return ALIASES[s] ?? null;
}

export function unitFamily(unit: string | null): UnitFamily | null {
  const u = normalizeUnit(unit);
  return u ? FAMILY_OF[u] ?? null : null;
}

export function toBase(value: number, unit: string): number | null {
  const u = normalizeUnit(unit);
  if (!u) return null;
  const factor = IN_BASE[u];
  return factor === undefined ? null : value * factor;
}

export function fromBase(base: number, family: UnitFamily): { value: number; unit: string } {
  const ladder = DISPLAY_LADDER[family];
  for (const unit of ladder) {
    const value = base / IN_BASE[unit];
    if (value >= 1) return { value, unit };
  }
  const smallest = ladder[ladder.length - 1];
  return { value: base / IN_BASE[smallest], unit: smallest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/api/units.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/units.ts src/lib/api/units.test.ts
git commit -m "feat: pure unit conversion module for grocery merging"
```

---

### Task 2: Ingredient synonyms in normalizeItem

**Files:**
- Modify: `src/lib/api/normalizeItem.ts`
- Test: `src/lib/api/normalizeItem.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeItem(item: string): string`, signature unchanged.

**Key design note:** synonyms apply LAST, after lowercase, comma-strip, prep-word removal and singularization. So the map only needs singular canonical forms: "scallions, chopped" is already "scallion" by the time the map sees it.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/api/normalizeItem.test.ts`:

```ts
test("normalizeItem maps known synonyms to a canonical name", () => {
  expect(normalizeItem("all-purpose flour")).toBe(normalizeItem("flour"));
  expect(normalizeItem("scallions")).toBe(normalizeItem("green onions"));
  expect(normalizeItem("garbanzo beans")).toBe(normalizeItem("chickpeas"));
});

test("synonyms apply after prep words and plurals are stripped", () => {
  expect(normalizeItem("Scallions, finely chopped")).toBe(normalizeItem("green onion"));
  expect(normalizeItem("All-Purpose Flour, sifted")).toBe(normalizeItem("flour"));
});

test("an unknown item is left alone", () => {
  expect(normalizeItem("tamarind paste")).toBe("tamarind paste");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api/normalizeItem.test.ts`
Expected: FAIL, "all purpose flour" does not equal "flour".

- [ ] **Step 3: Write minimal implementation**

In `src/lib/api/normalizeItem.ts`, add the map after `PREP_WORDS` and apply it at the end of `normalizeItem`. Note `all-purpose` becomes `all purpose` because the hyphen is normalized to a space first, so the key has a space.

```ts
// Canonical names for items that are the same thing under different words.
// ponytail: curated data, not logic. A wrong entry silently merges two
// different ingredients, which is worse than not merging, so only add pairs
// that are genuinely identical. The LLM canonicalization pass, when it comes,
// replaces the lookup below without moving this call site.
const SYNONYMS: Record<string, string> = {
  "all purpose flour": "flour",
  "plain flour": "flour",
  "scallion": "green onion",
  "spring onion": "green onion",
  "garbanzo bean": "chickpea",
  "coriander": "cilantro",
  "aubergine": "eggplant",
  "courgette": "zucchini",
  "caster sugar": "sugar",
  "granulated sugar": "sugar",
  "confectioners sugar": "powdered sugar",
  "icing sugar": "powdered sugar",
  "bicarbonate of soda": "baking soda",
};
```

Then change the body so hyphens fold to spaces and the map applies last:

```ts
export function normalizeItem(item: string): string {
  let s = item.toLowerCase().split(",")[0];
  s = s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w && !PREP_WORDS.has(w));
  if (words.length) words[words.length - 1] = singularizeWord(words[words.length - 1]);
  const base = words.join(" ").trim();
  return SYNONYMS[base] ?? base;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/api/normalizeItem.test.ts`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/normalizeItem.ts src/lib/api/normalizeItem.test.ts
git commit -m "feat: curated ingredient synonyms in the normalizeItem seam"
```

---

### Task 3: Sum quantities in buildGroceryList

**Files:**
- Modify: `src/lib/api/types.ts` (the `GroceryLine` and `GroceryContribution` interfaces)
- Modify: `src/lib/api/grocery.ts`
- Test: `src/lib/api/grocery.test.ts`

**Interfaces:**
- Consumes: `normalizeUnit`, `unitFamily`, `toBase`, `fromBase` from Task 1; `parseQuantity`, `formatQuantity` from `./quantity`.
- Produces: `GroceryLine` gains `totals: { quantity: string; unit: string }[]` and `partial: boolean`. `GroceryContribution` gains `scaled: boolean`. `IngredientRow` gains `scaled: boolean`.

**Key design note:** a contribution only merges when `parseQuantity` returns a range whose `min` equals `max`. A genuine range like "2-3" stays unmerged, because summing the ends of ranges produces a number nobody asked for.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/api/grocery.test.ts`:

```ts
const row = (o: Partial<IngredientRow> & { item: string }): IngredientRow => ({
  recipeTitle: "R", quantity: null, unit: null, scaled: false, ...o,
});

test("sums contributions that share a unit", () => {
  const [line] = buildGroceryList([
    row({ item: "flour", quantity: "2", unit: "cups", recipeTitle: "A" }),
    row({ item: "flour", quantity: "1", unit: "cup", recipeTitle: "B" }),
  ], [], []);
  expect(line.totals).toEqual([{ quantity: "3", unit: "cup" }]);
  expect(line.partial).toBe(false);
});

test("converts within a family before summing", () => {
  const [line] = buildGroceryList([
    row({ item: "olive oil", quantity: "2", unit: "tbsp" }),
    row({ item: "olive oil", quantity: "1/4", unit: "cup" }),
  ], [], []);
  expect(line.totals).toEqual([{ quantity: "6", unit: "tbsp" }]);
  expect(line.partial).toBe(false);
});

test("reports one total per family and flags the line as partial", () => {
  const [line] = buildGroceryList([
    row({ item: "flour", quantity: "1", unit: "cup" }),
    row({ item: "flour", quantity: "500", unit: "g" }),
  ], [], []);
  expect(line.totals).toHaveLength(2);
  expect(line.partial).toBe(true);
});

test("an unparseable quantity does not merge and marks the line partial", () => {
  const [line] = buildGroceryList([
    row({ item: "salt", quantity: "1", unit: "tsp" }),
    row({ item: "salt", quantity: "a pinch", unit: null }),
  ], [], []);
  expect(line.totals).toEqual([{ quantity: "1", unit: "tsp" }]);
  expect(line.partial).toBe(true);
});

test("a manual line has no totals and is not partial", () => {
  const lines = buildGroceryList([], [{ id: "m1", label: "napkins" }], []);
  expect(lines[0].totals).toEqual([]);
  expect(lines[0].partial).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api/grocery.test.ts`
Expected: FAIL, `totals` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/api/types.ts`:

```ts
export interface GroceryContribution {
  quantity: string | null; unit: string | null; recipeTitle: string; scaled: boolean;
}
export interface GroceryLine {
  key: string; name: string; contributions: GroceryContribution[];
  checked: boolean; manual: boolean;
  totals: { quantity: string; unit: string }[];
  partial: boolean;
}
```

In `src/lib/api/grocery.ts`, add `scaled: boolean` to `IngredientRow`, carry it onto each contribution, and compute totals after the grouping loop:

```ts
import { normalizeUnit, unitFamily, toBase, fromBase, type UnitFamily } from "./units";
import { parseQuantity, formatQuantity } from "./quantity";

// Sum a line's contributions per unit family. A contribution merges only when
// its quantity is a single parseable value (not a range like "2-3") and its
// unit is recognized. Anything else leaves the line partial, so the UI can say
// the total is not the whole story.
function summarize(cs: GroceryContribution[]): { totals: { quantity: string; unit: string }[]; partial: boolean } {
  const byFamily = new Map<UnitFamily, number>();
  let partial = false;

  for (const c of cs) {
    const family = unitFamily(c.unit);
    const parsed = parseQuantity(c.quantity);
    const unit = normalizeUnit(c.unit);
    if (!family || !unit || !parsed || parsed.min !== parsed.max) { partial = true; continue; }
    const base = toBase(parsed.min, unit);
    if (base === null) { partial = true; continue; }
    byFamily.set(family, (byFamily.get(family) ?? 0) + base);
  }

  const totals = Array.from(byFamily.entries()).map(([family, base]) => {
    const { value, unit } = fromBase(base, family);
    return { quantity: formatQuantity(value), unit };
  });
  return { totals, partial: partial || totals.length > 1 };
}
```

Build each line's contribution with `scaled: r.scaled`, then before returning, map every non-manual line through `summarize`. Manual lines get `totals: []` and `partial: false`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/api/grocery.test.ts && npx tsc -b`
Expected: PASS. `tsc` will flag any remaining construction of `GroceryLine` or `IngredientRow` that is missing the new fields; fix those call sites.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/types.ts src/lib/api/grocery.ts src/lib/api/grocery.test.ts
git commit -m "feat: sum grocery quantities per unit family"
```

---

### Task 4: Persist a servings target on plan items

**Files:**
- Create: `supabase/migrations/0011_plan_item_servings.sql`
- Modify: `src/lib/api/types.ts` (`MealPlanItem`)
- Modify: `src/lib/api/mealPlans.ts` (`listItems`, new `setItemServings`)
- Test: `tests/integration/plan_item_servings.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MealPlanItem` gains `servings: number | null`; `setItemServings(itemId: string, servings: number | null): Promise<void>`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_plan_item_servings.sql`:

```sql
-- A planned recipe can be cooked for a different number of people than it was
-- written for, so the grocery list needs a per-item target. Nullable, where
-- null means "use the recipe's own servings", which keeps every existing row
-- behaving exactly as before and needs no backfill.
--
-- Per item rather than per plan: one plan legitimately mixes a dinner for 8
-- with a lunch for 2. Adding a column does not widen the existing
-- meal_plan_items RLS policies (0008), which already gate the row.
alter table meal_plan_items
  add column servings int check (servings is null or servings > 0);
```

- [ ] **Step 2: Apply it and confirm it lands**

Run: `npx supabase db reset`
Expected: the output lists `Applying migration 0011_plan_item_servings.sql` and finishes without error.

- [ ] **Step 3: Write the failing integration test**

Create `tests/integration/plan_item_servings.test.ts`:

```ts
// @vitest-environment node
// Verifies the 0011 servings column: it round-trips through setItemServings,
// defaults to null, and rejects a non-positive value at the database level.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

async function planWithItem(prefix: string) {
  const alice = await makeUser(`${prefix}${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: alice.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: alice.id, title: "T", visibility: "family" })
    .select().single();
  const { data: plan } = await admin.from("meal_plans")
    .insert({ name: "P", owner_id: alice.id, family_id: fam!.id }).select().single();
  const { data: item } = await admin.from("meal_plan_items")
    .insert({ plan_id: plan!.id, recipe_id: rec!.id }).select().single();
  return { alice, item: item! };
}

test("servings defaults to null and round-trips", async () => {
  const { alice, item } = await planWithItem("ps");
  expect(item.servings).toBeNull();

  const { error } = await alice.client.from("meal_plan_items")
    .update({ servings: 8 }).eq("id", item.id);
  expect(error).toBeNull();

  const { data } = await admin.from("meal_plan_items")
    .select("servings").eq("id", item.id).single();
  expect(data!.servings).toBe(8);
});

test("a non-positive servings value is rejected by the check constraint", async () => {
  const { alice, item } = await planWithItem("ps-zero");
  const { error } = await alice.client.from("meal_plan_items")
    .update({ servings: 0 }).eq("id", item.id);
  expect(error).not.toBeNull();
});
```

Note: if the `meal_plans` insert above fails because the column names differ, read `supabase/migrations/0008_meal_plans.sql` and match it exactly. Do not change the migration to suit the test.

- [ ] **Step 4: Run the integration test**

Run, with the Supabase env exported first:

```bash
npm run test:int
```

Expected: both new tests PASS and the existing integration files still pass.

- [ ] **Step 5: Add the API surface**

In `src/lib/api/types.ts`, add `servings: number | null;` to `MealPlanItem`.

In `src/lib/api/mealPlans.ts`, include `servings` in the `listItems` select, and add:

```ts
// null means "use the recipe's own servings"
export async function setItemServings(itemId: string, servings: number | null): Promise<void> {
  const { error } = await supabase.from("meal_plan_items")
    .update({ servings }).eq("id", itemId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add supabase/migrations/0011_plan_item_servings.sql src/lib/api/types.ts src/lib/api/mealPlans.ts tests/integration/plan_item_servings.test.ts
git commit -m "feat: per-plan-item servings target (migration 0011)"
```

---

### Task 5: Scale ingredient rows before building the list

**Files:**
- Modify: `src/lib/api/mealPlans.ts:111-135` (`getGroceryList`)
- Test: `src/lib/api/mealPlans.test.ts`

**Interfaces:**
- Consumes: `scaleIngredientQty`, `parseQuantity` from `./quantity`; `IngredientRow` with `scaled` from Task 3; `MealPlanItem.servings` from Task 4.
- Produces: no new exports. `getGroceryList` behavior changes only.

**Key design note, do not skip:** `getGroceryList` currently de-dupes by DISTINCT `recipe_id`, so a recipe planned twice contributes once. That rule breaks now: the same recipe planned for 8 on Tuesday and 2 on Friday must contribute twice, scaled differently. De-dupe by the PAIR `(recipe_id, servings)` instead. Same recipe at the same servings still contributes once, preserving today's behavior.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/api/mealPlans.test.ts` a test that mocks the Supabase client so `meal_plan_items` returns two items for the same recipe with `servings` 8 and `null`, the recipe has `servings: 4` and one ingredient `2 cups flour`, and then asserts:

```ts
// recipe serves 4; one item targets 8 (factor 2), the other leaves it alone
// so the flour line carries a scaled 4 cups and an unscaled 2 cups
const lines = await getGroceryList("p1");
const flour = lines.find((l) => l.name.includes("flour"))!;
expect(flour.contributions).toHaveLength(2);
expect(flour.contributions.some((c) => c.quantity === "4" && c.scaled)).toBe(true);
expect(flour.contributions.some((c) => c.quantity === "2" && !c.scaled)).toBe(true);
expect(flour.totals).toEqual([{ quantity: "6", unit: "cup" }]);
```

Follow the existing mocking style in that file. If `mealPlans.test.ts` does not already mock `supabase`, mirror the mock at the top of `src/lib/api/recipes.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api/mealPlans.test.ts`
Expected: FAIL, only one contribution, unscaled.

- [ ] **Step 3: Write minimal implementation**

In `getGroceryList`:

1. Select `recipe_id,servings` from `meal_plan_items` instead of `recipe_id`.
2. Select `id,title,servings` from `recipes`.
3. Build the distinct set keyed by `` `${recipe_id}:${servings ?? ""}` ``.
4. For each distinct pair, compute the factor:

```ts
// Only scale when we have both a target and a base to scale from. A recipe
// with no servings has no base, so its rows pass through untouched.
const factor = target && recipe.servings ? target / recipe.servings : null;
```

5. Map each ingredient row:

```ts
const canScale = factor !== null && factor !== 1 && parseQuantity(g.quantity) !== null;
rows.push({
  recipeTitle: titleById.get(g.recipe_id) ?? "",
  quantity: canScale ? scaleIngredientQty(g.quantity, factor!) : g.quantity,
  unit: g.unit,
  item: g.item,
  scaled: canScale,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/api/mealPlans.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/mealPlans.ts src/lib/api/mealPlans.test.ts
git commit -m "feat: scale planned recipe ingredients by the item servings target"
```

---

### Task 6: Servings stepper on the plan item

**Files:**
- Modify: `src/pages/MealPlanDetail.tsx`
- Test: `src/pages/MealPlanDetail.test.tsx`

**Interfaces:**
- Consumes: `setItemServings` from Task 4; `MealPlanItem.servings`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to `src/pages/MealPlanDetail.test.tsx` a test asserting that an item whose recipe has `servings: null` renders a disabled stepper, and an item whose recipe has servings renders an enabled one whose increment calls `setItemServings`. Mock `../lib/api/mealPlans` the way the existing tests in that file already do.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/MealPlanDetail.test.tsx`
Expected: FAIL, no stepper in the output.

- [ ] **Step 3: Write minimal implementation**

Render, per item, a stepper reusing the existing portions control markup and classes from `src/pages/RecipeDetail.tsx`. Do not invent a second visual treatment, and do not add a CSS file: this project's styling is global in `src/index.css`.

- When the item's recipe has `servings === null`, render the control `disabled` with `title="This recipe does not record how many it serves, so it cannot be scaled."`
- The displayed value is `item.servings ?? recipe.servings`.
- Changing it calls `setItemServings(item.id, value)` and refreshes the grocery list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/MealPlanDetail.test.tsx && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MealPlanDetail.tsx src/pages/MealPlanDetail.test.tsx
git commit -m "feat: servings stepper per planned recipe"
```

---

### Task 7: Show totals and the unscaled or mixed markers

**Files:**
- Modify: `src/components/GroceryPanel.tsx`
- Test: `src/components/GroceryPanel.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `GroceryLine.totals`, `GroceryLine.partial`, `GroceryContribution.scaled` from Tasks 3 and 5.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Assert that a line with `totals: [{ quantity: "3", unit: "cup" }]` shows "3 cup" as its headline, that a line with `partial: true` shows a "mixed units" marker, and that a contribution with `scaled: false` on an otherwise scaled line shows an "unscaled" marker.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/GroceryPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Render `line.totals` joined as the line's headline quantity next to `line.name`, keep the existing per-recipe contribution breakdown underneath unchanged, and add the two markers using existing `.chip` styling from `src/index.css`. No new CSS file.

- [ ] **Step 4: Run the full suite**

Run: `npx tsc -b && npm test`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add src/components/GroceryPanel.tsx src/components/GroceryPanel.test.tsx
git commit -m "feat: grocery line totals with mixed-unit and unscaled markers"
```

---

## Final verification

- [ ] `npx tsc -b && npm test`
- [ ] `npx supabase db reset` applies `0001` through `0011`
- [ ] `npm run test:int` with `SB_URL`, `SB_ANON_KEY`, `SB_SERVICE_KEY` exported
- [ ] Browser check: plan a recipe twice at different servings, confirm the grocery list shows both contributions with different quantities and one summed total where units agree
