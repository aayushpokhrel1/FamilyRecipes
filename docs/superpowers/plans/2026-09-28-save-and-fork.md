# Save and Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in cook copy a public recipe from Potluck into their family vault, credited to the original cook, without the original cook being able to change or remove it afterwards.

**Architecture:** Two migrations add lineage columns plus two guards (a check constraint blocking publication of a copy, a partial unique index blocking a duplicate save), an adaptation trigger fired from three tables, and a `save_recipe_to_vault` RPC that copies parent and children **without naming their columns**. The frontend adds one API module and a save button on two surfaces.

**Tech Stack:** Supabase (Postgres 15, PostgREST, RLS), React 19 + TypeScript, Vite, Vitest + Testing Library, vitest node environment for integration tests.

**Spec:** `docs/superpowers/specs/2026-09-28-save-and-fork-design.md`

## Global Constraints

- **All Supabase access lives in `src/lib/api/`.** Nothing outside it imports the client. This is the portability seam for a future Node/Express backend.
- **Verify with `npx tsc -b && npm test`**, not `tsc --noEmit`. Migration changes also need `npx supabase db reset` (requires Docker running).
- **Integration tests need the `// @vitest-environment node` pragma on line 1.** A file missing it fails in CI (commit `191b437` exists only because of this).
- **Run integration tests with:** `npx supabase status` for the keys, then
  `SB_URL=http://127.0.0.1:54321 SB_ANON_KEY=<ANON_KEY> SB_SERVICE_KEY=<SERVICE_ROLE_KEY> npm run test:int`
- **Never build a test search term as `prefix + Date.now()`.** `search_recipes` matches with pg_trgm, and two timestamps a moment apart score 0.3 to 0.57 against a 0.3 threshold. Use random letters. This plan's tests do not search, but titles still use random suffixes.
- **Apply a migration to cloud BEFORE the frontend that needs it.** Cloudflare deploys the frontend automatically; Supabase deploys nothing.
- **Never write an em dash or en dash** in code, comments, commit messages or docs.
- **Migration numbering:** the last applied is `0025_public_search.sql`. This plan adds `0026` and `0027`.
- **Visibility enum values:** `private`, `family`, `public`.
- **The credit name comes from `profiles.public_name`** (the published identity), falling back to `profiles.display_name` (which is `not null`, default `'Cook'`).

---

### Task 1: Lineage columns, the two guards, and the adaptation trigger

**Files:**
- Create: `supabase/migrations/0026_saved_recipes.sql`
- Create: `tests/integration/saved_recipes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `recipes.source_recipe_id uuid`, `recipes.source_cook_name text`, `recipes.adapted_at timestamptz`; constraint `saved_copies_are_not_publishable`; index `recipes_one_copy_per_family`; trigger function `mark_recipe_adapted()`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/saved_recipes.test.ts`:

```ts
// @vitest-environment node
// The DB-level half of save and fork: the two guards that make a copy safe, and the
// trigger that notices the first edit. These are tested here rather than in a unit test
// because a constraint and a trigger only exist in Postgres.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

async function famWithRecipe(prefix: string, visibility = "public") {
  const cook = await makeUser(`${prefix}-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: cook.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: cook.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: cook.id, title: `Dal ${rand()}`, visibility })
    .select().single();
  return { cook, fam: fam!, rec: rec! };
}

test("a saved copy cannot be made public", async () => {
  const { fam, cook, rec } = await famWithRecipe("sv-pub");
  const { data: copy } = await admin.from("recipes")
    .insert({ family_id: fam.id, author_id: cook.id, title: "Copy", visibility: "family",
              source_recipe_id: rec.id })
    .select().single();
  const { error } = await admin.from("recipes")
    .update({ visibility: "public" }).eq("id", copy!.id);
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/saved_copies_are_not_publishable/);
});

test("the same recipe cannot be saved into one family twice", async () => {
  const { fam, cook, rec } = await famWithRecipe("sv-dup");
  const row = { family_id: fam.id, author_id: cook.id, title: "Copy",
                visibility: "family" as const, source_recipe_id: rec.id };
  const first = await admin.from("recipes").insert(row);
  expect(first.error).toBeNull();
  const second = await admin.from("recipes").insert(row);
  expect(second.error).not.toBeNull();
  expect(second.error!.message).toMatch(/recipes_one_copy_per_family/);
});

// An ingredient-only edit does NOT touch the recipes row (updateRecipe skips the row
// update when the patch has no recipe-level keys), so a trigger on recipes alone would
// miss the edit most likely to be someone's first: changing an amount.
test("editing only the ingredients marks the copy as adapted", async () => {
  const { fam, cook, rec } = await famWithRecipe("sv-adapt");
  const { data: copy } = await admin.from("recipes")
    .insert({ family_id: fam.id, author_id: cook.id, title: "Copy", visibility: "family",
              source_recipe_id: rec.id })
    .select().single();
  expect(copy!.adapted_at).toBeNull();

  await admin.from("recipe_ingredients")
    .insert({ recipe_id: copy!.id, position: 0, quantity: "1", unit: "cup", item: "flour" });

  const { data: after } = await admin.from("recipes")
    .select("adapted_at").eq("id", copy!.id).single();
  expect(after!.adapted_at).not.toBeNull();
});

// A recipe that is nobody's copy must never gain an adapted_at, or the quiet-credit
// rule would fire on recipes that were typed from scratch.
test("editing a recipe that is not a copy leaves adapted_at null", async () => {
  const { rec } = await famWithRecipe("sv-own");
  await admin.from("recipe_ingredients")
    .insert({ recipe_id: rec.id, position: 0, quantity: "1", unit: "cup", item: "flour" });
  const { data: after } = await admin.from("recipes")
    .select("adapted_at").eq("id", rec.id).single();
  expect(after!.adapted_at).toBeNull();
});
```

- [ ] **Step 2: Run the tests and watch all four fail**

Run:
```bash
SB_URL=http://127.0.0.1:54321 SB_ANON_KEY=$ANON SB_SERVICE_KEY=$SVC npx vitest run tests/integration/saved_recipes.test.ts
```
Expected: 4 failed. The first two fail because the inserts succeed and `error` is null; the third and fourth fail on `column recipes.adapted_at does not exist`.

**Do not skip this step.** A constraint test nobody has seen fail is not evidence, which this project relearned in sub-project 1.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0026_saved_recipes.sql`:

```sql
-- 0026: lineage for a saved copy, and the two guards that make copying safe.
--
-- A save COPIES a recipe rather than pointing at it, so that unpublishing or deleting the
-- original cannot empty someone else's vault. These columns record where a copy came from.

alter table recipes
  add column source_recipe_id uuid references recipes(id) on delete set null,
  add column source_cook_name text,
  add column adapted_at timestamptz;

-- source_cook_name is a SNAPSHOT, not a join, and deliberately survives the FK going null.
-- The original cook must not be able to erase her name from a copy any more than she can
-- erase the copy itself. The accepted cost is that it goes stale if she renames herself.
comment on column recipes.source_cook_name is
  'Snapshot of the original cook''s published name at save time. Never joined at read time.';

-- A saved copy cannot be published. Dropping this ONE constraint is the entire change if
-- republishing is later allowed, which is exactly why it is a constraint and not a rule
-- spread across the UI. Moderation does not exist yet and is the gate on opening Potluck.
alter table recipes add constraint saved_copies_are_not_publishable
  check (source_recipe_id is null or visibility <> 'public');

-- Saving the same recipe into the same vault twice is a no-op, not a duplicate. Per FAMILY,
-- not per user: the vault belongs to the household, so two members must not end up with two
-- copies of one recipe.
create unique index recipes_one_copy_per_family
  on recipes (family_id, source_recipe_id) where source_recipe_id is not null;

-- A copy reads "Saved from Mei's kitchen" until it is edited and "from Mei" afterwards, so
-- something has to notice the first edit.
--
-- READ THIS BEFORE CHANGING THE TRIGGER LIST BELOW. updateRecipe sends the recipes row and
-- the children down DIFFERENT paths, and an ingredient-only edit does not touch the recipes
-- row at all. A trigger on recipes alone would miss the edit most likely to be someone's
-- first: changing an amount. Any new child table that counts as "editing the recipe" needs
-- its own trigger here.
--
-- security definer on purpose: this is internal bookkeeping, not a permission. A family
-- member who may edit the ingredients but is not the recipe's author would otherwise have
-- their UPDATE silently filtered to zero rows by RLS, and the copy would never be marked.
-- It widens nothing: it only ever sets adapted_at, and only on a row that is already a copy.
create or replace function mark_recipe_adapted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'recipes' then
    v_id := new.id;
  elsif tg_op = 'DELETE' then
    v_id := old.recipe_id;
  else
    v_id := new.recipe_id;
  end if;

  update recipes set adapted_at = now()
  where id = v_id and source_recipe_id is not null and adapted_at is null;

  return null;
end; $$;

-- The when clause does two jobs. It stops the trigger's own adapted_at update from
-- re-firing it, and it excludes the lineage-setting update that save_recipe_to_vault runs
-- LAST, so recording where a copy came from is not itself an adaptation. Without that
-- exclusion every copy would be born adapted.
create trigger recipes_mark_adapted
after update on recipes
for each row
when (old.source_recipe_id is not distinct from new.source_recipe_id
      and old.adapted_at is not distinct from new.adapted_at)
execute function mark_recipe_adapted();

create trigger recipe_ingredients_mark_adapted
after insert or update or delete on recipe_ingredients
for each row execute function mark_recipe_adapted();

create trigger recipe_steps_mark_adapted
after insert or update or delete on recipe_steps
for each row execute function mark_recipe_adapted();
```

- [ ] **Step 4: Reset the database and re-run the tests**

Run:
```bash
npx supabase db reset
```
then the integration command from Step 2.
Expected: 4 passed. Then run the whole integration suite to prove the new triggers broke nothing:
```bash
SB_URL=http://127.0.0.1:54321 SB_ANON_KEY=$ANON SB_SERVICE_KEY=$SVC npm run test:int
```
Expected: 64 passed (60 existing plus 4 new).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0026_saved_recipes.sql tests/integration/saved_recipes.test.ts
git commit -m "feat: lineage columns and the two guards that make a saved copy safe"
```

---

### Task 2: The copy itself

**Files:**
- Create: `supabase/migrations/0027_save_recipe_to_vault.sql`
- Modify: `tests/integration/saved_recipes.test.ts` (append tests)

**Interfaces:**
- Consumes: the columns, constraint, index and trigger from Task 1.
- Produces: `save_recipe_to_vault(p_source uuid, p_family uuid) returns uuid`, callable as `supabase.rpc("save_recipe_to_vault", { p_source, p_family })`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/saved_recipes.test.ts`:

```ts
// A saver is a stranger: a different user, in a different family, with no access to the
// source family at all. That is the case the whole feature exists for.
async function saver(prefix: string) {
  const user = await makeUser(`${prefix}-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: user.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: user.id, role: "owner" });
  return { user, fam: fam! };
}

test("a stranger can save a public recipe, and the copy carries its children", async () => {
  const { rec } = await famWithRecipe("cp-src");
  await admin.from("recipe_ingredients").insert([
    { recipe_id: rec.id, position: 0, quantity: "2", unit: "cup", item: "flour",
      section: "Dough", optional: false },
    { recipe_id: rec.id, position: 1, quantity: "1", unit: "tsp", item: "salt" },
  ]);
  await admin.from("recipe_steps").insert({ recipe_id: rec.id, position: 0, text: "Mix" });

  const { user, fam } = await saver("cp-dst");
  const { data: newId, error } = await user.client.rpc("save_recipe_to_vault", {
    p_source: rec.id, p_family: fam.id,
  });
  expect(error).toBeNull();
  expect(newId).toBeTruthy();

  const { data: copy } = await admin.from("recipes").select("*").eq("id", newId).single();
  expect(copy!.family_id).toBe(fam.id);
  expect(copy!.author_id).toBe(user.id);
  expect(copy!.visibility).toBe("family");
  expect(copy!.source_recipe_id).toBe(rec.id);
  expect(copy!.adapted_at).toBeNull();

  const { data: ings } = await admin.from("recipe_ingredients")
    .select("*").eq("recipe_id", newId).order("position");
  expect(ings!.map((i: any) => i.item)).toEqual(["flour", "salt"]);
  // the section column proves the copy is not dropping columns it failed to name
  expect(ings![0].section).toBe("Dough");

  const { data: steps } = await admin.from("recipe_steps").select("*").eq("recipe_id", newId);
  expect(steps!.map((s: any) => s.text)).toEqual(["Mix"]);
});

test("a stranger cannot save a family or private recipe", async () => {
  for (const visibility of ["family", "private"]) {
    const { rec } = await famWithRecipe("cp-deny", visibility);
    const { user, fam } = await saver("cp-deny-dst");
    const { error } = await user.client.rpc("save_recipe_to_vault", {
      p_source: rec.id, p_family: fam.id,
    });
    expect(error, `visibility ${visibility} must not be savable`).not.toBeNull();
  }
});

// The whole reason a save copies instead of pointing: the original cook must not be able
// to empty someone else's vault.
test("deleting the original leaves the copy and its children intact", async () => {
  const { rec } = await famWithRecipe("cp-del");
  await admin.from("recipe_ingredients")
    .insert({ recipe_id: rec.id, position: 0, quantity: "1", unit: "cup", item: "rice" });
  const { user, fam } = await saver("cp-del-dst");
  const { data: newId } = await user.client.rpc("save_recipe_to_vault", {
    p_source: rec.id, p_family: fam.id,
  });

  await admin.from("recipes").delete().eq("id", rec.id);

  const { data: copy } = await admin.from("recipes")
    .select("source_recipe_id,source_cook_name").eq("id", newId).single();
  expect(copy).not.toBeNull();
  expect(copy!.source_recipe_id).toBeNull();      // FK cleared
  expect(copy!.source_cook_name).toBeTruthy();    // credit survives anyway
  const { data: ings } = await admin.from("recipe_ingredients")
    .select("item").eq("recipe_id", newId);
  expect(ings!.map((i: any) => i.item)).toEqual(["rice"]);
});

// Guards the no-fixed-column-list rule. replace_recipe_children has a fixed list and it has
// silently dropped a column twice (migrations 0009 and 0019 exist only because of it). If
// someone rewrites the copy to name columns, this test is what catches it.
test("a column added to recipe_ingredients is carried by the copy without touching the RPC",
  async () => {
    const { rec } = await famWithRecipe("cp-col");
    await admin.from("recipe_ingredients").insert({
      recipe_id: rec.id, position: 0, quantity: "1", unit: "cup", item: "oats",
      section: "Base", optional: true, alt_group: "g1",
    });
    const { user, fam } = await saver("cp-col-dst");
    const { data: newId } = await user.client.rpc("save_recipe_to_vault", {
      p_source: rec.id, p_family: fam.id,
    });
    const { data: ings } = await admin.from("recipe_ingredients")
      .select("*").eq("recipe_id", newId).single();
    // every column except the parent link must survive the copy
    expect(ings!.section).toBe("Base");
    expect(ings!.optional).toBe(true);
    expect(ings!.alt_group).toBe("g1");
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run the integration command from Task 1 Step 2.
Expected: 4 failed with `Could not find the function public.save_recipe_to_vault`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0027_save_recipe_to_vault.sql`:

```sql
-- 0027: copy a public recipe into the caller's family vault.
--
-- security invoker on purpose: RLS still decides what the caller may read and write, so
-- this function widens the QUERY and never the permissions. It is the same stance as
-- search_recipes in 0025.

-- READ THIS BEFORE EDITING THE INSERTS BELOW.
-- They deliberately name NO columns of recipes, recipe_ingredients or recipe_steps.
-- replace_recipe_children has a fixed column list and that list has silently dropped a
-- column twice: migration 0009 exists because 0006 dropped `section`, and 0019 had to
-- extend it again for `optional` and `alt_group`. A copy written the obvious way would be
-- a SECOND fixed list with the same failure mode. jsonb_populate_record copies whatever
-- columns exist and overrides only the few that must differ, so a future column is carried
-- automatically. Do not "tidy" this into an explicit column list.
create or replace function save_recipe_to_vault(p_source uuid, p_family uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_new uuid;
  v_cook text;
begin
  -- Only a public recipe is savable. Stated explicitly rather than left to RLS: RLS decides
  -- what the caller MAY read, and a member of the source family can read their own family
  -- rows, which must still not be savable through this path.
  insert into recipes
  select (jsonb_populate_record(null::recipes,
          to_jsonb(r) || jsonb_build_object(
            'id', gen_random_uuid(),
            'family_id', p_family,
            'author_id', auth.uid(),
            'visibility', 'family',
            'source_recipe_id', null,   -- set LAST, see below
            'source_cook_name', null,
            'adapted_at', null,
            'created_at', now(),
            'updated_at', now()))).*
  from recipes r
  where r.id = p_source and r.visibility = 'public'
  returning id into v_new;

  if v_new is null then
    raise exception 'recipe % is not available to save', p_source
      using errcode = 'insufficient_privilege';
  end if;

  insert into recipe_ingredients
  select (jsonb_populate_record(null::recipe_ingredients,
          to_jsonb(ri) || jsonb_build_object('recipe_id', v_new))).*
  from recipe_ingredients ri where ri.recipe_id = p_source;

  insert into recipe_steps
  select (jsonb_populate_record(null::recipe_steps,
          to_jsonb(rs) || jsonb_build_object('recipe_id', v_new))).*
  from recipe_steps rs where rs.recipe_id = p_source;

  -- Photos, tags, comments and the cook log deliberately do NOT travel. Photos are foldered
  -- by recipe id in storage and readable via can_read_recipe(folder), so a copy pointing at
  -- the source's file would go dark the moment the original was unpublished, which is the
  -- exact failure copying exists to prevent. Tag ids belong to the source family.
  select coalesce(p.public_name, p.display_name) into v_cook
  from recipes r join profiles p on p.id = r.author_id
  where r.id = p_source;

  -- LAST, and in its own statement. Copying the children above ran with source_recipe_id
  -- still null, so the adaptation trigger ignored them; and the recipes trigger's when
  -- clause excludes this update, because recording lineage is not an adaptation. Reorder
  -- this and every copy is born adapted.
  update recipes
     set source_recipe_id = p_source, source_cook_name = v_cook
   where id = v_new;

  return v_new;
end; $$;
```

- [ ] **Step 4: Reset and re-run**

Run `npx supabase db reset`, then the integration command.
Expected: 8 passed in this file, and the full `npm run test:int` at 68 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0027_save_recipe_to_vault.sql tests/integration/saved_recipes.test.ts
git commit -m "feat: copy a public recipe into a vault without naming its columns"
```

---

### Task 3: The API module

**Files:**
- Create: `src/lib/api/saves.ts`
- Modify: `src/lib/api/types.ts` (the `Recipe` type)
- Create: `src/lib/api/saves.test.ts`

**Interfaces:**
- Consumes: the `save_recipe_to_vault` RPC from Task 2.
- Produces:
  - `saveToVault(sourceRecipeId: string, familyId: string): Promise<string>` returning the new recipe id
  - `listSavedSourceIds(familyId: string, sourceIds: string[]): Promise<Set<string>>`
  - `Recipe` gains `source_recipe_id: string | null; source_cook_name: string | null; adapted_at: string | null`

- [ ] **Step 1: Add the three fields to the `Recipe` type**

In `src/lib/api/types.ts`, find the `Recipe` type and add:

```ts
  source_recipe_id: string | null;
  source_cook_name: string | null;
  adapted_at: string | null;
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/api/saves.test.ts`:

```ts
import { expect, test, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const inFilter = vi.fn();
vi.mock("./client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ in: (...a: any[]) => inFilter(...a) }) }) }),
  },
}));

beforeEach(() => {
  rpc.mockReset();
  inFilter.mockReset();
});

test("saveToVault returns the new recipe id", async () => {
  const { saveToVault } = await import("./saves");
  rpc.mockResolvedValue({ data: "new-id", error: null });
  await expect(saveToVault("src-1", "fam-1")).resolves.toBe("new-id");
  expect(rpc).toHaveBeenCalledWith("save_recipe_to_vault", {
    p_source: "src-1", p_family: "fam-1",
  });
});

test("saveToVault throws the database message", async () => {
  const { saveToVault } = await import("./saves");
  rpc.mockResolvedValue({ data: null, error: { message: "not available to save" } });
  await expect(saveToVault("src-1", "fam-1")).rejects.toThrow("not available to save");
});

// One call for the whole page, never one per card. Potluck already holds this rule for
// bylines and it is pinned by a test there for the same reason.
test("listSavedSourceIds asks once for every id and returns a set", async () => {
  const { listSavedSourceIds } = await import("./saves");
  inFilter.mockResolvedValue({
    data: [{ source_recipe_id: "a" }, { source_recipe_id: "c" }], error: null,
  });
  const got = await listSavedSourceIds("fam-1", ["a", "b", "c"]);
  expect(got).toEqual(new Set(["a", "c"]));
  expect(inFilter).toHaveBeenCalledTimes(1);
  expect(inFilter).toHaveBeenCalledWith("source_recipe_id", ["a", "b", "c"]);
});

test("listSavedSourceIds does not query at all for an empty list", async () => {
  const { listSavedSourceIds } = await import("./saves");
  const got = await listSavedSourceIds("fam-1", []);
  expect(got).toEqual(new Set());
  expect(inFilter).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/api/saves.test.ts`
Expected: FAIL, cannot resolve `./saves`.

- [ ] **Step 4: Write the module**

Create `src/lib/api/saves.ts`:

```ts
import { supabase } from "./client";

// Copy a public recipe into a family vault. The database does the copying, so a future
// ingredient column is carried without a change here: see 0027_save_recipe_to_vault.sql.
export async function saveToVault(sourceRecipeId: string, familyId: string): Promise<string> {
  const { data, error } = await supabase.rpc("save_recipe_to_vault", {
    p_source: sourceRecipeId,
    p_family: familyId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// Which of these recipes are already in the family's vault. ONE call for a whole page of
// cards, never one per card: the same rule Potluck already follows for bylines.
export async function listSavedSourceIds(
  familyId: string,
  sourceIds: string[],
): Promise<Set<string>> {
  if (!sourceIds.length) return new Set();
  const { data, error } = await supabase
    .from("recipes")
    .select("source_recipe_id")
    .eq("family_id", familyId)
    .in("source_recipe_id", sourceIds);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: { source_recipe_id: string }) => r.source_recipe_id));
}
```

Check the import path for the Supabase client against a sibling such as `src/lib/api/recipes.ts` and match it exactly; if that file imports from `"./client"`, keep the line above as written.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/lib/api/saves.test.ts` then `npx tsc -b`
Expected: 4 passed, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/saves.ts src/lib/api/saves.test.ts src/lib/api/types.ts
git commit -m "feat: the save-to-vault API seam"
```

---

### Task 4: The save button on a recipe card

**Files:**
- Modify: `src/components/RecipeCard.tsx`
- Modify: `src/index.css` (or wherever `.plate-card` is defined; find it with `grep -rn "plate-card" src --include=*.css`)
- Create: `src/components/RecipeCard.save.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `RecipeCard` accepts `onSave?: () => void` and `saved?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/components/RecipeCard.save.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import RecipeCard from "./RecipeCard";

const recipe: any = {
  id: "r1", family_id: "f1", author_id: "u1", title: "Dal", story: null, provenance: null,
  servings: 2, prep_minutes: null, cook_minutes: null, visibility: "public",
  source_url: null, created_at: "", updated_at: "",
  source_recipe_id: null, source_cook_name: null, adapted_at: null,
};

const draw = (props: any = {}) =>
  render(<MemoryRouter><ul><RecipeCard recipe={recipe} {...props} /></ul></MemoryRouter>);

// RecipeList passes no onSave, so the vault grid must be untouched by this change.
test("no save button unless onSave is given", () => {
  draw();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

// A grid of buttons all named "Save" is unusable with a screen reader.
test("the button names the recipe it saves", async () => {
  const onSave = vi.fn();
  draw({ onSave });
  const btn = screen.getByRole("button", { name: /save dal to my vault/i });
  await userEvent.click(btn);
  expect(onSave).toHaveBeenCalledTimes(1);
});

test("an already saved card says so and cannot be clicked again", async () => {
  const onSave = vi.fn();
  draw({ onSave, saved: true });
  const btn = screen.getByRole("button", { name: /in your vault/i });
  expect(btn).toBeDisabled();
  await userEvent.click(btn);
  expect(onSave).not.toHaveBeenCalled();
});

// A button inside an anchor is invalid HTML and steals the card's click target. The card
// comment records the other half of this: a sibling in normal FLOW became its own grid
// cell, which is why the button is positioned out of flow instead.
test("the button is not inside the card's link", () => {
  draw({ onSave: vi.fn() });
  const link = screen.getByRole("link");
  expect(link.querySelector("button")).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/RecipeCard.save.test.tsx`
Expected: 3 of 4 fail (the first passes already, because there is no button at all yet).

- [ ] **Step 3: Add the props and the button**

In `src/components/RecipeCard.tsx`, add to the destructured props and the type:

```tsx
  // Rendered only when a caller passes onSave, so RecipeList (the vault grid, the other
  // consumer) is untouched: a recipe already in your vault has nothing to save.
  onSave,
  saved = false,
```
```tsx
  onSave?: () => void;
  saved?: boolean;
```

and inside the `<li>`, AFTER the closing `</Link>`:

```tsx
      {onSave && (
        // A SIBLING of the link, never a child: a button inside an anchor is invalid and
        // steals the click target. It is positioned out of flow by .card-save, because a
        // sibling in normal flow became its own grid cell, which is the bug the byline
        // prop above was introduced to fix.
        <button
          type="button"
          className="card-save"
          disabled={saved}
          onClick={onSave}
          aria-label={saved ? `${recipe.title} is in your vault` : `Save ${recipe.title} to my vault`}
        >
          {saved ? "In your vault" : "Save"}
        </button>
      )}
```

- [ ] **Step 4: Position it out of flow**

Find the `.plate-card` rule (`grep -rn "plate-card" src --include=*.css`) and add beside it:

```css
/* Out of flow on purpose. In normal flow this button became its own cell of the plate
   grid, the same bug the byline prop was introduced to fix. */
.plate-card { position: relative; }
.card-save {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
```

Match the surrounding file's existing button styling for colour, radius and font size rather than inventing new values; the visual pass on these surfaces is deliberately last.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/RecipeCard.save.test.tsx` and then `npx vitest run src/components/RecipeCard`
Expected: all pass, including the pre-existing RecipeCard tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/RecipeCard.tsx src/components/RecipeCard.save.test.tsx src/index.css
git commit -m "feat: a save button on a recipe card, outside the card's link"
```

---

### Task 5: Wire the button into Potluck

**Files:**
- Modify: `src/pages/Potluck.tsx`
- Modify: `src/pages/Potluck.test.tsx`

**Interfaces:**
- Consumes: `saveToVault` and `listSavedSourceIds` from Task 3; `onSave` / `saved` from Task 4.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test**

Read `src/pages/Potluck.test.tsx` first and copy its existing mock setup rather than inventing a new one. Append:

```tsx
// One call for the page, never one per card. The byline rule above exists for the same
// reason and is pinned the same way; a per-card query is an N+1 that only shows up in
// production, where a feed has more than two cards.
test("asks once for which recipes are already saved, not once per card", async () => {
  render(<MemoryRouter><Potluck /></MemoryRouter>);
  await screen.findByText("Dal");
  expect(listSavedSourceIds).toHaveBeenCalledTimes(1);
});

test("saving a card marks it as in your vault without a reload", async () => {
  render(<MemoryRouter><Potluck /></MemoryRouter>);
  const btn = await screen.findByRole("button", { name: /save dal to my vault/i });
  await userEvent.click(btn);
  expect(saveToVault).toHaveBeenCalledWith("r1", "f1");
  expect(await screen.findByRole("button", { name: /is in your vault/i })).toBeDisabled();
});
```

Add to the file's mocks:

```tsx
const saveToVault = vi.fn().mockResolvedValue("new-id");
const listSavedSourceIds = vi.fn().mockResolvedValue(new Set<string>());
vi.mock("../lib/api/saves", () => ({
  saveToVault: (...a: any[]) => saveToVault(...a),
  listSavedSourceIds: (...a: any[]) => listSavedSourceIds(...a),
}));
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/pages/Potluck.test.tsx`
Expected: both new tests fail, no save button in the tree.

- [ ] **Step 3: Wire it up**

In `src/pages/Potluck.tsx`, add state and one lookup after the recipes load:

```tsx
const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
```

After the recipes are set, in the SAME effect that already loads them (do not add a second effect keyed on the recipe list, which would re-run on every render of a new array):

```tsx
  // ONE call for the page. Same rule as the bylines above: a per-card query is an N+1
  // that only bites once a feed has more than a couple of cards.
  const saved = activeFamily
    ? await listSavedSourceIds(activeFamily.id, rows.map((r) => r.id))
    : new Set<string>();
  setSavedIds(saved);
```

and on the card:

```tsx
  onSave={activeFamily ? () => handleSave(recipe.id) : undefined}
  saved={savedIds.has(recipe.id)}
```

with:

```tsx
  async function handleSave(id: string) {
    if (!activeFamily) return;
    await saveToVault(id, activeFamily.id);
    // Mark it locally rather than refetching the page: the only thing that changed is
    // this one card's state.
    setSavedIds((prev) => new Set(prev).add(id));
  }
```

Use `useFamily()` for `activeFamily` if the page does not already have it. A user with no family gets no button, which is correct: they have nowhere to save.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/pages/Potluck.test.tsx`
Expected: all pass, including the existing byline and Following tests.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Potluck.tsx src/pages/Potluck.test.tsx
git commit -m "feat: save a recipe straight from a Potluck card"
```

---

### Task 6: The recipe page button and the credit line

**Files:**
- Modify: `src/pages/RecipeDetail.tsx`
- Modify: `src/pages/RecipeDetail.test.tsx`

**Interfaces:**
- Consumes: `saveToVault` from Task 3; the three `Recipe` fields from Task 3.
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/RecipeDetail.test.tsx` (reuse the existing `getRecipe` mock pattern with `mockResolvedValueOnce`):

```tsx
// Lineage is a fact and cannot be cleared, but a recipe you have rewritten should read as
// yours, so the header shrinks to a note after the first edit.
test("an untouched copy says where it came from, in the header", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, source_recipe_id: "src-1", source_cook_name: "Mei",
              adapted_at: null },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/saved from Mei's kitchen/i)).toBeInTheDocument();
});

test("an adapted copy keeps the credit but only as a quiet note", async () => {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: { ...baseRecipe, source_recipe_id: "src-1", source_cook_name: "Mei",
              adapted_at: "2026-09-28T00:00:00Z" },
    ingredients: [], steps: [], photos: [],
  } as any);
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/from Mei/i)).toBeInTheDocument();
  expect(screen.queryByText(/saved from Mei's kitchen/i)).not.toBeInTheDocument();
});

test("a recipe that is nobody's copy shows no credit line", async () => {
  render(
    <MemoryRouter initialEntries={["/recipes/r1"]}>
      <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Dal");
  expect(screen.queryByText(/from /i)).not.toBeInTheDocument();
});
```

Extract the existing inline recipe object in the file's `getRecipe` mock into a `baseRecipe` const so these tests can spread it, and add the three new fields (`source_recipe_id: null, source_cook_name: null, adapted_at: null`) to it.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/pages/RecipeDetail.test.tsx`
Expected: the two credit tests fail.

- [ ] **Step 3: Render the credit line**

In `src/pages/RecipeDetail.tsx`, just below the title:

```tsx
{recipe.source_cook_name && (
  recipe.adapted_at
    // Adapted: the title stands alone and the credit becomes a quiet note. Permanent
    // either way, because lineage is a fact, not a decoration.
    ? <p className="credit-quiet">from {recipe.source_cook_name}</p>
    : <p className="credit">Saved from {recipe.source_cook_name}'s kitchen</p>
)}
```

- [ ] **Step 4: Add the save button**

Reuse the same condition Potluck uses. The button is hidden when the viewer is the author, when the recipe is already in their active family, or when they have no family:

```tsx
{recipe.visibility === "public" && activeFamily && recipe.family_id !== activeFamily.id && (
  <button type="button" onClick={handleSave} disabled={savedId !== null}>
    {savedId ? "In your vault" : "Save to my vault"}
  </button>
)}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/pages/RecipeDetail.test.tsx` then `npx tsc -b && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/pages/RecipeDetail.tsx src/pages/RecipeDetail.test.tsx
git commit -m "feat: save from the recipe page, and show where a copy came from"
```

---

### Task 7: Deploy the migrations, then the frontend

**Files:** none.

- [ ] **Step 1: Push the migrations to cloud FIRST**

```bash
npx supabase db push
```

**Order matters and getting it backwards has broken production here before.** Cloudflare deploys the frontend automatically on push to master; Supabase deploys nothing. A frontend that calls `save_recipe_to_vault` before the function exists breaks every save.

- [ ] **Step 2: Confirm the migrations landed**

```bash
npx supabase migration list
```
Expected: `0026` and `0027` present both locally and remotely.

- [ ] **Step 3: Push the branch and let Cloudflare build**

- [ ] **Step 4: Verify in the browser, signed in, on production**

Open Potluck, save a recipe from a card, confirm the button becomes "In your vault", open the copy in the vault and confirm it says "Saved from ...'s kitchen", then edit one ingredient amount and confirm the header becomes the quiet note. Green tests have missed real bugs here repeatedly; the browser is the check that counts.

- [ ] **Step 5: Update `HANDOVER.md` and mark the spec shipped**

Set the spec's `Status:` to shipped, update the handover's head commit, test counts and next-steps list.

## Self-Review

**Spec coverage.** Every spec section maps to a task: data model and both guards to Task 1; the copy and its no-fixed-column-list rule to Task 2; the API seam to Task 3; the card button, its placement and its accessible name to Task 4; the one-query-per-page rule to Task 5; the two credit-line states and the page button to Task 6; the deploy order and browser check to Task 7. The three "does not travel" items (photos, tags, comments) are enforced by the RPC simply not copying them, and the photo reasoning is recorded as a comment at the copy.

**Known gaps, deliberate.** There is no test that tags and comments fail to travel; the RPC does not mention them, so a test would assert the absence of code that does not exist. The "no family" case is covered by the button being absent rather than by its own test.

**Type consistency.** `saveToVault(sourceRecipeId, familyId)` and `listSavedSourceIds(familyId, sourceIds)` keep the same signatures in Tasks 3, 5 and 6. `onSave` / `saved` keep the same names in Tasks 4, 5 and 6. The RPC parameter names `p_source` and `p_family` match between Task 2's SQL and Task 3's call.
