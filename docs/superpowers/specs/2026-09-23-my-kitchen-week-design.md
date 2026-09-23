# My Kitchen: dated plans, week grid, up next, repeat, leftovers, pantry staples

Date: 2026-09-23
Status: approved (data model approved in chat; UI/API decided here, open to revision on review)

## Problem

My Kitchen answers none of the three questions its owner actually has. It lists plan names.
"What am I cooking tonight", "what do I need to buy", and "let me plan the week quickly" all
require opening a plan and reading a flat list of items whose dates live in per-row dropdowns.

A plan has no date range: `day` lives on items, so "this week" is emergent and cannot be named,
repeated, or archived as a unit.

Separately, the household cooks one pot and eats it twice (dinner, then lunch the next day).
Today that is either invisible to the app or entered as a second recipe item, which double-counts
the ingredients in the grocery list.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Core job | All three: plan the week, shop from it, cook from it. Sequenced, not built at once. |
| 2 | Plan shape | Plans gain a nullable `start_date` and `length_days` (default 7). Undated plans keep working. |
| 3 | Scope | Today/Up next landing, week grid, repeat/duplicate, pantry staples, leftovers. |
| 4 | Today source | Merged across all readable plans, including shared family plans, each row labelled with its plan. |
| 5 | Leftover math | Offer, never apply. Marking a leftover nudges "bump the source to N servings?" with a button. |
| 6 | Drag and drop | Out of scope. Tap-to-assign works on phones; drag is a dependency plus touch edge cases for the same outcome. |

## Architecture

### Data model (migration `0012`)

Additive only. Every new column is nullable or defaulted, so the currently deployed frontend keeps
working against the new schema mid-rollout (the property that made `0010`/`0011` safe to push ahead
of the frontend).

```sql
alter table meal_plans add column start_date date;
alter table meal_plans add column length_days int not null default 7
  check (length_days between 1 and 31);

alter table meal_plan_items add column leftover_of uuid
  references meal_plan_items(id) on delete cascade;

create table pantry_staples (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  key text not null,      -- normalizeItem() output, so "all-purpose flour" matches "flour"
  label text not null,    -- what the user typed, for display
  unique (family_id, key)
);
```

`0012` also adds the `duplicate_plan` RPC described under API additions.

`pantry_staples` RLS mirrors the existing family-scoped tables: `is_family_member(family_id)` for
both read and write. Staples are per family, not per user: one household, one cupboard.

`leftover_of` cascades on delete, because a leftover of a deleted meal is a lie. The existing
`unique (plan_id, recipe_id, day, meal_slot)` already allows the same recipe in a different slot,
so pointer rows need no constraint change.

### The merged "up next" query needs no new RLS

`plan_items_read` is `can_read_plan(plan_id)`, which is already "I own the plan OR it is shared and
I am in the family" (`0008_meal_plans.sql`). A single date-filtered select over `meal_plan_items`
therefore returns exactly the merge decision 4 asks for, with no RPC and no new policy.

### API additions (`src/lib/api/mealPlans.ts`)

All new data access stays inside `src/lib/api/`, per the project's data-access boundary rule.

- `setPlanDates(id, startDate: string | null, lengthDays: number)`
- `listUpcoming(days: number)`: one select over `meal_plan_items` filtered `day >= today` and
  `day < today + days`, embedding `recipes(id,title,servings)` and `meal_plans(id,name,owner_id,is_shared)`,
  ordered by `day` then slot. Returns rows tagged `readOnly` when `owner_id !== auth user`.
- `addLeftover(planId, sourceItemId, { day, mealSlot })`: copies `recipe_id` from the source row and
  sets `leftover_of`.
- `duplicatePlan(id, newStartDate)`: a `duplicate_plan(p_id uuid, p_start date)` SECURITY INVOKER
  RPC (new in `0012`). Clones the plan row and its items in one statement, shifting every `day` by
  `newStartDate - old start_date`, and remapping `leftover_of` to the cloned rows. Doing this
  client-side would be N+1 round trips and could half-clone on failure. Mirrors the existing
  `replace_recipe_children` precedent.
- `listStaples(familyId)` / `addStaple(familyId, label)` / `removeStaple(id)`: `addStaple` stores
  `normalizeItem(label)` as `key`.

### Grocery interaction

Two changes, both at the existing seam:

1. `getGroceryList` excludes rows where `leftover_of is not null` **before** `buildGroceryList` sees
   them. One filter, one place, pinned by an integration test. A leftover must never contribute
   ingredients: the pot was already bought for.
2. `buildGroceryList(rows, { staples })` marks a line `staple: true` when its normalized key is in
   the family's staple set, rather than dropping it. `GroceryPanel` renders those in a separate
   collapsed "check you have these" group. Dropping silently would hide a real shortage; the user
   asked for staples to stop cluttering the list, not to become unverifiable.

`buildGroceryList` stays pure, so both behaviours are unit-testable with no database.

### Leftover servings nudge

Pure helper, `suggestedServings(base, leftoverCount) = base * (1 + leftoverCount)`, where `base` is
the source item's `servings ?? recipe.servings`. When both are null the recipe has no serving count
to scale, so the nudge is skipped entirely rather than guessing. After `addLeftover` succeeds, if the source item's
current servings is below the suggestion, the UI shows one line with a Bump button calling the
existing `setItemServings`. No automatic write. Declining leaves everything as it was.

### UI

- **`MyKitchen`** leads with **Today / Up next** from `listUpcoming(4)`: today plus the next three
  days, grouped by day, each row showing slot, recipe, servings, plan name, a `shared` chip when it
  came from someone else's plan, and a Cook button into the existing cook route. The plan list stays
  underneath, unchanged.
- **`MealPlanDetail` calendar mode** becomes a real grid: `length_days` columns by three slots,
  anchored on `start_date`. An empty cell is a `+` that opens the existing vault picker. A filled
  cell shows the recipe, a servings stepper, remove, and "send leftovers". Undated plans keep the
  flat list view; the grid is only offered once a plan has a `start_date`.
- **Plan header** gains a date-range editor (native `<input type="date">` plus a length select, no
  picker dependency, consistent with the existing per-item date input) and a "Duplicate to next
  week" button.
- **`GroceryPanel`** gains the staples group and a small staples editor.

## Testing

- Unit: `suggestedServings`; `buildGroceryList` staple flagging; the date-shift arithmetic used by
  duplicate (pure helper, tested independently of the RPC).
- Integration (`tests/integration/`): `0012` applies; a leftover row contributes nothing to
  `getGroceryList`; `duplicate_plan` clones items, shifts days, and remaps `leftover_of`;
  `pantry_staples` RLS denies a non-member; `listUpcoming` returns a shared family plan's item and
  marks it read-only.
- Browser: plan a week, send leftovers to the next day, accept the bump, confirm the grocery list
  counts the pot once at the bumped size.

## Rollout

Four shippable slices, in dependency order:

1. `0012` + dated plans + week grid
2. Today / Up next landing
3. Repeat / duplicate a week
4. Pantry staples

Leftovers ride with slice 1 (the column) and slice 1's grid UI (send leftovers + nudge), because the
grid is where the interaction lives. The grocery exclusion ships with it, in the same slice, so there
is never a window where a leftover double-counts.

DB changes go out with `npx supabase db push`; the frontend auto-deploys from master. No edge
function change, so no manual function deploy.

## Out of scope

- Drag and drop on the grid (decision 6).
- Aisle ordering of the grocery list; staples are the clutter problem being solved here.
- A "cooked it" history or ratings.
- Cross-family staples, or per-user staples inside a family.
- Notifications or reminders.
