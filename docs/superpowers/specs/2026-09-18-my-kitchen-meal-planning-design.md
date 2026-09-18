# My Kitchen — Meal Planning & Grocery List Design

**Date:** 2026-09-18
**Status:** Approved design, pre-implementation

## Summary

A personal, per-member space ("My Kitchen") where a family member plans what
they intend to cook by picking recipes from the family vault, and gets a
consolidated grocery list generated from those recipes. Plans are personal by
default and can be optionally shared (read-only) with the family. The grocery
list is grouped by ingredient (not by recipe), dedup'd across the plan, and
checkable so the user can tick off what they already have.

This is the "meal planning + auto shopping list" that v1 explicitly deferred
(see `2026-09-16-family-recipes-design.md` non-goals).

## Goals

1. A member can create named plans (e.g. "This week", "Sunday dinner") and add
   recipes to them from the existing vault.
2. A plan renders either as a simple bucket list or as a weekly calendar (day +
   meal slot), the member's choice, from **one** underlying data model.
3. A grocery list is generated from the plan's recipes, grouped by ingredient
   with duplicates collapsed across recipes, showing which recipes each
   ingredient serves.
4. Grocery items are checkable ("I already have this") and the checked state
   persists. The member can add and remove their own lines by hand.
5. Plans are private by default; a member can share a plan read-only with the
   family.

## Non-goals (this phase)

- **Expensive ingredient normalization** (synonym/entity resolution such as
  `all-purpose flour` == `flour`, `scallions` == `green onions`, or an
  LLM-assisted canonicalization pass). Deferred to the roadmap; see below.
- Unit math / quantity summation (freeform text quantities are shown as-is, not
  arithmetically combined).
- Editing a shared plan by non-owners (share is read-only).
- Nutrition, cost estimation, store/aisle categorization, export to external
  shopping apps, recurring/auto-generated plans.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | Personal meal-planning space + grocery list | Matches the user's "own tab" + "know what to buy" intent (options B+C). |
| Plan sharing | Personal by default, optionally shareable read-only with family | User picked "personal but shareable"; owner-only editing keeps RLS simple. |
| Plan structure | One model, two views (bucket list OR weekly calendar) | User wants both A and B; nullable day/slot columns render either way with no duplicated subsystem. |
| Grocery grouping | By ingredient, dedup'd across recipes | Shopping happens by ingredient, not by recipe; avoids a long repetitive list. |
| Grocery derivation | Computed at read time, never stored | Ingredients live on recipes already; no denormalization to keep in sync. |
| Ingredient matching | Normalized-name key (lowercase, strip prep-words/descriptors, naive singularize) | Cheap pure function merges the common cases; manual add/remove covers misses. |
| Checked state | `text[]` column of checked keys on the plan | Right size for personal scale; a join table is YAGNI until a checkmark needs its own metadata. |
| Manual grocery lines | Supported (add + remove) | A grocery list built on freeform data needs a human escape hatch to be trustworthy. |

## Architecture

- **Frontend:** new "My Kitchen" tab/route in the existing React app. Reuses the
  existing recipe-browse UI for the "add recipes from vault" picker.
- **Data/auth:** Supabase, RLS-enforced, consistent with the rest of the app.
- **Data-access boundary:** all Supabase access for this feature lives in a new
  `src/lib/api/mealPlans.ts` (project rule: nothing outside `src/lib/api/`
  touches the client). The grocery-grouping logic is a pure function, kept
  separate and unit-tested.

## Data model

Two new tables + one column, in a single migration (`0008`).

- **meal_plans**
  - `id` uuid pk
  - `owner_id` uuid not null references profiles(id)
  - `family_id` uuid not null references families(id) on delete cascade
    (scopes sharing to one family)
  - `name` text not null
  - `view_mode` text not null default `'list'` — `'list' | 'calendar'`
  - `is_shared` boolean not null default false
  - `checked_items` text[] not null default `'{}'` — normalized ingredient keys
    (and manual-line keys) the owner has ticked off
  - `created_at`, `updated_at` timestamptz not null default now()

- **meal_plan_items** — a recipe placed in a plan
  - `id` uuid pk
  - `plan_id` uuid not null references meal_plans(id) on delete cascade
  - `recipe_id` uuid not null references recipes(id) on delete cascade
  - `day` date null — for calendar view; null = unscheduled (bucket)
  - `meal_slot` text null — `'breakfast' | 'lunch' | 'dinner'` (nullable)
  - `position` int not null — ordering within the plan / within a day+slot
  - unique (`plan_id`, `recipe_id`, `day`, `meal_slot`) to avoid exact dupes

- **meal_plan_manual_items** — grocery lines the user typed themselves
  - `id` uuid pk
  - `plan_id` uuid not null references meal_plans(id) on delete cascade
  - `label` text not null — free text, e.g. "aluminium foil"
  - `position` int not null

Manual lines are a tiny separate table rather than another `text[]`, because
they need stable identity for check state and removal, and they are not derived
from any recipe.

## Grocery list generation (read-time)

`getGroceryList(planId)` returns a list of lines. Each derived line:

1. Collect `recipe_ingredients` for every recipe referenced by the plan's items.
   (A recipe added to multiple day/slots contributes its ingredients once — we
   dedup source recipes before gathering ingredients.)
2. Compute a grouping key: `normalizeItem(item)` =
   - lowercase, trim, collapse internal whitespace
   - strip a trailing descriptor after a comma (`"flour, sifted"` -> `"flour"`)
   - remove common prep/quality words as whole words (`chopped`, `diced`,
     `minced`, `fresh`, `sliced`, `ground`, `large`, `small`, `to taste`, ...)
   - naive singularize (`onions` -> `onion`, `eggs` -> `egg`)
3. Group ingredients by that key. Each grouped line carries:
   - a display name (the most common / first original `item` text in the group)
   - the list of `{quantity, unit, recipe_title}` contributions
   - `checked`: whether its key is in `meal_plans.checked_items`
4. Append manual items as their own lines (keyed by `manual:<id>`), also
   checkable.

Quantities are displayed as-is per source recipe (`"2 cups (Bread), 1 cup
(Pancakes)"`); they are **not** summed.

`normalizeItem` is a pure function in its own module with unit tests; it is the
one piece of non-trivial logic and the single upgrade point for future
normalization work.

`ponytail: grouping key = normalizeItem() (lowercase, strip prep-words +
trailing descriptor, naive singularize); synonym/LLM canonicalization is a
separate deferred feature (see Roadmap).`

## API surface (`src/lib/api/mealPlans.ts`)

- `listPlans()` — the caller's own plans + plans shared to their families.
- `createPlan({ familyId, name })`
- `renamePlan(planId, name)`, `setViewMode(planId, mode)`,
  `setShared(planId, isShared)`, `deletePlan(planId)`
- `addRecipe(planId, recipeId, { day?, mealSlot? })`
- `removeItem(itemId)`, `moveItem(itemId, { day?, mealSlot?, position? })`
- `getGroceryList(planId)` — the grouped, derived list described above.
- `toggleChecked(planId, key, checked)` — updates `checked_items`.
- `addManualItem(planId, label)`, `removeManualItem(manualId)`

Owner-only mutations are enforced by RLS (below); the API does not re-check.

## RLS

- **meal_plans**
  - select: `owner_id = auth.uid()` OR (`is_shared = true` AND
    `is_family_member(family_id)`)
  - insert: `owner_id = auth.uid()` AND `is_family_member(family_id)`
  - update / delete: `owner_id = auth.uid()`
- **meal_plan_items** and **meal_plan_manual_items**
  - select: parent plan is selectable (owner, or shared to a family member)
  - insert / update / delete: caller owns the parent plan

Mirror the v1 pattern: a `can_read_plan(pid uuid)` SECURITY DEFINER helper for
the child tables' select policies, and an owner check for writes. This keeps the
shared-vs-private boundary in one place.

## UI

New **My Kitchen** tab:

- **Plans column:** the member's plans + a "shared with me" section; create /
  rename / delete; a share toggle per owned plan.
- **Plan detail:** a `list` / `calendar` view toggle.
  - list view: recipes as an ordered bucket.
  - calendar view: recipes grouped into day + meal-slot cells.
  - "Add recipes from vault" opens the existing recipe browser as a picker.
- **Grocery panel:** the derived grouped list, each line a checkbox with its
  source-recipe note; a field to add a manual line and a control to remove one.
  Shared plans render read-only for non-owners (no checkboxes / no edits).

## Error handling

- Adding a recipe already present at the same day+slot: no-op (unique
  constraint; surface a gentle "already in this slot").
- A recipe referenced by a plan is deleted: `on delete cascade` removes the plan
  item; the grocery list recomputes without it.
- Empty plan: grocery list shows an empty state, not an error.
- Toggling check / adding manual line on a shared plan you don't own: blocked by
  RLS; UI hides those controls for non-owners.

## Testing

- **Unit:** `normalizeItem` (casing, comma descriptor, prep-words, singularize)
  and the grocery grouping/dedup (same ingredient across recipes collapses to
  one line; a recipe in two slots contributes ingredients once; manual lines
  appear; checked state reflects `checked_items`).
- **Integration:** plan + item CRUD, and the **shared-vs-private RLS boundary**
  (a family member can read a shared plan and its grocery list but cannot edit
  it; cannot see an un-shared plan). This is the exact bug class that bit v1
  family creation, so it gets explicit coverage.

## Roadmap (deferred, not this phase)

1. **Expensive ingredient normalization.** Synonym/entity resolution so
   `all-purpose flour` == `flour`, `scallions` == `green onions`, etc. Options to
   evaluate when picked up: a curated synonym map, or an LLM canonicalization
   pass (would add a stored canonical id/column, a backfill migration, cost +
   latency, and would touch the AI-extraction path). Needs its own
   brainstorm + spec. The `normalizeItem` function is the single seam this will
   extend.
2. **Unit-aware quantity merging** (sum `2 cups + 1 cup`), which depends on
   parsing the freeform `quantity`/`unit` text — related to (1).
3. Store/aisle categorization, export to external shopping apps, shared
   collaborative (editable) plans.
