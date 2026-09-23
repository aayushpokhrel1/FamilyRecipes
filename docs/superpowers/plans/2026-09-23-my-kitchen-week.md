# My Kitchen Week Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn My Kitchen from a list of plan names into a week you can plan, shop from, and cook from, with leftovers modelled as one cook event filling several slots.

**Architecture:** Additive migration `0012` gives plans a date range, gives items a `leftover_of` pointer, and adds a family-scoped `pantry_staples` table. The merged "up next" view needs no new RLS because `plan_items_read` is already `can_read_plan`. Leftover rows are excluded from the grocery aggregation at one place in `getGroceryList`; staples are flagged (not dropped) inside the pure `buildGroceryList`.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + RLS), vitest + @testing-library/react, plain CSS in `src/index.css`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-my-kitchen-week-design.md`

## Global Constraints

- **Data-access boundary:** ALL supabase access lives in `src/lib/api/`. No component imports the client.
- **Verify with `npx tsc -b && npm test`** (NOT `tsc --noEmit`). Migration changes also need `npx supabase db reset` (Docker required).
- **Integration tests need env vars the script does not inject:** export `SB_URL`, `SB_ANON_KEY`, `SB_SERVICE_KEY` from `npx supabase status -o env` before `npm run test:int`.
- **No em dashes or en dashes (—, –)** anywhere: code, comments, docs, commit messages. Use a comma, a colon, parentheses, or two sentences.
- **No new dependencies.** Native `<input type="date">`, CSS grid, and the existing helpers only.
- **Styling is global CSS** in `src/index.css` using existing tokens (`--plate`, `--ink`, `--action`, `--chip`, `--rim`, `--radius`). Pages carry class hooks only; there are zero component CSS files.
- **Migrations are additive.** The deployed frontend must keep working against the new schema, because the DB is pushed before the frontend rebuild lands.
- **Commit after every task.** Work on `master`.

---

### Task 1: Migration 0012 (dates, leftover pointer, staples, duplicate RPC)

**Files:**
- Create: `supabase/migrations/0012_my_kitchen_week.sql`
- Test: `tests/integration/my_kitchen_week.test.ts`

**Interfaces:**
- Consumes: `is_family_member(uuid)` and `can_read_plan(uuid)` from `0008_meal_plans.sql`.
- Produces: columns `meal_plans.start_date`, `meal_plans.length_days`, `meal_plan_items.leftover_of`; table `pantry_staples(id, family_id, key, label)`; RPC `duplicate_plan(p_id uuid, p_start date) returns uuid`.

- [ ] **Step 1: Write the migration**

```sql
-- 0012: a plan can own a stretch of dates; one cook event can fill several
-- slots; a family can record the staples it always keeps in.
alter table meal_plans add column start_date date;
alter table meal_plans add column length_days int not null default 7
  check (length_days between 1 and 31);

-- A leftover points at the item whose pot it came from. Cascade: a leftover of
-- a deleted meal is a lie.
alter table meal_plan_items add column leftover_of uuid
  references meal_plan_items(id) on delete cascade;

create table pantry_staples (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  key text not null,   -- normalizeItem() output, so "all-purpose flour" matches "flour"
  label text not null, -- what the user typed, for display
  unique (family_id, key)
);

alter table pantry_staples enable row level security;
create policy staples_read on pantry_staples for select
  using (is_family_member(family_id));
create policy staples_write on pantry_staples for all
  using (is_family_member(family_id)) with check (is_family_member(family_id));

-- Clone a plan and its items in one statement, shifting every dated item by the
-- gap between the old and new start, and remapping leftover pointers to the
-- clones. SECURITY INVOKER: the caller's RLS decides what they may read and
-- insert, exactly as a client-side clone would.
create function duplicate_plan(p_id uuid, p_start date) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  new_id uuid;
  shift int;
begin
  select coalesce(p_start - start_date, 0) into shift from meal_plans where id = p_id;

  insert into meal_plans (owner_id, family_id, name, view_mode, is_shared, start_date, length_days)
  select auth.uid(), family_id, name || ' (copy)', view_mode, false, p_start, length_days
  from meal_plans where id = p_id
  returning id into new_id;

  with src as (
    select * from meal_plan_items where plan_id = p_id order by position
  ), ins as (
    insert into meal_plan_items (plan_id, recipe_id, day, meal_slot, position, servings)
    select new_id, recipe_id,
           case when day is null then null else day + shift end,
           meal_slot, position, servings
    from src
    returning id, recipe_id, meal_slot, position
  )
  update meal_plan_items tgt
  set leftover_of = (
    select i.id from ins i
    join src s on s.position = i.position and s.recipe_id = i.recipe_id
                and s.meal_slot is not distinct from i.meal_slot
    where s.id = (select leftover_of from src where src.position = tgt.position
                    and src.recipe_id = tgt.recipe_id limit 1)
    limit 1)
  where tgt.plan_id = new_id
    and exists (select 1 from src s2 where s2.position = tgt.position
                  and s2.recipe_id = tgt.recipe_id and s2.leftover_of is not null);

  return new_id;
end; $$;
```

- [ ] **Step 2: Apply it and verify it fails nothing**

Run: `npx supabase db reset`
Expected: all migrations `0001..0012` apply with no error.

- [ ] **Step 3: Write the integration test**

```ts
// @vitest-environment node
import { test, expect } from "vitest";
import { admin, makeUser } from "./helpers";

test("0012: staples are family-scoped and a non-member is denied", async () => {
  const a = await makeUser();
  const family = await a.createFamily("Staples fam");
  const { error: okErr } = await a.client.from("pantry_staples")
    .insert({ family_id: family.id, key: "salt", label: "Salt" });
  expect(okErr).toBeNull();

  const b = await makeUser();
  const { data: theirs } = await b.client.from("pantry_staples").select("id");
  expect(theirs).toEqual([]);
  const { error: denied } = await b.client.from("pantry_staples")
    .insert({ family_id: family.id, key: "pepper", label: "Pepper" });
  expect(denied).not.toBeNull();
});
```

Note: follow the existing helper style in `tests/integration/`; if the helpers there expose different names, use theirs rather than inventing `makeUser`.

- [ ] **Step 4: Run the integration test**

Run: `npm run test:int -- my_kitchen_week` (after exporting `SB_URL`, `SB_ANON_KEY`, `SB_SERVICE_KEY`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_my_kitchen_week.sql tests/integration/my_kitchen_week.test.ts
git commit -m "feat: migration 0012 for dated plans, leftovers, and pantry staples"
```

---

### Task 2: Plan dates in types and API

**Files:**
- Modify: `src/lib/api/types.ts` (MealPlan, MealPlanItem)
- Modify: `src/lib/api/mealPlans.ts` (listPlans select, new setPlanDates)

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `MealPlan.start_date: string | null`, `MealPlan.length_days: number`, `MealPlanItem.leftover_of: string | null`, and `setPlanDates(id: string, startDate: string | null, lengthDays: number): Promise<void>`.

- [ ] **Step 1: Extend the types**

```ts
export interface MealPlan {
  id: string; owner_id: string; family_id: string; name: string;
  view_mode: MealPlanViewMode; is_shared: boolean; checked_items: string[];
  start_date: string | null; length_days: number;
  created_at: string; updated_at: string;
}
export interface MealPlanItem {
  id: string; plan_id: string; recipe_id: string;
  day: string | null; meal_slot: MealSlot | null; position: number;
  servings: number | null; leftover_of: string | null;
}
```

- [ ] **Step 2: Add the new columns to every select that builds these types**

In `src/lib/api/mealPlans.ts`, `listPlans` must select `start_date,length_days` and `listItems` must select `leftover_of`. Missing a column here makes the field `undefined` at runtime while typechecking clean, so grep for `.select(` in that file and update each one that returns a plan or item.

- [ ] **Step 3: Add setPlanDates**

```ts
export async function setPlanDates(
  id: string, startDate: string | null, lengthDays: number,
): Promise<void> {
  const { error } = await supabase.from("meal_plans")
    .update({ start_date: startDate, length_days: lengthDays }).eq("id", id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc -b && npm test`
Expected: clean build, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/types.ts src/lib/api/mealPlans.ts
git commit -m "feat: carry plan dates and the leftover pointer through the API types"
```

---

### Task 3: Leftovers never reach the grocery list

**Files:**
- Modify: `src/lib/api/mealPlans.ts` (`getGroceryList` item select, new `addLeftover`)
- Test: `tests/integration/my_kitchen_week.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's types.
- Produces: `addLeftover(planId: string, sourceItemId: string, opts: { day: string | null; mealSlot: MealSlot | null }): Promise<MealPlanItem>`.

- [ ] **Step 1: Exclude leftovers at the one place they are fetched**

In `getGroceryList`, the items query is currently:

```ts
supabase.from("meal_plan_items").select("recipe_id,servings").eq("plan_id", planId),
```

Change it to:

```ts
// A leftover is the same pot eaten again, so it contributes no ingredients.
// This is the ONLY place leftovers are filtered; buildGroceryList must never
// need to know the concept exists.
supabase.from("meal_plan_items").select("recipe_id,servings")
  .eq("plan_id", planId).is("leftover_of", null),
```

- [ ] **Step 2: Add addLeftover**

```ts
export async function addLeftover(
  planId: string, sourceItemId: string,
  opts: { day: string | null; mealSlot: MealSlot | null },
): Promise<MealPlanItem> {
  const { data: src, error: sErr } = await supabase.from("meal_plan_items")
    .select("recipe_id").eq("id", sourceItemId).single();
  if (sErr) throw new Error(sErr.message);
  const { data, error } = await supabase.from("meal_plan_items")
    .insert({
      plan_id: planId, recipe_id: (src as { recipe_id: string }).recipe_id,
      day: opts.day, meal_slot: opts.mealSlot, leftover_of: sourceItemId,
    })
    .select("id,plan_id,recipe_id,day,meal_slot,position,servings,leftover_of").single();
  if (error) throw new Error(error.message);
  return data as MealPlanItem;
}
```

- [ ] **Step 3: Write the integration test**

```ts
test("a leftover contributes no ingredients to the grocery list", async () => {
  const u = await makeUser();
  const family = await u.createFamily("Leftover fam");
  const recipe = await u.createRecipe(family.id, {
    title: "Adobo", servings: 2,
    ingredients: [{ position: 0, quantity: "2", unit: "cup", item: "rice" }],
  });
  const plan = await u.createPlan(family.id, "Week");
  const dinner = await u.addRecipeToPlan(plan.id, recipe.id);
  await u.addLeftover(plan.id, dinner.id, { day: null, mealSlot: "lunch" });

  const lines = await u.getGroceryList(plan.id);
  const rice = lines.find((l) => l.key === "rice");
  expect(rice).toBeTruthy();
  expect(rice!.contributions).toHaveLength(1); // the pot, counted once
});
```

- [ ] **Step 4: Run it**

Run: `npm run test:int -- my_kitchen_week`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/mealPlans.ts tests/integration/my_kitchen_week.test.ts
git commit -m "feat: leftovers fill a slot without adding to the grocery list"
```

---

### Task 4: The servings nudge helper

**Files:**
- Create: `src/lib/leftovers.ts`
- Test: `src/lib/leftovers.test.ts`

**Interfaces:**
- Produces: `suggestedServings(base: number | null, leftoverCount: number): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { suggestedServings } from "./leftovers";

test("one leftover slot doubles the pot", () => {
  expect(suggestedServings(2, 1)).toBe(4);
});
test("two leftover slots triple it", () => {
  expect(suggestedServings(2, 2)).toBe(6);
});
test("no leftovers means no suggestion", () => {
  expect(suggestedServings(2, 0)).toBeNull();
});
test("no base to scale from means no suggestion, never a guess", () => {
  expect(suggestedServings(null, 1)).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/leftovers.test.ts`
Expected: FAIL, cannot resolve `./leftovers`.

- [ ] **Step 3: Implement**

```ts
// One cook event feeding several slots: each leftover slot needs another
// serving-count's worth of food. Returns null when there is nothing to
// suggest, so the UI shows no nudge rather than a made-up number.
export function suggestedServings(base: number | null, leftoverCount: number): number | null {
  if (base === null || base <= 0 || leftoverCount <= 0) return null;
  return base * (1 + leftoverCount);
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/lib/leftovers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/leftovers.ts src/lib/leftovers.test.ts
git commit -m "feat: suggest a pot size that covers the leftover slots"
```

---

### Task 5: The week grid

**Files:**
- Modify: `src/pages/MealPlanDetail.tsx`
- Modify: `src/index.css` (append a `week grid` section)
- Test: `src/pages/MealPlanDetail.test.tsx` (extend)

**Interfaces:**
- Consumes: `setPlanDates` (Task 2), `addLeftover` (Task 3), `suggestedServings` (Task 4), existing `addRecipe`, `moveItem`, `removeItem`, `setItemServings`.
- Produces: no new exports.

- [ ] **Step 1: Add the date range editor to the plan header**

A native date input plus a length select, no dependency:

```tsx
<div className="plan-dates">
  <label>
    Starts
    <input type="date" value={plan.start_date ?? ""}
      onChange={(e) => setPlanDates(plan.id, e.target.value || null, plan.length_days).then(refresh)} />
  </label>
  <label>
    Days
    <select value={plan.length_days}
      onChange={(e) => setPlanDates(plan.id, plan.start_date, Number(e.target.value)).then(refresh)}>
      {[3, 5, 7, 14].map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  </label>
</div>
```

- [ ] **Step 2: Build the grid from start_date**

Compute the columns as dates, then render slots as rows. Keep the existing flat list for undated plans:

```tsx
const days = plan.start_date
  ? Array.from({ length: plan.length_days }, (_, i) => {
      const d = new Date(`${plan.start_date}T00:00:00`);
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    })
  : [];
const cell = (day: string, slot: MealSlot) =>
  items.filter((it) => it.day === day && it.meal_slot === slot);
```

Render `calendar` view as the grid only when `days.length > 0`; otherwise fall through to the existing list view and show a one-line hint that the plan needs a start date.

- [ ] **Step 3: Empty cell adds, filled cell acts**

An empty cell is a button that sets `pendingCell` to `{ day, slot }` and opens the existing recipe picker; on pick, call `addRecipe(id, recipeId, { day, mealSlot })`. A filled cell renders the recipe title, the existing servings stepper, a Remove button, and a "Leftovers" button that calls `addLeftover` for the next day in the same slot, then shows the nudge from Step 4.

- [ ] **Step 4: Show the nudge, never apply it**

```tsx
{nudge && (
  <p className="nudge" role="status">
    {nudge.recipeTitle} is set to {nudge.current} servings. Bump to {nudge.suggested} to cover the leftovers?
    <button type="button" onClick={async () => {
      await setItemServings(nudge.itemId, nudge.suggested);
      setNudge(null); refresh();
    }}>Bump</button>
    <button type="button" onClick={() => setNudge(null)}>No</button>
  </p>
)}
```

Build `nudge` from `suggestedServings(item.servings ?? recipe.servings, leftoverCount)` right after `addLeftover` resolves, and skip it entirely when the helper returns null.

- [ ] **Step 5: Add the CSS**

Append to `src/index.css`, using existing tokens only:

```css
/* -------------------------------------------------------- week grid ------ */
.week-grid { display: grid; gap: 8px; overflow-x: auto; }
.week-grid .col-head {
  font-family: var(--sign); text-transform: uppercase; font-size: 0.75rem;
  letter-spacing: 0.06em; color: var(--on-wall-soft);
}
.week-cell {
  min-height: 62px; padding: 8px; border-radius: var(--radius-sm);
  background: var(--plate); color: var(--ink); border: 1.5px solid var(--rim);
}
.week-cell.empty { background: transparent; border-style: dashed; opacity: 0.7; }
.week-cell .leftover { font-size: 0.78rem; color: var(--ink-soft); }
.nudge { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
@media (max-width: 720px) { .week-grid { grid-auto-flow: row; } }
```

- [ ] **Step 6: Write the component test**

```tsx
test("a dated plan renders a cell per day and slot", async () => {
  // mock listPlans to return start_date "2026-09-21", length_days 3
  // mock listItems to return one dinner item on 2026-09-21
  render(<MealPlanDetail />, { wrapper });
  expect(await screen.findByText("Adobo")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /add to/i }).length).toBe(8); // 3 days x 3 slots minus the filled one
});
```

Follow the mocking style already used in `src/pages/MealPlanDetail.test.tsx`.

- [ ] **Step 7: Verify and commit**

Run: `npx tsc -b && npm test`

```bash
git add src/pages/MealPlanDetail.tsx src/pages/MealPlanDetail.test.tsx src/index.css
git commit -m "feat: a real week grid for dated plans, with leftovers and a servings nudge"
```

---

### Task 6: listUpcoming

**Files:**
- Modify: `src/lib/api/mealPlans.ts`
- Modify: `src/lib/api/types.ts` (add `UpcomingItem`)
- Test: `tests/integration/my_kitchen_week.test.ts` (append)

**Interfaces:**
- Produces:

```ts
export interface UpcomingItem {
  id: string; day: string; meal_slot: MealSlot | null; servings: number | null;
  recipe: { id: string; title: string; servings: number | null };
  plan: { id: string; name: string };
  isLeftover: boolean; readOnly: boolean;
}
export async function listUpcoming(days: number): Promise<UpcomingItem[]>
```

- [ ] **Step 1: Implement the query**

RLS already restricts `meal_plan_items` to plans you own or that are shared with your family, so no filter for ownership is needed or wanted here:

```ts
export async function listUpcoming(days: number): Promise<UpcomingItem[]> {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setDate(end.getDate() + days);

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("meal_plan_items")
    .select("id,day,meal_slot,servings,leftover_of,recipes(id,title,servings),meal_plans(id,name,owner_id)")
    .gte("day", iso(today)).lt("day", iso(end))
    .order("day");
  if (error) throw new Error(error.message);

  const SLOT_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2 };
  return (data ?? []).map((r: any) => ({
    id: r.id, day: r.day, meal_slot: r.meal_slot, servings: r.servings,
    recipe: r.recipes, plan: { id: r.meal_plans.id, name: r.meal_plans.name },
    isLeftover: r.leftover_of !== null,
    readOnly: r.meal_plans.owner_id !== user?.id,
  })).sort((a, b) =>
    a.day === b.day
      ? (SLOT_ORDER[a.meal_slot ?? ""] ?? 9) - (SLOT_ORDER[b.meal_slot ?? ""] ?? 9)
      : a.day < b.day ? -1 : 1);
}
```

- [ ] **Step 2: Write the integration test**

```ts
test("listUpcoming includes a shared family plan and marks it read-only", async () => {
  const owner = await makeUser();
  const family = await owner.createFamily("Shared fam");
  const member = await owner.inviteAndJoin(family); // use the existing join helper
  const recipe = await owner.createRecipe(family.id, { title: "Pasta bake", servings: 4 });
  const plan = await owner.createPlan(family.id, "Mum's week");
  await owner.setShared(plan.id, true);
  const today = new Date().toISOString().slice(0, 10);
  await owner.addRecipeToPlan(plan.id, recipe.id, { day: today, mealSlot: "dinner" });

  const rows = await member.listUpcoming(2);
  expect(rows).toHaveLength(1);
  expect(rows[0].plan.name).toBe("Mum's week");
  expect(rows[0].readOnly).toBe(true);
});
```

- [ ] **Step 3: Run it**

Run: `npm run test:int -- my_kitchen_week`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/mealPlans.ts src/lib/api/types.ts tests/integration/my_kitchen_week.test.ts
git commit -m "feat: list what is coming up across every readable plan"
```

---

### Task 7: Today / Up next on the My Kitchen landing

**Files:**
- Modify: `src/pages/MyKitchen.tsx`
- Modify: `src/index.css`
- Test: `src/pages/MyKitchen.test.tsx`

**Interfaces:**
- Consumes: `listUpcoming` (Task 6).

- [ ] **Step 1: Load and group by day**

```tsx
const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
useEffect(() => { listUpcoming(4).then(setUpcoming).catch(() => setUpcoming([])); }, []);

const byDay = new Map<string, UpcomingItem[]>();
for (const u of upcoming) byDay.set(u.day, [...(byDay.get(u.day) ?? []), u]);
```

- [ ] **Step 2: Render it above the plan list**

Each day gets a heading of "Today", "Tomorrow", or a weekday name, and each row shows the slot, recipe title, servings, the plan name, a `shared` chip when `readOnly`, a `leftovers` chip when `isLeftover`, and a Cook link to the existing cook route. Keep the plan list below, unchanged. When `upcoming` is empty, show one line: "Nothing planned yet." and a link to a plan.

- [ ] **Step 3: Add the CSS**

```css
/* --------------------------------------------------------- up next ------- */
.upnext { margin-bottom: 28px; }
.upnext h3 {
  font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--on-wall-soft); margin: 16px 0 6px;
}
.upnext .plate-row { align-items: baseline; }
.upnext .slot {
  font-family: var(--sign); text-transform: uppercase; font-size: 0.72rem;
  letter-spacing: 0.06em; color: var(--ink-soft); min-width: 74px;
}
```

- [ ] **Step 4: Write the test**

```tsx
test("shows today's dinner with its plan name and a cook link", async () => {
  // mock listUpcoming to resolve one item dated today
  render(<MyKitchen />, { wrapper });
  expect(await screen.findByText("Chicken adobo")).toBeTruthy();
  expect(screen.getByText(/Week of/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /cook/i })).toBeTruthy();
});
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -b && npm test`

```bash
git add src/pages/MyKitchen.tsx src/pages/MyKitchen.test.tsx src/index.css
git commit -m "feat: open My Kitchen on what is actually for dinner"
```

---

### Task 8: Duplicate a week

**Files:**
- Modify: `src/lib/api/mealPlans.ts`
- Modify: `src/pages/MealPlanDetail.tsx` (button)
- Test: `tests/integration/my_kitchen_week.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `duplicate_plan` RPC.
- Produces: `duplicatePlan(id: string, newStartDate: string): Promise<string>` returning the new plan id.

- [ ] **Step 1: Wrap the RPC**

```ts
export async function duplicatePlan(id: string, newStartDate: string): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_plan", { p_id: id, p_start: newStartDate });
  if (error) throw new Error(error.message);
  return data as string;
}
```

- [ ] **Step 2: Add the button**

Next to the date editor, "Duplicate to next week" computes `start_date + length_days` and navigates to the clone:

```tsx
<button type="button" onClick={async () => {
  if (!plan.start_date) return;
  const d = new Date(`${plan.start_date}T00:00:00`);
  d.setDate(d.getDate() + plan.length_days);
  const newId = await duplicatePlan(plan.id, d.toISOString().slice(0, 10));
  navigate(`/kitchen/${newId}`);
}} disabled={!plan.start_date}>Duplicate to next week</button>
```

- [ ] **Step 3: Write the integration test**

```ts
test("duplicate_plan clones items and shifts their days", async () => {
  const u = await makeUser();
  const family = await u.createFamily("Dup fam");
  const recipe = await u.createRecipe(family.id, { title: "Dal", servings: 2 });
  const plan = await u.createPlan(family.id, "Week 1");
  await u.setPlanDates(plan.id, "2026-09-21", 7);
  await u.addRecipeToPlan(plan.id, recipe.id, { day: "2026-09-22", mealSlot: "dinner" });

  const newId = await u.duplicatePlan(plan.id, "2026-09-28");
  const items = await u.listItems(newId);
  expect(items).toHaveLength(1);
  expect(items[0].day).toBe("2026-09-29"); // shifted by the same 7 days
});
```

- [ ] **Step 4: Run it**

Run: `npm run test:int -- my_kitchen_week`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/mealPlans.ts src/pages/MealPlanDetail.tsx tests/integration/my_kitchen_week.test.ts
git commit -m "feat: duplicate a planned week to the next one"
```

---

### Task 9: Pantry staples API and grocery flagging

**Files:**
- Create: `src/lib/api/staples.ts`
- Modify: `src/lib/api/grocery.ts` (`buildGroceryList` signature, `GroceryLine`)
- Modify: `src/lib/api/types.ts` (`GroceryLine.staple`)
- Modify: `src/lib/api/mealPlans.ts` (`getGroceryList` passes the staple set)
- Test: `src/lib/api/grocery.test.ts` (extend)

**Interfaces:**
- Produces: `listStaples(familyId): Promise<Staple[]>`, `addStaple(familyId, label): Promise<Staple>`, `removeStaple(id): Promise<void>`, where `Staple = { id: string; key: string; label: string }`; and `buildGroceryList(rows, manual, checkedKeys, staples?: Set<string>)`.

- [ ] **Step 1: Write the failing unit test**

```ts
test("a staple line is flagged, not dropped", () => {
  const rows = [{ recipeTitle: "Dal", quantity: "1", unit: "teaspoon", item: "salt", scaled: false }];
  const lines = buildGroceryList(rows, [], [], new Set(["salt"]));
  expect(lines).toHaveLength(1);
  expect(lines[0].staple).toBe(true);
});
test("lines that are not staples are untouched", () => {
  const rows = [{ recipeTitle: "Dal", quantity: "2", unit: "cup", item: "lentils", scaled: false }];
  expect(buildGroceryList(rows, [], [], new Set(["salt"]))[0].staple).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/api/grocery.test.ts`
Expected: FAIL, `staple` is undefined.

- [ ] **Step 3: Add the flag**

`GroceryLine` gains `staple: boolean`. `buildGroceryList` takes an optional fourth argument `staples: Set<string> = new Set()` and sets `staple: staples.has(key)` when it creates each line, and `false` for manual lines. Defaulting the parameter keeps every existing caller compiling.

- [ ] **Step 4: Write the staples API**

```ts
import { supabase } from "../supabaseClient";
import { normalizeItem } from "./normalizeItem";

export interface Staple { id: string; key: string; label: string }

export async function listStaples(familyId: string): Promise<Staple[]> {
  const { data, error } = await supabase.from("pantry_staples")
    .select("id,key,label").eq("family_id", familyId).order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as Staple[];
}

export async function addStaple(familyId: string, label: string): Promise<Staple> {
  // Store the normalized key so a staple typed as "all-purpose flour" also
  // suppresses a recipe line reading "flour". Same rule the grocery grouping uses.
  const { data, error } = await supabase.from("pantry_staples")
    .insert({ family_id: familyId, key: normalizeItem(label), label: label.trim() })
    .select("id,key,label").single();
  if (error) throw new Error(error.message);
  return data as Staple;
}

export async function removeStaple(id: string): Promise<void> {
  const { error } = await supabase.from("pantry_staples").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 5: Feed the set through getGroceryList**

`getGroceryList` reads the plan's `family_id` alongside `checked_items`, fetches that family's staples, and passes `new Set(staples.map((s) => s.key))` as the fourth argument to `buildGroceryList`.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc -b && npm test`

```bash
git add src/lib/api/staples.ts src/lib/api/grocery.ts src/lib/api/types.ts src/lib/api/mealPlans.ts src/lib/api/grocery.test.ts
git commit -m "feat: flag grocery lines the family always keeps in"
```

---

### Task 10: Staples in the grocery panel

**Files:**
- Modify: `src/components/GroceryPanel.tsx`
- Modify: `src/index.css`
- Test: `src/components/GroceryPanel.test.tsx`

**Interfaces:**
- Consumes: Task 9's `listStaples` / `addStaple` / `removeStaple` and `GroceryLine.staple`.

- [ ] **Step 1: Split the rendered lines**

```tsx
const shopping = lines.filter((l) => !l.staple);
const staples = lines.filter((l) => l.staple);
```

Render `shopping` exactly as today. Render `staples` under a `<details>` element titled "Check you have these (N)", which is collapsed by default and needs no JavaScript state.

- [ ] **Step 2: Add the staples editor**

A second `<details>` titled "Pantry staples" holding the family's staples as removable chips and one input that calls `addStaple` on submit, then reloads the list. Guard on `activeFamily` being present.

- [ ] **Step 3: Add the CSS**

```css
/* --------------------------------------------------------- staples ------- */
.staples { margin-top: 18px; }
.staples summary { cursor: pointer; font-family: var(--sign); color: var(--ink); }
.staples .chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.staples .chip button { padding: 0 4px; margin-left: 6px; border: 0; background: none; color: inherit; }
```

- [ ] **Step 4: Write the test**

```tsx
test("staple lines are hidden behind the check-you-have-these group", async () => {
  // mock getGroceryList to return one normal line and one { staple: true } line
  render(<GroceryPanel planId="p1" />, { wrapper });
  expect(await screen.findByText("lentils")).toBeTruthy();
  expect(screen.getByText(/check you have these/i)).toBeTruthy();
});
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -b && npm test`

```bash
git add src/components/GroceryPanel.tsx src/components/GroceryPanel.test.tsx src/index.css
git commit -m "feat: keep pantry staples out of the shopping half of the list"
```

---

### Task 11: Ship it

**Files:**
- Modify: `HANDOVER.md`, `PRODUCT.md`, `README.md`

- [ ] **Step 1: Full verification**

Run: `npx tsc -b && npm test`, then `npx supabase db reset`, then `npm run test:int`.
Expected: build clean, all unit tests pass, `0001..0012` apply, integration suite passes.

- [ ] **Step 2: Browser end to end**

Plan two dinners in a dated week, send one to the next day as leftovers, accept the bump, add "salt" as a staple, then open the grocery list. Confirm: the pot is counted once at the bumped servings, and salt sits under "check you have these" rather than in the shopping list.

- [ ] **Step 3: Push the database**

Run: `npx supabase db push`
Expected: `0012` applies to the cloud project. No edge function deploy is needed for this work.

- [ ] **Step 4: Update the docs**

`HANDOVER.md` gets a session-log entry and a current-status line naming migration `0012`. `PRODUCT.md`'s deferred list loses "My Kitchen Up next landing / week calendar" and gains an accurate note about what staples do and do not do. Do not claim anything the code does not do.

- [ ] **Step 5: Commit and push**

```bash
git add HANDOVER.md PRODUCT.md README.md
git commit -m "docs: record the My Kitchen week slice"
git push
```

---

## Self-Review

**Spec coverage:** dated plans (Tasks 1, 2, 5), week grid (5), leftovers column + exclusion + nudge (1, 3, 4, 5), merged up next (6, 7), duplicate (1, 8), pantry staples (1, 9, 10), rollout and docs (11). Every spec section maps to a task.

**Type consistency:** `MealPlan.start_date` / `length_days`, `MealPlanItem.leftover_of`, `UpcomingItem`, `Staple`, and `GroceryLine.staple` are each defined once and used with the same names and types thereafter. `buildGroceryList`'s new fourth parameter is optional, so Task 9 does not break Task 3's callers.

**Known risk:** the `leftover_of` remapping in `duplicate_plan` matches cloned rows by `(position, recipe_id, meal_slot)`, which is only unique because `meal_plan_items` already carries `unique (plan_id, recipe_id, day, meal_slot)`. If Task 1's integration test shows a leftover pointing at the wrong clone, replace the correlated subquery with a temporary `old_id -> new_id` mapping table inside the function rather than patching the join.
