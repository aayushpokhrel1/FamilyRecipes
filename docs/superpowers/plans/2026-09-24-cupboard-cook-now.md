# Cupboard and Cook Now Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a family a cupboard it can keep honest, and answer "what can I cook right now" from it.

**Architecture:** `pantry_staples` grows a `kind` and a `state` and is renamed `pantry_items`, so one list holds both what a family always keeps and what is in this week. Matching is a pure module over normalized ingredient keys, reusing `normalizeItem` so the app keeps one matching scheme. The cupboard lives at its own route; two hooks in features that already exist (grocery check-off, mark as cooked) keep it true without a new chore.

**Tech Stack:** React 19 + react-router-dom, TypeScript, Supabase (Postgres + RLS), Vitest + Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-09-24-cupboard-cook-now-design.md`

## Global Constraints

- **All Supabase access lives in `src/lib/api/`.** Nothing outside that directory imports the client. This is a portability seam; do not break it.
- **Verify with `npx tsc -b && npm test`**, NOT `tsc --noEmit`. DB changes: `npx supabase db reset` (needs Docker).
- **All date arithmetic goes through `src/lib/dates.ts`.** Never call `toISOString()` to build a `YYYY-MM-DD`: it shifts the day backwards in every UTC+ timezone and reads correctly in US ones, so it ships unnoticed.
- **Ingredient matching goes through `normalizeItem` from `src/lib/api/normalizeItem.ts`.** Do not write a second normalization scheme.
- **Styling is global semantic CSS in `src/index.css`.** No component CSS files. Pages carry class hooks only. Reuse existing classes (`.plate`, `.action`, `.chip`, `.stamp`, `.panel`, `.vault-note`, `.chip-row`, `.stack`) before inventing new ones.
- **A new class used inside `.plate` must be checked for contrast.** `.plate` is cream; cream-on-cream text has shipped before and no test can see it.
- **Migrations are append-only and numbered.** This adds `0017` and nothing else.
- **Commit after each task.** Conventional commit prefixes (`feat:`, `fix:`, `test:`, `refactor:`).

---

### Task 1: Migration 0017, and the pantry API

Renames the table, adds the three columns, and moves every call site onto the new module. No behaviour changes: after this task the app works exactly as before, on the new schema.

**Files:**
- Create: `supabase/migrations/0017_pantry_items.sql`
- Create: `src/lib/api/pantry.ts`
- Delete: `src/lib/api/staples.ts`
- Modify: `src/components/GroceryPanel.tsx` (import + call names only)
- Modify: `src/components/FamilyDataPanel.tsx` (import + call names only)
- Modify: `src/pages/MyKitchen.tsx` (import + call names only)
- Test: `tests/integration/pantry_items.test.ts`

**Interfaces:**
- Consumes: `normalizeItem(item: string): string`, `today(): string`, `addDays(iso: string, days: number): string`
- Produces: `PantryKind`, `PantryState`, `PantryItem`, `listPantry(familyId): Promise<PantryItem[]>`, `addItem(familyId, label, kind?): Promise<PantryItem>`, `setState(id, state): Promise<void>`, `setKind(id, kind): Promise<void>`, `removeItem(id): Promise<void>`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0017_pantry_items.sql`:

```sql
-- The table now holds two kinds of claim: a durable "we keep rice in this
-- house" and a short-lived "we have chicken". The old name would lie about the
-- second, and a name that lies about its contents is exactly the confusion that
-- cost this project the aisles-versus-sections detour.
alter table pantry_staples rename to pantry_items;

alter policy staples_read on pantry_items rename to pantry_items_read;
alter policy staples_write on pantry_items rename to pantry_items_write;

alter table pantry_items
  add column kind text not null default 'keep',
  add column state text not null default 'have',
  add column expires_on date;

alter table pantry_items
  add constraint pantry_items_kind_check check (kind in ('keep', 'week')),
  add constraint pantry_items_state_check check (state in ('have', 'low', 'out'));

-- Existing rows already mean exactly this, so the defaults are the migration.
--
-- expires_on is null for a keep item and today+7 for a week item. Week items
-- are filtered out by query once past, rather than swept by a job: rows
-- accumulate slowly, cost nothing, and a cron is a moving part this does not
-- need yet.
comment on column pantry_items.kind is 'keep = always in the cupboard; week = in right now, expires';
comment on column pantry_items.state is 'have | low | out; low and out become real grocery lines';
```

- [ ] **Step 2: Apply it and confirm it is clean**

Run: `npx supabase db reset`
Expected: all migrations `0001..0017` apply with no error.

- [ ] **Step 3: Write the pantry API module**

Create `src/lib/api/pantry.ts`:

```ts
import { supabase } from "../supabaseClient";
import { normalizeItem } from "./normalizeItem";
import { addDays, today } from "../dates";

export type PantryKind = "keep" | "week";
export type PantryState = "have" | "low" | "out";

export interface PantryItem {
  id: string;
  key: string;
  label: string;
  kind: PantryKind;
  state: PantryState;
  expires_on: string | null;
}

const COLS = "id,key,label,kind,state,expires_on";

// How long a "we have chicken" claim is trusted. After this it stops being
// returned, so a list nobody tends empties itself instead of lying.
export const WEEK_ITEM_DAYS = 7;

export async function listPantry(familyId: string): Promise<PantryItem[]> {
  const { data, error } = await supabase.from("pantry_items")
    .select(COLS).eq("family_id", familyId)
    .or(`expires_on.is.null,expires_on.gte.${today()}`)
    .order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as PantryItem[];
}

// Upsert, not insert: re-adding something already in the cupboard should
// refresh it rather than fail on the (family_id, key) unique constraint. That
// is also exactly what the grocery hook needs when you buy rice again.
export async function addItem(
  familyId: string, label: string, kind: PantryKind = "keep",
): Promise<PantryItem> {
  const row = {
    family_id: familyId,
    key: normalizeItem(label),
    label: label.trim(),
    kind,
    state: "have" as PantryState,
    expires_on: kind === "week" ? addDays(today(), WEEK_ITEM_DAYS) : null,
  };
  const { data, error } = await supabase.from("pantry_items")
    .upsert(row, { onConflict: "family_id,key" }).select(COLS).single();
  if (error) throw new Error(error.message);
  return data as PantryItem;
}

export async function setState(id: string, state: PantryState): Promise<void> {
  const { error } = await supabase.from("pantry_items").update({ state }).eq("id", id);
  if (error) throw new Error(error.message);
}

// Promoting a week item to the cupboard clears its expiry, otherwise it would
// quietly vanish a few days after being made permanent.
export async function setKind(id: string, kind: PantryKind): Promise<void> {
  const { error } = await supabase.from("pantry_items")
    .update({ kind, expires_on: kind === "week" ? addDays(today(), WEEK_ITEM_DAYS) : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeItem(id: string): Promise<void> {
  const { error } = await supabase.from("pantry_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Delete the old module and move every call site**

Delete `src/lib/api/staples.ts`.

In `src/components/GroceryPanel.tsx`, `src/components/FamilyDataPanel.tsx` and `src/pages/MyKitchen.tsx`, replace the import and the calls. This is a rename only, no behaviour change:

| Old | New |
|---|---|
| `import { listStaples, addStaple, removeStaple, type Staple } from "../lib/api/staples"` | `import { listPantry, addItem, removeItem, type PantryItem } from "../lib/api/pantry"` |
| `listStaples(familyId)` | `listPantry(familyId)` |
| `addStaple(familyId, label)` | `addItem(familyId, label)` |
| `removeStaple(id)` | `removeItem(id)` |
| `Staple` | `PantryItem` |

Local state names (`staples`, `stapleLabel`) stay as they are for now; Task 6 and Task 8 rewrite those components properly.

- [ ] **Step 5: Write the RLS integration test**

Create `tests/integration/pantry_items.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SB_URL!;
const ANON = process.env.SB_ANON_KEY!;
const SERVICE = process.env.SB_SERVICE_KEY!;

// jsdom leaks supabase-js auth sessions between clients, hence the node
// environment above and persistSession:false here.
function client() {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

describe("pantry_items RLS", () => {
  let familyA: string;
  let outsider: ReturnType<typeof client>;

  beforeAll(async () => {
    const mk = async (email: string) => {
      const { data } = await admin.auth.admin.createUser({
        email, password: "password123", email_confirm: true,
      });
      const c = client();
      await c.auth.signInWithPassword({ email, password: "password123" });
      return { id: data!.user!.id, c };
    };
    const owner = await mk(`owner-${Date.now()}@local.dev`);
    const other = await mk(`other-${Date.now()}@local.dev`);
    outsider = other.c;

    const { data: fam } = await owner.c.from("families")
      .insert({ name: "Pantry test", created_by: owner.id }).select("id").single();
    familyA = fam!.id;
    await admin.from("pantry_items")
      .insert({ family_id: familyA, key: "rice", label: "Rice", kind: "keep", state: "have" });
  });

  it("hides another family's cupboard", async () => {
    const { data } = await outsider.from("pantry_items").select("id").eq("family_id", familyA);
    expect(data).toEqual([]);
  });

  it("refuses a write into another family's cupboard", async () => {
    const { error } = await outsider.from("pantry_items")
      .insert({ family_id: familyA, key: "salt", label: "Salt" });
    expect(error).not.toBeNull();
  });

  it("defaults an existing staple row to keep/have", async () => {
    const { data } = await admin.from("pantry_items")
      .select("kind,state,expires_on").eq("family_id", familyA).eq("key", "rice").single();
    expect(data).toMatchObject({ kind: "keep", state: "have", expires_on: null });
  });
});
```

- [ ] **Step 6: Run everything**

Run: `npx tsc -b`
Expected: clean.

Run: `npm test`
Expected: all existing tests still pass (this task changed no behaviour).

Run (with `SB_URL`, `SB_ANON_KEY`, `SB_SERVICE_KEY` exported from `npx supabase status -o env`): `npm run test:int`
Expected: the three new tests pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0017_pantry_items.sql src/lib/api/pantry.ts src/components/GroceryPanel.tsx src/components/FamilyDataPanel.tsx src/pages/MyKitchen.tsx tests/integration/pantry_items.test.ts
git rm src/lib/api/staples.ts
git commit -m "feat: pantry_items holds what you keep and what is in right now"
```

---

### Task 2: The matcher

A pure module. No Supabase, no React, mirroring how `src/lib/api/grocery.ts` holds `buildGroceryList`.

**Files:**
- Create: `src/lib/cookNow.ts`
- Test: `src/lib/cookNow.test.ts`

**Interfaces:**
- Consumes: `normalizeItem(item: string): string`, `PantryState` from `./api/pantry`
- Produces: `CookNowRecipe`, `CookNowResult`, `cookNow(recipes: CookNowRecipe[], pantry: {key: string, state: PantryState}[]): CookNowResult[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cookNow.test.ts`:

```ts
import { test, expect } from "vitest";
import { cookNow, type CookNowRecipe } from "./cookNow";

const recipes: CookNowRecipe[] = [
  { recipe_id: "r1", title: "Chicken rice", items: ["Chicken thighs", "rice", "onion"] },
  { recipe_id: "r2", title: "Pilaf", items: ["rice", "onion", "cumin"] },
  { recipe_id: "r3", title: "Plain rice", items: ["Rice"] },
];

test("ranks by how much is missing, fewest first", () => {
  const out = cookNow(recipes, [
    { key: "chicken thigh", state: "have" },
    { key: "rice", state: "have" },
    { key: "onion", state: "have" },
  ]);
  expect(out.map((r) => r.title)).toEqual(["Chicken rice", "Plain rice", "Pilaf"]);
  expect(out[0].missing).toEqual([]);
  expect(out[2].missing).toEqual(["cumin"]);
});

test("an item marked out is not had", () => {
  const out = cookNow(recipes, [
    { key: "rice", state: "have" },
    { key: "onion", state: "out" },
  ]);
  const pilaf = out.find((r) => r.recipe_id === "r2")!;
  expect(pilaf.missing).toEqual(["onion", "cumin"]);
});

test("low still counts as had, but is reported", () => {
  const out = cookNow(recipes, [
    { key: "rice", state: "low" },
    { key: "onion", state: "have" },
    { key: "cumin", state: "have" },
  ]);
  const pilaf = out.find((r) => r.recipe_id === "r2")!;
  expect(pilaf.missing).toEqual([]);
  expect(pilaf.usesLow).toEqual(["rice"]);
});

// The chosen rule: no hidden "everyone has salt" set. An ingredient the
// cupboard has never heard of is missing.
test("an unknown ingredient is missing, not assumed", () => {
  const out = cookNow([{ recipe_id: "r", title: "T", items: ["saffron"] }], []);
  expect(out[0].missing).toEqual(["saffron"]);
  expect(out[0].haveCount).toBe(0);
});

// A degenerate empty case shipped an unreachable cook log last week. A recipe
// with nothing in it is not a recipe you can cook.
test("a recipe with no ingredients is excluded, not a perfect match", () => {
  const out = cookNow([{ recipe_id: "r", title: "Empty", items: [] }], [
    { key: "rice", state: "have" },
  ]);
  expect(out).toEqual([]);
});

test("an empty cupboard returns everything as all-missing rather than throwing", () => {
  const out = cookNow(recipes, []);
  expect(out).toHaveLength(3);
  expect(out.every((r) => r.haveCount === 0)).toBe(true);
});

test("reports the ingredient as written, not the normalized key", () => {
  const out = cookNow([{ recipe_id: "r", title: "T", items: ["Chopped Onions"] }], []);
  expect(out[0].missing).toEqual(["Chopped Onions"]);
});

test("the same ingredient twice counts once", () => {
  const out = cookNow([{ recipe_id: "r", title: "T", items: ["onion", "onions"] }], [
    { key: "onion", state: "have" },
  ]);
  expect(out[0].total).toBe(1);
  expect(out[0].missing).toEqual([]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/cookNow.test.ts`
Expected: FAIL, cannot resolve `./cookNow`.

- [ ] **Step 3: Implement the matcher**

Create `src/lib/cookNow.ts`:

```ts
import { normalizeItem } from "./api/normalizeItem";
import type { PantryState } from "./api/pantry";

export interface CookNowRecipe {
  recipe_id: string;
  title: string;
  items: string[];
}

export interface CookNowResult {
  recipe_id: string;
  title: string;
  total: number;
  haveCount: number;
  missing: string[];
  usesLow: string[];
}

// Matching runs on normalizeItem keys, the same key the grocery grouping and
// the cupboard itself use. One matching scheme in this app, not a second one
// that drifts out of step with the first.
//
// ponytail: matches client side over the whole family vault. Correct at family
// scale (tens to low hundreds of recipes); move to an RPC if a vault ever
// passes a few hundred.
export function cookNow(
  recipes: CookNowRecipe[],
  pantry: { key: string; state: PantryState }[],
): CookNowResult[] {
  const have = new Set(pantry.filter((p) => p.state !== "out").map((p) => p.key));
  const low = new Set(pantry.filter((p) => p.state === "low").map((p) => p.key));

  const results: CookNowResult[] = [];
  for (const r of recipes) {
    // Keep the first spelling of each key so results read the way the recipe
    // is written ("Chopped Onions"), not the way it is matched ("onion").
    const written = new Map<string, string>();
    for (const item of r.items) {
      const key = normalizeItem(item);
      if (key && !written.has(key)) written.set(key, item);
    }
    if (written.size === 0) continue;

    const missing: string[] = [];
    const usesLow: string[] = [];
    for (const [key, label] of written) {
      if (!have.has(key)) missing.push(label);
      else if (low.has(key)) usesLow.push(label);
    }
    results.push({
      recipe_id: r.recipe_id,
      title: r.title,
      total: written.size,
      haveCount: written.size - missing.length,
      missing,
      usesLow,
    });
  }

  results.sort((a, b) =>
    a.missing.length - b.missing.length ||
    b.haveCount - a.haveCount ||
    a.title.localeCompare(b.title));
  return results;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/cookNow.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cookNow.ts src/lib/cookNow.test.ts
git commit -m "feat: match family recipes against what is in the cupboard"
```

---

### Task 3: The cupboard route

**Files:**
- Modify: `src/lib/api/recipes.ts` (append `listRecipeIngredientIndex`)
- Create: `src/pages/Cupboard.tsx`
- Create: `src/pages/Cupboard.test.tsx`
- Modify: `src/routes.tsx`
- Modify: `src/index.css` (append cupboard classes)

**Interfaces:**
- Consumes: `listPantry`, `addItem`, `setState`, `removeItem`, `PantryItem`, `PantryState` from `../lib/api/pantry`; `categoryFor`, `CATEGORY_ORDER`, `CATALOG_ITEMS` from `../lib/catalog`; `useFamily()` from `../context/FamilyContext`
- Produces: `listRecipeIngredientIndex(familyId): Promise<CookNowRecipe[]>`; route `/kitchen/cupboard`

- [ ] **Step 1: Add the recipe ingredient index**

Append to `src/lib/api/recipes.ts`:

```ts
// Every family recipe with its ingredient names, for matching against the
// cupboard. Two queries rather than a join because PostgREST embedding would
// return the whole ingredient row per recipe; only the names matter here.
export async function listRecipeIngredientIndex(
  familyId: string,
): Promise<{ recipe_id: string; title: string; items: string[] }[]> {
  const { data: recs, error } = await supabase.from("recipes")
    .select("id,title").eq("family_id", familyId);
  if (error) throw new Error(error.message);
  const ids = (recs ?? []).map((r: any) => r.id);
  if (!ids.length) return [];
  const { data, error: e2 } = await supabase.from("recipe_ingredients")
    .select("recipe_id,item").in("recipe_id", ids);
  if (e2) throw new Error(e2.message);
  const byRecipe = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = byRecipe.get((row as any).recipe_id) ?? [];
    list.push((row as any).item as string);
    byRecipe.set((row as any).recipe_id, list);
  }
  return (recs ?? []).map((r: any) => ({
    recipe_id: r.id, title: r.title, items: byRecipe.get(r.id) ?? [],
  }));
}
```

- [ ] **Step 2: Write the failing page test**

Create `src/pages/Cupboard.test.tsx`:

```tsx
import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Cupboard from "./Cupboard";

const family = { active: { id: "f1", name: "F", invite_code: "x", created_by: "u" } as any };
vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: family.active }),
}));

vi.mock("../lib/api/pantry", () => ({
  listPantry: vi.fn().mockResolvedValue([
    { id: "p1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
    { id: "p2", key: "olive oil", label: "Olive oil", kind: "keep", state: "low", expires_on: null },
  ]),
  addItem: vi.fn().mockResolvedValue({
    id: "p3", key: "salt", label: "Salt", kind: "keep", state: "have", expires_on: null,
  }),
  setState: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/api/recipes", () => ({
  listRecipeIngredientIndex: vi.fn().mockResolvedValue([]),
  listFamilyIngredientNames: vi.fn().mockResolvedValue([]),
}));

beforeEach(() => vi.clearAllMocks());

function renderCupboard() {
  return render(<MemoryRouter><Cupboard /></MemoryRouter>);
}

test("lists what is in the cupboard with its state", async () => {
  renderCupboard();
  expect(await screen.findByText("Rice")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Olive oil.*low/i })).toBeInTheDocument();
});

test("tapping an item cycles have to low", async () => {
  const pantry = await import("../lib/api/pantry");
  renderCupboard();
  await userEvent.click(await screen.findByRole("button", { name: /Rice.*have/i }));
  await waitFor(() => expect(pantry.setState).toHaveBeenCalledWith("p1", "low"));
});

test("adding an item stores it", async () => {
  const pantry = await import("../lib/api/pantry");
  renderCupboard();
  await screen.findByText("Rice");
  await userEvent.type(screen.getByLabelText("Add to the cupboard"), "Salt");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(pantry.addItem).toHaveBeenCalledWith("f1", "Salt", "keep"));
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/pages/Cupboard.test.tsx`
Expected: FAIL, cannot resolve `./Cupboard`.

- [ ] **Step 4: Build the page**

Create `src/pages/Cupboard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import {
  listPantry, addItem, setState as setItemState, removeItem,
  type PantryItem, type PantryState,
} from "../lib/api/pantry";
import { categoryFor, CATEGORY_ORDER, CATALOG_ITEMS } from "../lib/catalog";

// Tap to cycle. Three states in a ring is the cheapest upkeep gesture there
// is, and upkeep is the whole risk with a cupboard.
const NEXT: Record<PantryState, PantryState> = { have: "low", low: "out", out: "have" };

export default function Cupboard() {
  const { activeFamily } = useFamily();
  const [items, setItems] = useState<PantryItem[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeFamily) { setLoading(false); return; }
    listPantry(activeFamily.id)
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeFamily]);

  async function handleCycle(item: PantryItem) {
    const next = NEXT[item.state];
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, state: next } : i)));
    try { await setItemState(item.id, next); } catch (e: any) { setError(e.message); }
  }

  async function handleAdd() {
    if (!activeFamily || !label.trim()) return;
    try {
      const added = await addItem(activeFamily.id, label, "keep");
      setItems((list) => [...list.filter((i) => i.id !== added.id), added]
        .sort((a, b) => a.label.localeCompare(b.label)));
      setLabel("");
    } catch (e: any) { setError(e.message); }
  }

  async function handleRemove(id: string) {
    setItems((list) => list.filter((i) => i.id !== id));
    try { await removeItem(id); } catch (e: any) { setError(e.message); }
  }

  // The aisle is a fact about the ingredient, so it is derived on render and
  // never stored. Same rule the grocery list already follows.
  const groups = new Map<string, PantryItem[]>();
  for (const item of items) {
    const cat = categoryFor(item.label) ?? "Other";
    groups.set(cat, [...(groups.get(cat) ?? []), item]);
  }
  const order = [...CATEGORY_ORDER, "Other"].filter((c) => groups.has(c));

  return (
    <div className="cupboard">
      <h1>The cupboard</h1>
      <p className="vault-note">
        Tap anything to say whether you have it, are running low, or have run out.
        Low and out land on this week's shopping.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading && <p className="vault-note">Loading...</p>}

      {!loading && items.length === 0 && (
        <p className="vault-note">Nothing in the cupboard yet.</p>
      )}

      {order.map((cat) => (
        <section key={cat} className="panel">
          <h2>{cat}</h2>
          <ul className="chip-row cupboard-items">
            {groups.get(cat)!.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`chip cupboard-chip is-${item.state}`}
                  onClick={() => handleCycle(item)}
                  aria-label={`${item.label}, ${item.state}`}
                >
                  {item.label}
                  {item.kind === "week" && <span className="cupboard-week"> this week</span>}
                </button>
                <button
                  type="button"
                  className="cupboard-remove"
                  aria-label={`Remove ${item.label}`}
                  onClick={() => handleRemove(item.id)}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="panel">
        <label htmlFor="cupboard-add">Add to the cupboard</label>
        <input
          id="cupboard-add"
          list="cupboard-catalog"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Rice, olive oil..."
        />
        <datalist id="cupboard-catalog">
          {CATALOG_ITEMS.map((i) => <option key={i} value={i} />)}
        </datalist>
        <button type="button" className="action" onClick={handleAdd} disabled={!activeFamily}>
          Add
        </button>
      </section>

      <p className="vault-note"><Link to="/kitchen">Back to My Kitchen</Link></p>
    </div>
  );
}
```

- [ ] **Step 5: Add the styles**

Append to `src/index.css`:

```css
/* The cupboard. Three states need to be tellable apart at a glance and in both
   themes, so each carries its own text colour as well as its own background:
   colour alone fails for anyone who cannot distinguish these hues. */
.cupboard-items { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.cupboard-items li { display: flex; align-items: center; gap: 2px; }
.cupboard-chip { cursor: pointer; border: 2px solid var(--ink); font: inherit; font-size: 0.85rem; }
.cupboard-chip.is-have { background: #c8d9cf; color: #1d4a35; }
.cupboard-chip.is-low { background: #f0d9a8; color: #6b4a10; }
.cupboard-chip.is-out { background: #e8c0b6; color: #8c2c17; text-decoration: line-through; }
.cupboard-week { font-size: 0.72rem; opacity: 0.75; }
.cupboard-remove { background: none; border: none; cursor: pointer; font-size: 1rem; opacity: 0.6; }
.cupboard-remove:hover { opacity: 1; }
```

- [ ] **Step 6: Register the route**

In `src/routes.tsx`, add the import and the route **above** `kitchen/:id`:

```tsx
import Cupboard from "./pages/Cupboard";
```

```tsx
        <Route path="kitchen" element={<MyKitchen />} />
        {/* Above kitchen/:id deliberately. React Router ranks a static segment
            over a dynamic one, so this wins, but the ordering says so out loud
            rather than relying on the reader knowing that. */}
        <Route path="kitchen/cupboard" element={<Cupboard />} />
        <Route path="kitchen/:id" element={<MealPlanDetail />} />
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/pages/Cupboard.test.tsx`
Expected: 3 passed.

Run: `npx tsc -b && npm test`
Expected: clean, everything green.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Cupboard.tsx src/pages/Cupboard.test.tsx src/routes.tsx src/index.css src/lib/api/recipes.ts
git commit -m "feat: a cupboard you can tap to keep honest"
```

---

### Task 4: Seeding on first run

**Files:**
- Modify: `src/pages/Cupboard.tsx`
- Modify: `src/pages/Cupboard.test.tsx`
- Create: `src/lib/seedSuggestions.ts`
- Test: `src/lib/seedSuggestions.test.ts`

**Interfaces:**
- Consumes: `listRecipeIngredientIndex` from `../lib/api/recipes`
- Produces: `seedSuggestions(recipes: CookNowRecipe[], limit?: number): string[]`

- [ ] **Step 1: Write the failing test for the ranking**

Create `src/lib/seedSuggestions.test.ts`:

```ts
import { test, expect } from "vitest";
import { seedSuggestions } from "./seedSuggestions";

const recipes = [
  { recipe_id: "1", title: "A", items: ["Salt", "Onion", "Rice"] },
  { recipe_id: "2", title: "B", items: ["salt", "onions", "Chicken"] },
  { recipe_id: "3", title: "C", items: ["Salt", "Olive oil"] },
];

test("ranks by how many recipes use it", () => {
  expect(seedSuggestions(recipes)[0]).toBe("Salt");
});

test("merges spellings that normalize the same", () => {
  const out = seedSuggestions(recipes);
  expect(out.filter((s) => s.toLowerCase().startsWith("onion"))).toHaveLength(1);
});

test("returns the spelling the family actually writes", () => {
  expect(seedSuggestions(recipes)).toContain("Olive oil");
});

test("an empty vault suggests nothing rather than throwing", () => {
  expect(seedSuggestions([])).toEqual([]);
});

test("honours the limit", () => {
  expect(seedSuggestions(recipes, 2)).toHaveLength(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/seedSuggestions.test.ts`
Expected: FAIL, cannot resolve `./seedSuggestions`.

- [ ] **Step 3: Implement it**

Create `src/lib/seedSuggestions.ts`:

```ts
import { normalizeItem } from "./api/normalizeItem";
import type { CookNowRecipe } from "./cookNow";

// What to offer on an empty cupboard, drawn from the family's own recipes
// rather than a curated "everyone has salt" list. The assumption about what
// this household keeps then comes from this household, and it is visible and
// editable rather than hidden in the matcher.
export function seedSuggestions(recipes: CookNowRecipe[], limit = 20): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const r of recipes) {
    const seen = new Set<string>();
    for (const item of r.items) {
      const key = normalizeItem(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const prev = counts.get(key);
      counts.set(key, { label: prev?.label ?? item, n: (prev?.n ?? 0) + 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((c) => c.label);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/seedSuggestions.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Wire the empty state into the page**

In `src/pages/Cupboard.tsx`, add to the imports:

```tsx
import { listRecipeIngredientIndex } from "../lib/api/recipes";
import { seedSuggestions } from "../lib/seedSuggestions";
```

Add state and a loader beside the existing ones:

```tsx
  const [seeds, setSeeds] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
```

Inside the existing `useEffect`, after `listPantry` resolves, load seeds only when the cupboard is empty:

```tsx
    listPantry(activeFamily.id)
      .then(async (list) => {
        setItems(list);
        if (list.length === 0) {
          const index = await listRecipeIngredientIndex(activeFamily.id);
          setSeeds(seedSuggestions(index));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
```

Add the handler:

```tsx
  async function handleSeed() {
    if (!activeFamily) return;
    try {
      const added = await Promise.all(
        [...picked].map((l) => addItem(activeFamily.id, l, "keep")));
      setItems(added.sort((a, b) => a.label.localeCompare(b.label)));
      setSeeds([]);
      setPicked(new Set());
    } catch (e: any) { setError(e.message); }
  }
```

Replace the `items.length === 0` block with:

```tsx
      {!loading && items.length === 0 && seeds.length > 0 && (
        <section className="panel">
          <h2>Start with what you usually keep</h2>
          <p className="vault-note">
            Taken from the ingredients your own recipes use most. Tick the ones you keep in.
          </p>
          <ul className="chip-row cupboard-items">
            {seeds.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className={`chip cupboard-chip ${picked.has(s) ? "is-have" : ""}`}
                  aria-pressed={picked.has(s)}
                  onClick={() => setPicked((p) => {
                    const next = new Set(p);
                    if (next.has(s)) next.delete(s); else next.add(s);
                    return next;
                  })}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="action" disabled={picked.size === 0} onClick={handleSeed}>
            Add {picked.size} to the cupboard
          </button>
        </section>
      )}

      {!loading && items.length === 0 && seeds.length === 0 && (
        <p className="vault-note">
          Nothing in the cupboard yet, and no recipes to suggest from. Add something below.
        </p>
      )}
```

- [ ] **Step 6: Add the page test for seeding**

Append to `src/pages/Cupboard.test.tsx`:

```tsx
test("offers a seed list when the cupboard is empty", async () => {
  const pantry = await import("../lib/api/pantry");
  const recipes = await import("../lib/api/recipes");
  (pantry.listPantry as any).mockResolvedValueOnce([]);
  (recipes.listRecipeIngredientIndex as any).mockResolvedValueOnce([
    { recipe_id: "1", title: "A", items: ["Salt", "Rice"] },
  ]);
  renderCupboard();
  await userEvent.click(await screen.findByRole("button", { name: "Salt" }));
  await userEvent.click(screen.getByRole("button", { name: /Add 1 to the cupboard/ }));
  await waitFor(() => expect(pantry.addItem).toHaveBeenCalledWith("f1", "Salt", "keep"));
});

// An empty vault has nothing to suggest from. Saying so beats an empty panel
// with a dead button.
test("says so when there is nothing to suggest", async () => {
  const pantry = await import("../lib/api/pantry");
  const recipes = await import("../lib/api/recipes");
  (pantry.listPantry as any).mockResolvedValueOnce([]);
  (recipes.listRecipeIngredientIndex as any).mockResolvedValueOnce([]);
  renderCupboard();
  expect(await screen.findByText(/no recipes to suggest from/i)).toBeInTheDocument();
});
```

- [ ] **Step 7: Run everything**

Run: `npx vitest run src/pages/Cupboard.test.tsx src/lib/seedSuggestions.test.ts`
Expected: all pass.

Run: `npx tsc -b && npm test`
Expected: clean and green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/seedSuggestions.ts src/lib/seedSuggestions.test.ts src/pages/Cupboard.tsx src/pages/Cupboard.test.tsx
git commit -m "feat: seed an empty cupboard from the family's own recipes"
```

---

### Task 5: What can I cook

**Files:**
- Modify: `src/pages/Cupboard.tsx`
- Modify: `src/pages/Cupboard.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `cookNow`, `CookNowResult` from `../lib/cookNow`; `listRecipeIngredientIndex` from `../lib/api/recipes`
- Produces: nothing new for later tasks

- [ ] **Step 1: Write the failing test**

Append to `src/pages/Cupboard.test.tsx`:

```tsx
test("shows what you can cook, and what is missing", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.listRecipeIngredientIndex as any).mockResolvedValueOnce([
    { recipe_id: "r1", title: "Rice bowl", items: ["Rice"] },
    { recipe_id: "r2", title: "Pilaf", items: ["Rice", "Cumin"] },
  ]);
  renderCupboard();
  await userEvent.click(await screen.findByRole("button", { name: /What can I cook/i }));
  expect(await screen.findByText("Rice bowl")).toBeInTheDocument();
  expect(screen.getByText(/Missing Cumin/i)).toBeInTheDocument();
});

// An empty result must explain itself rather than render nothing at all.
test("explains an empty result", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.listRecipeIngredientIndex as any).mockResolvedValueOnce([]);
  renderCupboard();
  await userEvent.click(await screen.findByRole("button", { name: /What can I cook/i }));
  expect(await screen.findByText(/No recipes in the vault yet/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/Cupboard.test.tsx -t "what you can cook"`
Expected: FAIL, no such button.

- [ ] **Step 3: Implement it**

In `src/pages/Cupboard.tsx` add imports:

```tsx
import { cookNow, type CookNowResult } from "../lib/cookNow";
```

Add state:

```tsx
  const [results, setResults] = useState<CookNowResult[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [showAll, setShowAll] = useState(false);
```

Add the handler:

```tsx
  async function handleCookNow() {
    if (!activeFamily) return;
    setMatching(true);
    try {
      const index = await listRecipeIngredientIndex(activeFamily.id);
      setResults(cookNow(index, items));
    } catch (e: any) { setError(e.message); }
    finally { setMatching(false); }
  }
```

Render, placed directly under the intro paragraph:

```tsx
      <button
        type="button"
        className="action"
        onClick={handleCookNow}
        disabled={!activeFamily || matching}
      >
        What can I cook?
      </button>

      {results && results.length === 0 && (
        <p className="vault-note">No recipes in the vault yet, so there is nothing to match.</p>
      )}

      {results && results.length > 0 && (
        <section className="panel">
          <h2>You could cook</h2>
          <ul className="stack">
            {(showAll ? results : results.filter((r) => r.missing.length <= 2)).map((r) => (
              <li key={r.recipe_id} className="plate plate-row">
                <Link to={`/recipes/${r.recipe_id}`}>{r.title}</Link>
                <span className="stamp">{r.haveCount}/{r.total}</span>
                {r.missing.length === 0
                  ? <span className="chip">have everything</span>
                  : <span className="chip">Missing {r.missing.join(", ")}</span>}
                {r.usesLow.length > 0 && (
                  <span className="chip">low on {r.usesLow.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
          {/* Never hide results silently: an unexplained short list reads as a
              bug. Say how many are further off and let them be seen. */}
          {!showAll && results.some((r) => r.missing.length > 2) && (
            <button type="button" onClick={() => setShowAll(true)}>
              Show {results.filter((r) => r.missing.length > 2).length} more that need a shop
            </button>
          )}
        </section>
      )}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/pages/Cupboard.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Cupboard.tsx src/pages/Cupboard.test.tsx src/index.css
git commit -m "feat: answer what you can cook from the cupboard"
```

---

### Task 6: The shopping hook, and low/out on the grocery list

**Files:**
- Modify: `src/lib/api/mealPlans.ts:241` (the staples set, and the ONLY `buildGroceryList` call site)
- Modify: `src/components/GroceryPanel.tsx` (the cupboard action only)
- Modify: `src/components/GroceryPanel.test.tsx`

> **Corrected after Task 1.** An earlier draft of this task claimed the staples set was built
> in `GroceryPanel.tsx` and `UpcomingGroceryPanel.tsx`. It is not. `buildGroceryList` is called
> in exactly one place, `src/lib/api/mealPlans.ts:241`, and the components render what
> `getGroceryList` returns. Do not go looking for it in the components.

**Interfaces:**
- Consumes: `listPantry`, `addItem`, `PantryItem` from `../lib/api/pantry`
- Produces: nothing new for later tasks

- [ ] **Step 1: Write the failing tests**

Append to `src/components/GroceryPanel.test.tsx`:

```tsx
// The whole "do we need more rice" job: a staple you have is a quiet reminder,
// a staple you are out of is a thing to buy.
test("only items you actually have are treated as staples", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValueOnce([
    { id: "p1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
    { id: "p2", key: "cumin", label: "Cumin", kind: "keep", state: "out", expires_on: null },
  ]);
  renderPanel();
  // Rice is suppressed into the staples group; cumin is a real line to buy.
  expect(await screen.findByText("Cumin")).toBeInTheDocument();
});

test("offers to put checked items in the cupboard", async () => {
  const pantry = await import("../lib/api/pantry");
  renderPanel();
  await userEvent.click(await screen.findByRole("checkbox", { name: /rice/i }));
  await userEvent.click(screen.getByRole("button", { name: /Put 1 item in the cupboard/i }));
  await waitFor(() => expect(pantry.addItem).toHaveBeenCalledWith("f1", "rice", "week"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/GroceryPanel.test.tsx`
Expected: FAIL on both new tests.

- [ ] **Step 3: Pass only `have` items as staples**

In `src/lib/api/mealPlans.ts`, inside `groceryLinesFromItems`, the call currently reads:

```ts
  return buildGroceryList(
    rows,
    { staples: new Set(staples.map((s) => s.key)), categories },
```

Change the set to filter by kind and state, and rename the local `staples` to `pantry` so the name stops claiming everything in it is a staple:

```ts
  const pantry = familyId ? await listPantry(familyId) : [];
```

```ts
  return buildGroceryList(
    rows,
    {
      // An item you are low on or out of is a thing to BUY, not a thing to
      // assume you have. This one filter is the whole "do we need more rice"
      // job. A week item is never a staple: it is this week's food, and it
      // belongs on the list like anything else.
      staples: new Set(
        pantry.filter((p) => p.kind === "keep" && p.state === "have").map((p) => p.key),
      ),
      categories,
    },
```

Leave the comment above the line about family scoping in place, it is still true.

- [ ] **Step 4: Add the cupboard action**

In `src/components/GroceryPanel.tsx`:

```tsx
  const [stocking, setStocking] = useState(false);

  // Explicit, not automatic. One feature silently writing rows in another is
  // surprising, and surprise is expensive in the thing a family trusts for
  // dinner. Checked means bought, but the user still says so.
  async function handleStock() {
    if (!activeFamily) return;
    setStocking(true);
    try {
      const checked = lines.filter((l) => l.checked && !l.staple);
      await Promise.all(checked.map((l) => addItem(activeFamily.id, l.name, "week")));
      setPantryItems(await listPantry(activeFamily.id));
    } finally { setStocking(false); }
  }
```

Render it just under the shopping list, only when something is checked:

```tsx
      {shopping.some((l) => l.checked) && (
        <button type="button" className="action" onClick={handleStock} disabled={stocking}>
          Put {shopping.filter((l) => l.checked).length} item
          {shopping.filter((l) => l.checked).length === 1 ? "" : "s"} in the cupboard
        </button>
      )}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/GroceryPanel.test.tsx`
Expected: all pass.

Run: `npx tsc -b && npm test`
Expected: clean and green.

- [ ] **Step 6: Commit**

```bash
git add src/components/GroceryPanel.tsx src/components/GroceryPanel.test.tsx src/components/UpcomingGroceryPanel.tsx
git commit -m "feat: shopping feeds the cupboard, and low staples get bought"
```

---

### Task 7: Marking cooked asks what it used up

**Files:**
- Modify: `src/pages/CookMode.tsx`
- Modify: `src/pages/CookMode.test.tsx`

**Interfaces:**
- Consumes: `listPantry`, `setState`, `PantryItem` from `../lib/api/pantry`; `normalizeItem`
- Produces: nothing new for later tasks

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/CookMode.test.tsx`:

```tsx
test("after marking cooked, offers only the cupboard items that recipe used", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValue([
    { id: "p1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
    { id: "p2", key: "saffron", label: "Saffron", kind: "keep", state: "have", expires_on: null },
  ]);
  renderCookMode();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as cooked" }));
  expect(await screen.findByRole("button", { name: /Rice.*out/i })).toBeInTheDocument();
  // Saffron is in the cupboard but not in this recipe, so it is not offered.
  expect(screen.queryByRole("button", { name: /Saffron/i })).not.toBeInTheDocument();
});

// A recipe whose ingredients are all unknown to the cupboard must not render
// an empty prompt with nothing in it.
test("skips the prompt when the recipe used nothing in the cupboard", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValue([]);
  renderCookMode();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as cooked" }));
  expect(await screen.findByText(/Logged/i)).toBeInTheDocument();
  expect(screen.queryByText(/Used anything up/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/CookMode.test.tsx`
Expected: FAIL on both.

- [ ] **Step 3: Implement**

In `src/pages/CookMode.tsx` add imports:

```tsx
import { listPantry, setState as setItemState, type PantryItem } from "../lib/api/pantry";
import { normalizeItem } from "../lib/api/normalizeItem";
```

Add state:

```tsx
  const [used, setUsed] = useState<PantryItem[]>([]);
```

In `handleMarkCooked`, after the log succeeds:

```tsx
    // Only what this recipe actually touched. Offering the whole cupboard here
    // would be a chore rather than a prompt.
    if (activeFamily) {
      const keys = new Set(ingredients.map((i) => normalizeItem(i.item)));
      const pantry = await listPantry(activeFamily.id);
      setUsed(pantry.filter((p) => keys.has(p.key)));
    }
```

Render inside the existing `.cook-log` block, after the "Logged" note:

```tsx
        {logged && used.length > 0 && (
          <div className="cook-used">
            <p className="vault-note">Used anything up?</p>
            {used.map((item) => (
              <button
                key={item.id}
                type="button"
                className="chip"
                aria-label={`${item.label}, mark out`}
                onClick={async () => {
                  await setItemState(item.id, "out");
                  setUsed((list) => list.filter((i) => i.id !== item.id));
                }}
              >
                {item.label} &rarr; out
              </button>
            ))}
          </div>
        )}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/pages/CookMode.test.tsx`
Expected: all pass, including the existing no-steps regression test.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CookMode.tsx src/pages/CookMode.test.tsx
git commit -m "feat: cooking asks what it used up"
```

---

### Task 8: My Kitchen summary and the Settings link

**Files:**
- Modify: `src/pages/MyKitchen.tsx`
- Modify: `src/pages/MyKitchen.test.tsx`
- Modify: `src/components/FamilyDataPanel.tsx`

**Interfaces:**
- Consumes: `listPantry`, `PantryItem` from `../lib/api/pantry`
- Produces: nothing

- [ ] **Step 1: Write the failing test**

Append to `src/pages/MyKitchen.test.tsx`:

```tsx
test("summarises the cupboard with something worth acting on", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValueOnce([
    { id: "1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
    { id: "2", key: "oil", label: "Oil", kind: "keep", state: "low", expires_on: null },
    { id: "3", key: "cumin", label: "Cumin", kind: "keep", state: "out", expires_on: null },
  ]);
  renderKitchen();
  expect(await screen.findByText(/2 to restock/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /cupboard/i })).toHaveAttribute("href", "/kitchen/cupboard");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/MyKitchen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Replace the staples strip**

In `src/pages/MyKitchen.tsx`, swap the `staples-strip` section for:

```tsx
      {/* Actionable on purpose: a neutral count gives no reason to tap. The
          cupboard lives a tap away, so this line has to earn the trip. */}
      {activeFamily && pantry.length > 0 && (
        <section className="staples-strip">
          <h3>The cupboard</h3>
          <p className="vault-note">
            {pantry.filter((i) => i.state !== "have").length > 0
              ? `${pantry.filter((i) => i.state !== "have").length} to restock`
              : "All stocked"}
            {" · "}
            {pantry.filter((i) => i.kind === "week").length} in this week
          </p>
          <p className="vault-note"><Link to="/kitchen/cupboard">Open the cupboard</Link></p>
        </section>
      )}
```

Rename the local state from `staples` to `pantry` for clarity.

- [ ] **Step 4: Point Settings at the cupboard**

In `src/components/FamilyDataPanel.tsx`, replace the "Pantry staples" add/remove block with a link, so there is one editor rather than two:

```tsx
      <h3>The cupboard</h3>
      <p className="vault-note">
        What your family keeps in, and what is in right now, is managed in{" "}
        <Link to="/kitchen/cupboard">the cupboard</Link>.
      </p>
```

Remove the now-unused `addItem` / `removeItem` imports and the `stapleLabel` state. Keep `listPantry` only if the panel still displays a count; otherwise remove it too and drop the state.

- [ ] **Step 5: Run everything**

Run: `npx tsc -b`
Expected: clean, with no unused-import errors.

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/pages/MyKitchen.tsx src/pages/MyKitchen.test.tsx src/components/FamilyDataPanel.tsx
git commit -m "feat: My Kitchen points at the cupboard, Settings stops duplicating it"
```

---

### Task 9: Browser verification and ship

No new code unless this finds something. **This task is not optional.** Two bugs on 2026-09-24 were invisible to 160 green tests and took seconds to find in a browser.

**Files:**
- Modify: whatever this finds

- [ ] **Step 1: Point the dev server at a local database**

`.env.local` currently points at CLOUD. Switch it to local before testing writes:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status -o env`>
```

Then `npx supabase db reset` and seed an account, a family and a couple of recipes via the service-role key.

- [ ] **Step 2: Walk the degenerate cases**

Check each in the browser, light **and** dark:

- An empty cupboard with an empty vault: the "nothing to suggest from" line, not a dead panel.
- An empty cupboard with recipes: the seed list appears, ticking and adding works.
- A recipe with no ingredients: excluded from results, does not appear as a perfect match.
- Everything missing: results still render and explain themselves.
- The `/kitchen/cupboard` route resolves to the cupboard, **not** to MealPlanDetail treating "cupboard" as a plan id.
- Chip contrast in both themes for all three states, including inside `.plate`.

- [ ] **Step 3: Walk the two hooks end to end**

- Tick items on a grocery list, press the cupboard button, confirm they appear as "this week".
- Mark a recipe cooked, mark something out, confirm the cupboard and the next grocery list both reflect it.

- [ ] **Step 4: Ship, database first**

```bash
npx supabase db push
```

Then push to master. The frontend selects `kind`, `state` and `expires_on` and would error against the old cloud schema, so the database must lead.

- [ ] **Step 5: Confirm it actually deployed**

Auto-deploy on push has never fired on this account. Verify rather than assume: build locally, compare the content hash against the live bundle, and if it has not landed, start a build via the Cloudflare API trigger (see HANDOVER.md, Next actions item 1).
