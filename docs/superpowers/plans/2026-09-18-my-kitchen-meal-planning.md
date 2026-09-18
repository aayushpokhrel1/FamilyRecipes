# My Kitchen (Meal Planning + Grocery List) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal "My Kitchen" space where a member picks recipes from the family vault into named plans and gets a consolidated, checkable grocery list; plans are private by default and shareable read-only with the family.

**Architecture:** Two new tables + one column (`meal_plans`, `meal_plan_items`, `meal_plan_manual_items`) with RLS mirroring the existing recipe model. All Supabase access goes in a new `src/lib/api/mealPlans.ts`. The grocery list is derived at read time by grouping recipe ingredients on a normalized-name key (a pure, unit-tested function). UI is a new routed tab reusing the existing recipe browse for its picker.

**Tech Stack:** React 19 + react-router-dom 7, Supabase (Postgres + RLS), TypeScript (`tsc -b`), Vitest + @testing-library/react, migrations in `supabase/migrations/`.

**Spec:** `docs/superpowers/specs/2026-09-18-my-kitchen-meal-planning-design.md`

## Global Constraints

- **Data-access boundary:** nothing outside `src/lib/api/` may import `supabaseClient`. All DB access for this feature lives in `src/lib/api/mealPlans.ts`.
- **Verify command:** `npx tsc -b && npm test` (NOT `tsc --noEmit`). Unit tests run via `npm test` (`vitest run src`). Integration tests run via `npm run test:int` (needs Docker + local Supabase) after `npx supabase db reset`.
- **Migrations are append-only and immutable once pushed:** new file `0008_meal_plans.sql`. Use `gen_random_uuid()` for ids (as `0003` does). `is_family_member(uuid)` already exists (from `0002`).
- **Never `db reset --linked`** (real cloud data). Local `npx supabase db reset` is fine.
- **No em/en dashes** in any code, comment, or commit message. Use commas, colons, parentheses, or two sentences.
- **Grocery list is derived, never stored.** Only check state (`checked_items text[]`) and manual lines are persisted.

---

### Task 1: Migration 0008 (tables + RLS)

**Files:**
- Create: `supabase/migrations/0008_meal_plans.sql`

**Interfaces:**
- Produces (DB): tables `meal_plans`, `meal_plan_items`, `meal_plan_manual_items`; SQL function `can_read_plan(uuid) returns boolean`.
- `meal_plans` columns: `id, owner_id, family_id, name, view_mode, is_shared, checked_items, created_at, updated_at`.
- `meal_plan_items` columns: `id, plan_id, recipe_id, day, meal_slot, position`.
- `meal_plan_manual_items` columns: `id, plan_id, label, position`.

- [ ] **Step 1: Write the migration**

```sql
-- My Kitchen: personal meal plans + derived grocery list.
create table meal_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  view_mode text not null default 'list' check (view_mode in ('list','calendar')),
  is_shared boolean not null default false,
  checked_items text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table meal_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references meal_plans(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  day date,
  meal_slot text check (meal_slot in ('breakfast','lunch','dinner')),
  position int not null default 0,
  unique (plan_id, recipe_id, day, meal_slot)
);
create table meal_plan_manual_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references meal_plans(id) on delete cascade,
  label text not null,
  position int not null default 0
);

-- readability predicate reused by the child tables' select policies
create function can_read_plan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from meal_plans p where p.id = pid and (
    p.owner_id = auth.uid()
    or (p.is_shared and is_family_member(p.family_id))
  ));
$$;

alter table meal_plans enable row level security;
alter table meal_plan_items enable row level security;
alter table meal_plan_manual_items enable row level security;

-- plans: owner sees own; family members see shared ones. Owner-only writes.
-- insert sets owner_id = auth.uid(), so the insert().select() RETURNING passes
-- the select policy (no 0007-style creator-read bug here).
create policy plans_read on meal_plans for select using (
  owner_id = auth.uid() or (is_shared and is_family_member(family_id)));
create policy plans_insert on meal_plans for insert with check (
  owner_id = auth.uid() and is_family_member(family_id));
create policy plans_update on meal_plans for update using (owner_id = auth.uid());
create policy plans_delete on meal_plans for delete using (owner_id = auth.uid());

-- child rows: readable if parent readable; writable only by the plan owner
create policy plan_items_read on meal_plan_items for select using (can_read_plan(plan_id));
create policy plan_items_write on meal_plan_items for all using (
  exists (select 1 from meal_plans p where p.id = plan_id and p.owner_id = auth.uid()))
  with check (
  exists (select 1 from meal_plans p where p.id = plan_id and p.owner_id = auth.uid()));

create policy manual_items_read on meal_plan_manual_items for select using (can_read_plan(plan_id));
create policy manual_items_write on meal_plan_manual_items for all using (
  exists (select 1 from meal_plans p where p.id = plan_id and p.owner_id = auth.uid()))
  with check (
  exists (select 1 from meal_plans p where p.id = plan_id and p.owner_id = auth.uid()));
```

- [ ] **Step 2: Apply it locally to verify it is valid**

Run: `npx supabase db reset`
Expected: reset completes with no error and applies migrations `0001..0008`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_meal_plans.sql
git commit -m "feat(db): meal_plans tables + RLS for My Kitchen"
```

---

### Task 2: Types + `normalizeItem`

**Files:**
- Modify: `src/lib/api/types.ts` (append)
- Create: `src/lib/api/normalizeItem.ts`
- Test: `src/lib/api/normalizeItem.test.ts`

**Interfaces:**
- Produces: the types below, and `normalizeItem(item: string): string`.

- [ ] **Step 1: Append the types to `src/lib/api/types.ts`**

```ts
export type MealPlanViewMode = "list" | "calendar";
export type MealSlot = "breakfast" | "lunch" | "dinner";
export interface MealPlan {
  id: string; owner_id: string; family_id: string; name: string;
  view_mode: MealPlanViewMode; is_shared: boolean; checked_items: string[];
  created_at: string; updated_at: string;
}
export interface MealPlanItem {
  id: string; plan_id: string; recipe_id: string;
  day: string | null; meal_slot: MealSlot | null; position: number;
}
export interface ManualItem { id: string; label: string; position: number; }
export interface GroceryContribution { quantity: string | null; unit: string | null; recipeTitle: string; }
export interface GroceryLine {
  key: string; name: string; contributions: GroceryContribution[];
  checked: boolean; manual: boolean;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/api/normalizeItem.test.ts
import { test, expect } from "vitest";
import { normalizeItem } from "./normalizeItem";

test("lowercases, trims, and collapses whitespace", () => {
  expect(normalizeItem("  Flour ")).toBe("flour");
  expect(normalizeItem("all   purpose FLOUR")).toBe("all purpose flour");
});
test("drops a trailing descriptor after a comma", () => {
  expect(normalizeItem("flour, sifted")).toBe("flour");
});
test("strips common prep/quality words", () => {
  expect(normalizeItem("chopped onions")).toBe("onion");
  expect(normalizeItem("fresh diced tomatoes")).toBe("tomato");
});
test("naive singularize on the last word", () => {
  expect(normalizeItem("eggs")).toBe("egg");
  expect(normalizeItem("tomatoes")).toBe("tomato");
  expect(normalizeItem("berries")).toBe("berry");
  expect(normalizeItem("green onions")).toBe("green onion");
});
test("does not over-strip a two-letter word or double-s", () => {
  expect(normalizeItem("glass")).toBe("glass");
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run src/lib/api/normalizeItem.test.ts`
Expected: FAIL (module not found / normalizeItem is not a function).

- [ ] **Step 4: Implement `src/lib/api/normalizeItem.ts`**

```ts
// Grouping key for the grocery list. Cheap normalization that merges the common
// cases (casing, whitespace, a trailing descriptor, common prep words, plurals).
// ponytail: naive heuristics only; synonym/LLM canonicalization is a deferred
// roadmap item (see the design doc). This function is the single upgrade seam.
const PREP_WORDS = new Set([
  "chopped", "diced", "minced", "sliced", "ground", "grated", "shredded",
  "crushed", "peeled", "fresh", "dried", "frozen", "canned", "cooked", "raw",
  "large", "small", "medium", "ripe", "boneless", "skinless",
]);

function singularizeWord(w: string): string {
  if (w.endsWith("ies") && w.length > 3) return w.slice(0, -3) + "y";
  if (/(oes|ses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) return w.slice(0, -1);
  return w;
}

export function normalizeItem(item: string): string {
  let s = item.toLowerCase().split(",")[0];
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w && !PREP_WORDS.has(w));
  if (words.length) words[words.length - 1] = singularizeWord(words[words.length - 1]);
  return words.join(" ").trim();
}
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `npx vitest run src/lib/api/normalizeItem.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/types.ts src/lib/api/normalizeItem.ts src/lib/api/normalizeItem.test.ts
git commit -m "feat: meal-plan types and normalizeItem grouping key"
```

---

### Task 3: `buildGroceryList` (pure grouping)

**Files:**
- Create: `src/lib/api/grocery.ts`
- Test: `src/lib/api/grocery.test.ts`

**Interfaces:**
- Consumes: `normalizeItem` (Task 2); types `GroceryLine`, `GroceryContribution` (Task 2).
- Produces:
  - `interface IngredientRow { recipeTitle: string; quantity: string | null; unit: string | null; item: string; }`
  - `buildGroceryList(rows: IngredientRow[], manual: { id: string; label: string }[], checkedKeys: string[]): GroceryLine[]`
- Contract: derived lines are grouped by `normalizeItem(item)`; display `name` is the first original `item` seen for that key; `contributions` preserves each source row's quantity/unit/recipeTitle. Manual lines follow, keyed `manual:<id>`. A line's `checked` is true when its key is in `checkedKeys`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/api/grocery.test.ts
import { test, expect } from "vitest";
import { buildGroceryList } from "./grocery";

test("groups the same ingredient across recipes into one line", () => {
  const lines = buildGroceryList(
    [
      { recipeTitle: "Bread", quantity: "2", unit: "cups", item: "Flour" },
      { recipeTitle: "Pancakes", quantity: "1", unit: "cup", item: "flour" },
      { recipeTitle: "Pancakes", quantity: "3", unit: null, item: "eggs" },
    ],
    [],
    [],
  );
  const flour = lines.find((l) => l.key === "flour")!;
  expect(flour.name).toBe("Flour");
  expect(flour.contributions).toHaveLength(2);
  expect(lines.map((l) => l.key)).toEqual(["flour", "egg"]);
});

test("marks checked lines and appends manual items", () => {
  const lines = buildGroceryList(
    [{ recipeTitle: "Bread", quantity: "2", unit: "cups", item: "Flour" }],
    [{ id: "m1", label: "Aluminium foil" }],
    ["flour"],
  );
  expect(lines.find((l) => l.key === "flour")!.checked).toBe(true);
  const manual = lines.find((l) => l.key === "manual:m1")!;
  expect(manual.manual).toBe(true);
  expect(manual.name).toBe("Aluminium foil");
  expect(manual.contributions).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/api/grocery.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/api/grocery.ts`**

```ts
import { normalizeItem } from "./normalizeItem";
import type { GroceryLine, GroceryContribution } from "./types";

export interface IngredientRow {
  recipeTitle: string; quantity: string | null; unit: string | null; item: string;
}

// Callers pass ingredient rows already de-duped at recipe level (a recipe placed
// in several slots contributes its ingredients once). Quantities are shown
// as-is, never summed.
export function buildGroceryList(
  rows: IngredientRow[],
  manual: { id: string; label: string }[],
  checkedKeys: string[],
): GroceryLine[] {
  const checked = new Set(checkedKeys);
  const order: string[] = [];
  const byKey = new Map<string, GroceryLine>();

  for (const r of rows) {
    const key = normalizeItem(r.item);
    if (!key) continue;
    let line = byKey.get(key);
    if (!line) {
      line = { key, name: r.item, contributions: [], checked: checked.has(key), manual: false };
      byKey.set(key, line);
      order.push(key);
    }
    const c: GroceryContribution = { quantity: r.quantity, unit: r.unit, recipeTitle: r.recipeTitle };
    line.contributions.push(c);
  }

  const lines = order.map((k) => byKey.get(k)!);
  for (const m of manual) {
    const key = `manual:${m.id}`;
    lines.push({ key, name: m.label, contributions: [], checked: checked.has(key), manual: true });
  }
  return lines;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/lib/api/grocery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/grocery.ts src/lib/api/grocery.test.ts
git commit -m "feat: buildGroceryList groups ingredients by normalized key"
```

---

### Task 4: `mealPlans` API module

**Files:**
- Create: `src/lib/api/mealPlans.ts`
- Test: `src/lib/api/mealPlans.test.ts`

**Interfaces:**
- Consumes: `supabase` client; `buildGroceryList` + `IngredientRow` (Task 3); types (Task 2).
- Produces (all `async`):
  - `listPlans(): Promise<MealPlan[]>`
  - `createPlan(familyId: string, name: string): Promise<MealPlan>`
  - `renamePlan(id: string, name: string): Promise<void>`
  - `setViewMode(id: string, mode: MealPlanViewMode): Promise<void>`
  - `setShared(id: string, isShared: boolean): Promise<void>`
  - `deletePlan(id: string): Promise<void>`
  - `listItems(planId: string): Promise<MealPlanItem[]>`
  - `addRecipe(planId: string, recipeId: string, opts?: { day?: string | null; mealSlot?: MealSlot | null }): Promise<MealPlanItem>`
  - `removeItem(itemId: string): Promise<void>`
  - `moveItem(itemId: string, patch: { day?: string | null; mealSlot?: MealSlot | null; position?: number }): Promise<void>`
  - `listManualItems(planId: string): Promise<ManualItem[]>`
  - `addManualItem(planId: string, label: string): Promise<ManualItem>`
  - `removeManualItem(id: string): Promise<void>`
  - `toggleChecked(planId: string, key: string, checked: boolean): Promise<void>`
  - `getGroceryList(planId: string): Promise<GroceryLine[]>`

- [ ] **Step 1: Write the failing test** (mirrors `recipes.test.ts` mocking style)

```ts
// src/lib/api/mealPlans.test.ts
import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { createPlan, toggleChecked } from "./mealPlans";

test("createPlan inserts with owner_id from the session", async () => {
  let payload: any;
  from.mockImplementation(() => ({
    insert: (p: any) => { payload = p; return { select: () => ({ single: () => ({ data: { id: "p1", ...p }, error: null }) }) }; },
  }));
  const plan = await createPlan("f1", "This week");
  expect(payload).toMatchObject({ owner_id: "me", family_id: "f1", name: "This week" });
  expect(plan.id).toBe("p1");
});

test("toggleChecked adds a key to checked_items", async () => {
  let updated: any;
  from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: () => ({ data: { checked_items: [] }, error: null }) }) }),
    update: (u: any) => { updated = u; return { eq: () => ({ error: null }) }; },
  }));
  await toggleChecked("p1", "flour", true);
  expect(updated.checked_items).toEqual(["flour"]);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/api/mealPlans.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/api/mealPlans.ts`**

```ts
import { supabase } from "../supabaseClient";
import { buildGroceryList, type IngredientRow } from "./grocery";
import type { MealPlan, MealPlanItem, ManualItem, MealPlanViewMode, MealSlot, GroceryLine } from "./types";

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

// RLS returns the caller's own plans plus any shared to their families.
export async function listPlans(): Promise<MealPlan[]> {
  const { data, error } = await supabase.from("meal_plans").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MealPlan[];
}

export async function createPlan(familyId: string, name: string): Promise<MealPlan> {
  const uid = await myId();
  const { data, error } = await supabase.from("meal_plans")
    .insert({ owner_id: uid, family_id: familyId, name }).select().single();
  if (error) throw new Error(error.message);
  return data as MealPlan;
}

export async function renamePlan(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("meal_plans").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function setViewMode(id: string, mode: MealPlanViewMode): Promise<void> {
  const { error } = await supabase.from("meal_plans").update({ view_mode: mode }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function setShared(id: string, isShared: boolean): Promise<void> {
  const { error } = await supabase.from("meal_plans").update({ is_shared: isShared }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase.from("meal_plans").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listItems(planId: string): Promise<MealPlanItem[]> {
  const { data, error } = await supabase.from("meal_plan_items").select("*").eq("plan_id", planId).order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as MealPlanItem[];
}

export async function addRecipe(
  planId: string, recipeId: string, opts: { day?: string | null; mealSlot?: MealSlot | null } = {},
): Promise<MealPlanItem> {
  const { count } = await supabase.from("meal_plan_items")
    .select("*", { count: "exact", head: true }).eq("plan_id", planId);
  const { data, error } = await supabase.from("meal_plan_items").insert({
    plan_id: planId, recipe_id: recipeId,
    day: opts.day ?? null, meal_slot: opts.mealSlot ?? null, position: count ?? 0,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as MealPlanItem;
}

export async function removeItem(itemId: string): Promise<void> {
  const { error } = await supabase.from("meal_plan_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function moveItem(
  itemId: string, patch: { day?: string | null; mealSlot?: MealSlot | null; position?: number },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.day !== undefined) row.day = patch.day;
  if (patch.mealSlot !== undefined) row.meal_slot = patch.mealSlot;
  if (patch.position !== undefined) row.position = patch.position;
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from("meal_plan_items").update(row).eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function listManualItems(planId: string): Promise<ManualItem[]> {
  const { data, error } = await supabase.from("meal_plan_manual_items").select("*").eq("plan_id", planId).order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualItem[];
}
export async function addManualItem(planId: string, label: string): Promise<ManualItem> {
  const { count } = await supabase.from("meal_plan_manual_items")
    .select("*", { count: "exact", head: true }).eq("plan_id", planId);
  const { data, error } = await supabase.from("meal_plan_manual_items")
    .insert({ plan_id: planId, label, position: count ?? 0 }).select().single();
  if (error) throw new Error(error.message);
  return data as ManualItem;
}
export async function removeManualItem(id: string): Promise<void> {
  const { error } = await supabase.from("meal_plan_manual_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ponytail: read-modify-write of the checked_items array; last-write-wins is
// fine for a single owner ticking their own list. A per-key table only if
// multiple devices ever edit one plan concurrently.
export async function toggleChecked(planId: string, key: string, checked: boolean): Promise<void> {
  const { data: plan, error } = await supabase.from("meal_plans").select("checked_items").eq("id", planId).single();
  if (error) throw new Error(error.message);
  const set = new Set<string>((plan?.checked_items ?? []) as string[]);
  if (checked) set.add(key); else set.delete(key);
  const { error: uErr } = await supabase.from("meal_plans").update({ checked_items: Array.from(set) }).eq("id", planId);
  if (uErr) throw new Error(uErr.message);
}

// Derived at read time: gather ingredients from the plan's DISTINCT recipes,
// then group by normalized name. Never stored.
export async function getGroceryList(planId: string): Promise<GroceryLine[]> {
  const [{ data: plan, error: pErr }, { data: items, error: iErr }, { data: manual, error: mErr }] = await Promise.all([
    supabase.from("meal_plans").select("checked_items").eq("id", planId).single(),
    supabase.from("meal_plan_items").select("recipe_id").eq("plan_id", planId),
    supabase.from("meal_plan_manual_items").select("id,label").eq("plan_id", planId).order("position"),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (iErr) throw new Error(iErr.message);
  if (mErr) throw new Error(mErr.message);

  const recipeIds = Array.from(new Set((items ?? []).map((r: any) => r.recipe_id)));
  let rows: IngredientRow[] = [];
  if (recipeIds.length) {
    const [{ data: recipes }, { data: ings }] = await Promise.all([
      supabase.from("recipes").select("id,title").in("id", recipeIds),
      supabase.from("recipe_ingredients").select("recipe_id,quantity,unit,item").in("recipe_id", recipeIds),
    ]);
    const titleById = new Map((recipes ?? []).map((r: any) => [r.id, r.title]));
    rows = (ings ?? []).map((g: any) => ({
      recipeTitle: titleById.get(g.recipe_id) ?? "", quantity: g.quantity, unit: g.unit, item: g.item,
    }));
  }
  const manualList = ((manual ?? []) as any[]).map((m) => ({ id: m.id, label: m.label }));
  return buildGroceryList(rows, manualList, ((plan?.checked_items ?? []) as string[]));
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/lib/api/mealPlans.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/mealPlans.ts src/lib/api/mealPlans.test.ts
git commit -m "feat: mealPlans api module (CRUD, items, grocery, check state)"
```

---

### Task 5: Integration test for the shared-vs-private RLS boundary

**Files:**
- Create: `tests/integration/meal_plans.test.ts`

**Interfaces:**
- Consumes: `admin`, `makeUser` from `tests/integration/helpers.ts`; the `0008` schema (Task 1). Requires a running local Supabase (`npx supabase db reset` first).

- [ ] **Step 1: Write the test**

```ts
// @vitest-environment node
// A shared plan is readable by a family member but never editable by them; an
// un-shared plan is invisible to family members. This is the exact RLS class
// that bit v1 (family creation), so it gets explicit coverage.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

async function famWith(owner: { id: string }, member?: { id: string }) {
  const { data: fam } = await admin.from("families").insert({ name: `Fam${Date.now()}`, created_by: owner.id }).select().single();
  await admin.from("family_members").insert({ family_id: fam!.id, user_id: owner.id, role: "owner" });
  if (member) await admin.from("family_members").insert({ family_id: fam!.id, user_id: member.id, role: "member" });
  return fam!;
}

test("family member can read a shared plan but not edit it; cannot see an unshared one", async () => {
  const alice = await makeUser(`mpa${Date.now()}@t.dev`);
  const bob = await makeUser(`mpb${Date.now()}@t.dev`);
  const fam = await famWith(alice, bob);

  // alice creates a private plan and a shared plan (as herself, through RLS)
  const { data: priv } = await alice.client.from("meal_plans")
    .insert({ owner_id: alice.id, family_id: fam.id, name: "Private" }).select().single();
  const { data: shared } = await alice.client.from("meal_plans")
    .insert({ owner_id: alice.id, family_id: fam.id, name: "Shared", is_shared: true }).select().single();

  // bob sees only the shared plan
  const bobPriv = await bob.client.from("meal_plans").select("id").eq("id", priv!.id);
  expect(bobPriv.data).toHaveLength(0);
  const bobShared = await bob.client.from("meal_plans").select("id").eq("id", shared!.id);
  expect(bobShared.data).toHaveLength(1);

  // bob cannot edit the shared plan (owner-only update)
  const bobEdit = await bob.client.from("meal_plans").update({ name: "Hacked" }).eq("id", shared!.id).select();
  expect(bobEdit.data ?? []).toHaveLength(0);
  const stillNamed = await alice.client.from("meal_plans").select("name").eq("id", shared!.id).single();
  expect(stillNamed.data!.name).toBe("Shared");
});
```

- [ ] **Step 2: Run it (needs Docker + local Supabase, schema applied)**

Run: `npx supabase db reset && npm run test:int`
Expected: PASS (the meal_plans test plus the existing suite stay green).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/meal_plans.test.ts
git commit -m "test(int): meal_plans shared-vs-private RLS boundary"
```

---

### Task 6: My Kitchen page (plans list) + route + nav

**Files:**
- Create: `src/pages/MyKitchen.tsx`
- Modify: `src/routes.tsx` (add import + route)
- Modify: `src/components/AppLayout.tsx` (add nav link)
- Test: `src/pages/MyKitchen.test.tsx`

**Interfaces:**
- Consumes: `useFamily` (context); `listPlans`, `createPlan`, `renamePlan`, `deletePlan`, `setShared` (Task 4); type `MealPlan`.
- Produces: default-exported `MyKitchen` component; route `path="kitchen"`; a plan links to `/kitchen/:id`.

- [ ] **Step 1: Add the route to `src/routes.tsx`**

Add the import near the other page imports:
```tsx
import MyKitchen from "./pages/MyKitchen";
import MealPlanDetail from "./pages/MealPlanDetail";
```
Add these routes inside the authed `<Route>` block (alongside the recipe routes):
```tsx
        <Route path="kitchen" element={<MyKitchen />} />
        <Route path="kitchen/:id" element={<MealPlanDetail />} />
```

- [ ] **Step 2: Add the nav link in `src/components/AppLayout.tsx`**

In the `<nav>` block, after the Recipes link:
```tsx
          <Link to="/kitchen">My Kitchen</Link>
```

- [ ] **Step 3: Write the failing test**

```tsx
// src/pages/MyKitchen.test.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import MyKitchen from "./MyKitchen";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "u" } }),
}));
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([]),
  createPlan: vi.fn(), renamePlan: vi.fn(), deletePlan: vi.fn(), setShared: vi.fn(),
}));

test("renders the My Kitchen heading and a create control", async () => {
  render(<MemoryRouter><MyKitchen /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: /my kitchen/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /new plan/i })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npx vitest run src/pages/MyKitchen.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `src/pages/MyKitchen.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listPlans, createPlan, deletePlan, setShared } from "../lib/api/mealPlans";
import type { MealPlan } from "../lib/api/types";

export default function MyKitchen() {
  const { activeFamily } = useFamily();
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try { setPlans(await listPlans()); } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function handleCreate() {
    if (!activeFamily || !name.trim()) return;
    await createPlan(activeFamily.id, name.trim());
    setName("");
    reload();
  }
  async function handleDelete(id: string) {
    await deletePlan(id);
    reload();
  }
  async function handleShare(p: MealPlan) {
    await setShared(p.id, !p.is_shared);
    reload();
  }

  return (
    <div>
      <h1>My Kitchen</h1>
      {!activeFamily && (
        <p>Create or join a family first. <Link to="/families">Families</Link></p>
      )}
      <div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name" />
        <button type="button" onClick={handleCreate} disabled={!activeFamily}>New plan</button>
      </div>
      {loading && <p>Loading...</p>}
      {!loading && plans.length === 0 && <p>No plans yet.</p>}
      <ul>
        {plans.map((p) => (
          <li key={p.id}>
            <Link to={`/kitchen/${p.id}`}>{p.name}</Link>
            <button type="button" onClick={() => handleShare(p)}>
              {p.is_shared ? "Shared (make private)" : "Share with family"}
            </button>
            <button type="button" onClick={() => handleDelete(p.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx vitest run src/pages/MyKitchen.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/MyKitchen.tsx src/pages/MyKitchen.test.tsx src/routes.tsx src/components/AppLayout.tsx
git commit -m "feat: My Kitchen page, route, and nav link"
```

---

### Task 7: Meal plan detail (list/calendar view + add-recipe picker)

**Files:**
- Create: `src/pages/MealPlanDetail.tsx`
- Test: `src/pages/MealPlanDetail.test.tsx`

**Interfaces:**
- Consumes: `useParams` (router); `useFamily`; `listPlans`, `listItems`, `addRecipe`, `removeItem`, `setViewMode` (Task 4); `listRecipes` from `../lib/api/recipes`; types `MealPlan`, `MealPlanItem`, `Recipe`.
- Produces: default-exported `MealPlanDetail`. Renders a `list` or `calendar` view driven by `plan.view_mode`, a view toggle, an "Add recipes from vault" picker, and mounts `<GroceryPanel planId={id} isOwner={...} />` (Task 8).
- Note: `GroceryPanel` is created in Task 8; import it now, its test mocks it if needed. Implement the plan view here; the grocery import resolves once Task 8 lands (do Task 7 and 8 in order).

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/MealPlanDetail.test.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import MealPlanDetail from "./MealPlanDetail";

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: { id: "f1", name: "F", invite_code: "x", created_by: "me" } }),
}));
vi.mock("../lib/api/mealPlans", () => ({
  listPlans: vi.fn().mockResolvedValue([{ id: "p1", owner_id: "me", family_id: "f1", name: "This week", view_mode: "list", is_shared: false, checked_items: [], created_at: "", updated_at: "" }]),
  listItems: vi.fn().mockResolvedValue([]),
  addRecipe: vi.fn(), removeItem: vi.fn(), setViewMode: vi.fn(),
}));
vi.mock("../lib/api/recipes", () => ({ listRecipes: vi.fn().mockResolvedValue([]) }));
vi.mock("../components/GroceryPanel", () => ({ default: () => <div>grocery</div> }));

test("shows the plan name and a view toggle", async () => {
  render(
    <MemoryRouter initialEntries={["/kitchen/p1"]}>
      <Routes><Route path="/kitchen/:id" element={<MealPlanDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: /this week/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /calendar view|list view/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/pages/MealPlanDetail.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/pages/MealPlanDetail.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listPlans, listItems, addRecipe, removeItem, setViewMode } from "../lib/api/mealPlans";
import { listRecipes } from "../lib/api/recipes";
import type { MealPlan, MealPlanItem, MealSlot, Recipe } from "../lib/api/types";
import GroceryPanel from "../components/GroceryPanel";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];

export default function MealPlanDetail() {
  const { id } = useParams();
  const { activeFamily } = useFamily();
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [items, setItems] = useState<MealPlanItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [pick, setPick] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    listPlans().then((all) => setPlan(all.find((p) => p.id === id) ?? null));
    listItems(id).then(setItems);
  }, [id, reloadKey]);
  useEffect(() => {
    if (activeFamily) listRecipes(activeFamily.id).then(setRecipes).catch(() => setRecipes([]));
  }, [activeFamily]);

  const titleById = new Map(recipes.map((r) => [r.id, r.title]));
  function refresh() { setReloadKey((k) => k + 1); }

  async function handleAdd() {
    if (!id || !pick) return;
    await addRecipe(id, pick);
    setPick("");
    refresh();
  }
  async function handleToggleView() {
    if (!plan) return;
    await setViewMode(plan.id, plan.view_mode === "list" ? "calendar" : "list");
    refresh();
  }

  if (!plan) return <p>Loading...</p>;

  return (
    <div>
      <h1>{plan.name}</h1>
      <button type="button" onClick={handleToggleView}>
        {plan.view_mode === "list" ? "Calendar view" : "List view"}
      </button>

      {plan.view_mode === "list" ? (
        <ul>
          {items.map((it) => (
            <li key={it.id}>
              {titleById.get(it.recipe_id) ?? it.recipe_id}
              <button type="button" onClick={async () => { await removeItem(it.id); refresh(); }}>Remove</button>
            </li>
          ))}
          {items.length === 0 && <li>No recipes picked yet.</li>}
        </ul>
      ) : (
        <div>
          {SLOTS.map((slot) => (
            <section key={slot}>
              <h3>{slot}</h3>
              <ul>
                {items.filter((it) => it.meal_slot === slot).map((it) => (
                  <li key={it.id}>{titleById.get(it.recipe_id) ?? it.recipe_id}</li>
                ))}
              </ul>
            </section>
          ))}
          <section>
            <h3>Unscheduled</h3>
            <ul>
              {items.filter((it) => !it.meal_slot).map((it) => (
                <li key={it.id}>{titleById.get(it.recipe_id) ?? it.recipe_id}</li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <div>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a recipe from the vault...</option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <button type="button" onClick={handleAdd} disabled={!pick}>Add recipe</button>
      </div>

      <GroceryPanel planId={plan.id} />
    </div>
  );
}
```

Note: owner-only editing is enforced by RLS (writes fail for non-owners). The
UI keeps controls visible for simplicity in v1; a non-owner viewing a shared
plan simply cannot mutate it. If you want to hide controls for non-owners, gate
them on `plan.owner_id === <current user id>` using the session id (out of scope
for this task; the RLS test in Task 5 is the real guarantee).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/pages/MealPlanDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MealPlanDetail.tsx src/pages/MealPlanDetail.test.tsx
git commit -m "feat: meal plan detail with list/calendar views and recipe picker"
```

---

### Task 8: Grocery panel (grouped list, checkboxes, manual lines)

**Files:**
- Create: `src/components/GroceryPanel.tsx`
- Test: `src/components/GroceryPanel.test.tsx`

**Interfaces:**
- Consumes: `getGroceryList`, `toggleChecked`, `listManualItems`, `addManualItem`, `removeManualItem` (Task 4); type `GroceryLine`.
- Produces: default-exported `GroceryPanel({ planId }: { planId: string })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/GroceryPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import GroceryPanel from "./GroceryPanel";

vi.mock("../lib/api/mealPlans", () => ({
  getGroceryList: vi.fn().mockResolvedValue([
    { key: "flour", name: "Flour", contributions: [{ quantity: "2", unit: "cups", recipeTitle: "Bread" }], checked: false, manual: false },
  ]),
  toggleChecked: vi.fn(),
  addManualItem: vi.fn(),
  removeManualItem: vi.fn(),
}));

test("renders a grocery line with its source recipe", async () => {
  render(<GroceryPanel planId="p1" />);
  expect(await screen.findByText(/Flour/)).toBeInTheDocument();
  expect(screen.getByText(/Bread/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/components/GroceryPanel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/GroceryPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getGroceryList, toggleChecked, addManualItem, removeManualItem } from "../lib/api/mealPlans";
import type { GroceryLine } from "../lib/api/types";

function contribLabel(c: { quantity: string | null; unit: string | null; recipeTitle: string }): string {
  const qty = [c.quantity, c.unit].filter(Boolean).join(" ").trim();
  return qty ? `${qty} (${c.recipeTitle})` : `(${c.recipeTitle})`;
}

export default function GroceryPanel({ planId }: { planId: string }) {
  const [lines, setLines] = useState<GroceryLine[]>([]);
  const [label, setLabel] = useState("");

  async function reload() { setLines(await getGroceryList(planId)); }
  useEffect(() => { reload(); }, [planId]);

  async function handleToggle(line: GroceryLine) {
    await toggleChecked(planId, line.key, !line.checked);
    reload();
  }
  async function handleAddManual() {
    if (!label.trim()) return;
    await addManualItem(planId, label.trim());
    setLabel("");
    reload();
  }
  async function handleRemoveManual(line: GroceryLine) {
    await removeManualItem(line.key.replace(/^manual:/, ""));
    reload();
  }

  return (
    <section>
      <h2>Grocery list</h2>
      {lines.length === 0 && <p>Pick recipes to build a grocery list.</p>}
      <ul>
        {lines.map((line) => (
          <li key={line.key}>
            <label>
              <input type="checkbox" checked={line.checked} onChange={() => handleToggle(line)} />
              <span style={{ textDecoration: line.checked ? "line-through" : "none" }}>{line.name}</span>
            </label>
            {!line.manual && line.contributions.length > 0 && (
              <small> {line.contributions.map(contribLabel).join(", ")}</small>
            )}
            {line.manual && (
              <button type="button" onClick={() => handleRemoveManual(line)}>Remove</button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add your own item" />
        <button type="button" onClick={handleAddManual}>Add item</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/components/GroceryPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full verify + commit**

Run: `npx tsc -b && npm test`
Expected: type-check clean, all unit tests pass.

```bash
git add src/components/GroceryPanel.tsx src/components/GroceryPanel.test.tsx
git commit -m "feat: grocery panel with checkable lines and manual items"
```

---

## Self-Review

**Spec coverage:**
- Named plans, add recipes from vault -> Tasks 4, 6, 7. ✓
- One model, two views (bucket list / weekly calendar) -> `view_mode` + Task 7 render branch. ✓
- Grocery grouped by ingredient, dedup'd across recipes, source recipes shown -> Tasks 3, 8. ✓
- Checkable, persisted check state -> `checked_items` + `toggleChecked` (Task 4) + Task 8. ✓
- Manual add/remove lines -> `meal_plan_manual_items` + Tasks 4, 8. ✓
- Personal by default, shareable read-only -> RLS (Task 1) + `setShared` (Tasks 4, 6) + RLS test (Task 5). ✓
- Cheap normalization now, expensive deferred -> `normalizeItem` (Task 2) with the roadmap comment. ✓
- Data-access boundary, verify command, migration rules -> Global Constraints. ✓
- Error handling (dup slot unique, cascade on recipe delete, empty plan) -> unique constraint (Task 1), `on delete cascade` (Task 1), empty-state renders (Tasks 6, 7, 8). ✓

**Placeholder scan:** No "TBD/TODO"; every step has runnable code or an exact command. The one prose note (Task 7 owner-control gating) is a deliberate, scoped simplification, not a missing implementation.

**Type consistency:** `MealPlan`, `MealPlanItem`, `ManualItem`, `GroceryLine`, `GroceryContribution`, `IngredientRow`, `MealSlot`, `MealPlanViewMode` are defined in Tasks 2/3 and used consistently in Task 4 and the UI. API names in the Task 4 interface block match the implementation and the UI call sites (`getGroceryList`, `toggleChecked`, `addManualItem`, `removeManualItem`, `addRecipe`, `removeItem`, `setViewMode`, `createPlan`, `deletePlan`, `setShared`, `listPlans`, `listItems`).
