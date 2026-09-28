# Potluck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in Potluck space that browses and searches every public recipe, narrowable to the cooks you follow, plus the two hardening jobs and the reachability fix sub-project 1 left open.

**Architecture:** Follows are a private join table read only by the follower, so Following is a client-side filter over rows RLS already permits, needing no new view and no server-side join. Public search reuses the existing `search_recipes` RPC with a nullable family id rather than a second matching rule. The feed paginates.

**Tech Stack:** React 19 + React Router 6, Supabase (Postgres + RLS), Vitest, oxlint.

**Spec:** `docs/superpowers/specs/2026-09-27-potluck-feed-and-follows-design.md`

## Global Constraints

- **ALL supabase access lives in `src/lib/api/`.** Nothing outside it imports the client.
- **Verify with `npx tsc -b && npm test`** (NOT `tsc --noEmit`). Migrations: `npx supabase db reset`. Integration: `npm run test:int`, which needs `SB_URL` / `SB_ANON_KEY` / `SB_SERVICE_KEY` exported from `npx supabase status -o env` (the CI job does this; a local shell does not, and without them all 10 files fail inside `makeUser`).
- **`npm run lint` must pass.**
- **Apply migrations to cloud BEFORE the frontend that needs them.** Check `npx supabase migration list --linked` for `"remote":""`.
- **No em dashes or en dashes** anywhere.
- **A policy's definition is the LAST migration that touches it.** Grep every migration for the policy name before claiming what it does. Sub-project 1 lost time to reading `0003` alone.
- **A subquery inside an RLS policy runs as the CALLER.** Reading another table from one needs a `security definer` function, or it is false for anyone without a policy on that table.
- **Run every policy test red first.**
- Cloud is currently at `0022`. Local Supabase may still be running from the last session.

---

### Task 1: The follows table

**Files:**
- Create: `supabase/migrations/0023_follows.sql`
- Create: `tests/integration/follows.test.ts`

**Interfaces:**
- Consumes: `is_published_cook(uuid)` from `0022`.
- Produces: table `follows(follower_id, cook_id, created_at)` with policies `follows_read`, `follows_write`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/follows.test.ts`. Build families with two `admin` inserts (there is no `create_family_with_owner` RPC), and give each cook a **unique handle per run** (`cook${Date.now()}`), because `handle` is UNIQUE and a hardcoded one passes on a fresh database then silently fails on every rerun:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

describe("follows", () => {
  let me: Awaited<ReturnType<typeof makeUser>>;
  let cook: Awaited<ReturnType<typeof makeUser>>;
  let quiet: Awaited<ReturnType<typeof makeUser>>;
  const anon = anonClient();
  const handle = `cook${Date.now()}`;

  beforeAll(async () => {
    me = await makeUser(`me-${Date.now()}@test.dev`);
    cook = await makeUser(`cook-${Date.now()}@test.dev`);
    quiet = await makeUser(`quiet-${Date.now()}@test.dev`);
    await admin.from("profiles").update({ handle, public_name: "A Cook" }).eq("id", cook.id);
  });

  it("lets you follow a published cook", async () => {
    const { error } = await me.client.from("follows")
      .insert({ follower_id: me.id, cook_id: cook.id });
    expect(error).toBeNull();
  });

  it("refuses a cook who has not published", async () => {
    const { error } = await me.client.from("follows")
      .insert({ follower_id: me.id, cook_id: quiet.id });
    expect(error?.code).toBe("42501");
  });

  it("refuses following yourself", async () => {
    const { error } = await me.client.from("follows")
      .insert({ follower_id: me.id, cook_id: me.id });
    // The check constraint fires before RLS would, so this is 23514, not 42501.
    expect(error).not.toBeNull();
  });

  it("refuses inserting a follow on someone else's behalf", async () => {
    const { error } = await cook.client.from("follows")
      .insert({ follower_id: me.id, cook_id: cook.id });
    expect(error?.code).toBe("42501");
  });

  it("does not let another user read your follows", async () => {
    const { data } = await cook.client.from("follows").select("cook_id").eq("follower_id", me.id);
    expect(data).toEqual([]);
  });

  it("does not let an anonymous visitor read follows at all", async () => {
    const { data } = await anon.from("follows").select("cook_id");
    expect(data).toEqual([]);
  });

  it("lets you unfollow", async () => {
    await me.client.from("follows").delete().eq("follower_id", me.id).eq("cook_id", cook.id);
    const { data } = await me.client.from("follows").select("cook_id").eq("follower_id", me.id);
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it red**

```bash
npm run test:int -- follows
```
Expected: every test fails, because relation `follows` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0023_follows.sql` with exactly the SQL in the spec's "Data model" section, comments included.

- [ ] **Step 4: Apply and verify**

```bash
npx supabase db reset
```
Then `npm run test:int -- follows`. Expected: 7 pass.

- [ ] **Step 5: Whole suite**

`npm run test:int`. Expected: all previous tests plus these.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0023_follows.sql tests/integration/follows.test.ts
git commit -m "feat: follows, private to the follower"
```

---

### Task 2: The error_log circuit breaker

**Files:**
- Create: `supabase/migrations/0024_error_log_cap.sql`
- Create: `tests/integration/error_log_cap.test.ts`

**Interfaces:**
- Produces: `error_log_cap()` trigger function and the `error_log_rate_limit` trigger.

- [ ] **Step 1: Write the failing test**

`error_log` has **no select policy**, so the test must count rows with the `admin` client, and an anon insert must NOT chain `.select()` (that makes it `INSERT ... RETURNING`, which needs read permission and fails with `42501` for reasons unrelated to the cap). This exact mistake produced a false "anon cannot write" result during design.

```ts
import { describe, it, expect } from "vitest";
import { admin, anonClient } from "./helpers";

describe("error_log rate limit", () => {
  it("drops rows past the cap without failing the caller", async () => {
    const anon = anonClient();
    const context = `cap-${Date.now()}`;
    const rows = Array.from({ length: 150 }, () => ({ context, message: "flood" }));
    // One statement, 150 rows: the trigger is FOR EACH ROW, so the cap applies within it.
    const { error } = await anon.from("error_log").insert(rows);
    expect(error).toBeNull();

    const { count } = await admin.from("error_log")
      .select("id", { count: "exact", head: true }).eq("context", context);
    expect(count).toBeLessThanOrEqual(100);
    expect(count).toBeGreaterThan(0);
  });

  it("still records an ordinary single failure", async () => {
    const anon = anonClient();
    const context = `single-${Date.now()}`;
    const { error } = await anon.from("error_log").insert({ context, message: "one" });
    expect(error).toBeNull();
    const { count } = await admin.from("error_log")
      .select("id", { count: "exact", head: true }).eq("context", context);
    expect(count).toBe(1);
  });
});
```

**The second test matters more than the first.** A cap that also silences honest single errors would make the whole monitoring feature useless, and it would look like it worked.

- [ ] **Step 2: Run it red**

`npm run test:int -- error_log_cap`. Expected: the first test fails (all 150 rows land); the second passes already and must keep passing.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0024_error_log_cap.sql` with the trigger from the spec, plus retention:

```sql
-- Retention as well as a rate limit: the cap bounds a burst, this bounds the table over time.
-- Folded into the same trigger rather than needing pg_cron, which this project does not use.
-- Runs at most once a minute's worth of inserts, which is cheap on a table this small.
delete from error_log where created_at < now() - interval '90 days';
```

Put the delete inside `error_log_cap()` guarded so it does not run on every row (for example only when the per-minute count is zero), or as a separate statement in the migration plus a documented manual prune. **Pick one and say which in a comment.** Do not run an unguarded delete per row.

- [ ] **Step 4: Apply, verify, whole suite, commit**

`npx supabase db reset`, then `npm run test:int`. Commit as `fix: cap error_log inserts so an anonymous flood cannot grow the table`.

---

### Task 3: Public search, sharing one matching rule

**Files:**
- Create: `supabase/migrations/0025_public_search.sql`
- Modify: `tests/integration/search_recipes.test.ts`

**Interfaces:**
- Produces: `search_recipes(p_family_id uuid, p_search text, p_tag_id uuid)` where a NULL `p_family_id` means "public recipes across all families".

- [ ] **Step 1: Read the existing function first**

`sed -n '20,60p' supabase/migrations/0010_fuzzy_search.sql`. The family branch must keep behaving identically. `0009` exists only because `0006` redefined an RPC and silently dropped a column.

- [ ] **Step 2: Write the failing tests**

Append to `tests/integration/search_recipes.test.ts`: with a null family id the RPC returns public recipes from a family you do not belong to, does NOT return `family` or `private` recipes, and still honours the fuzzy match. Add one regression test asserting the existing family-scoped call returns exactly what it returns today.

- [ ] **Step 3: Run red**, `npm run test:int -- search_recipes`. The new null-family tests fail; every existing test in that file must still pass.

- [ ] **Step 4: Write the migration**

```sql
-- Redefined so public search and family search share ONE matching rule and one set of
-- trigram indexes. A second search function is how the two silently drift apart.
-- The family branch is unchanged on purpose; the only new behaviour is p_family_id null.
-- SECURITY INVOKER is retained, so RLS still decides what the caller may actually see.
create or replace function search_recipes(p_family_id uuid, p_search text, p_tag_id uuid default null)
returns setof recipes
language sql stable security invoker set search_path = public, extensions as $$
  with q as (select nullif(trim(coalesce(p_search, '')), '') as term)
  select r.*
  from recipes r, q
  where (
      -- null family id means the public catalogue rather than one household's vault
      (p_family_id is null and r.visibility = 'public')
      or r.family_id = p_family_id
    )
    and (p_tag_id is null or exists (
      select 1 from recipe_tags rt where rt.recipe_id = r.id and rt.tag_id = p_tag_id))
    and (
      q.term is null
      or r.title % q.term
      or r.title ilike '%' || q.term || '%'
      or exists (
        select 1 from recipe_ingredients i
        where i.recipe_id = r.id
          and (i.item % q.term or i.item ilike '%' || q.term || '%'))
    )
  order by
$$;
```

**Copy the existing `order by` clause verbatim from `0010`.** Do not rewrite it from memory.

- [ ] **Step 5: Apply, verify, whole suite, commit.**

---

### Task 4: The follows API

**Files:**
- Create: `src/lib/api/follows.ts`
- Create: `src/lib/api/follows.test.ts`

**Interfaces:**
- Produces:
  - `listFollowedCookIds(): Promise<string[]>`
  - `isFollowing(cookId: string): Promise<boolean>`
  - `follow(cookId: string): Promise<void>`
  - `unfollow(cookId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** in `src/lib/api/follows.test.ts`, mocking `../supabaseClient` in the style `src/lib/api/profile.test.ts` already uses: `follow` sends both `follower_id` and `cook_id`; `unfollow` filters on both; `listFollowedCookIds` returns `[]` rather than throwing when signed out.

- [ ] **Step 2: Run red**, `npm test -- follows`.

- [ ] **Step 3: Implement.** Every function reads the user id via `supabase.auth.getUser()` first, matching `src/lib/api/profile.ts`. `follower_id` is always sent explicitly even though RLS enforces it, because the row needs the value and the policy is the guard, not the source.

- [ ] **Step 4: Verify** `npm test -- follows`, then `npx tsc -b && npm run lint`. **Commit.**

---

### Task 5: The feed queries

**Files:**
- Modify: `src/lib/api/recipes.ts`, `src/lib/api/recipes.test.ts`
- Modify: `src/lib/api/profile.ts`, `src/lib/api/profile.test.ts`

**Interfaces:**
- Produces:
  - `listPublicRecipes(opts: { search?: string; authorIds?: string[]; limit?: number; offset?: number }): Promise<Recipe[]>`
  - `getBylines(recipeIds: string[]): Promise<Map<string, Byline>>`

- [ ] **Step 1: Write the failing tests.** `listPublicRecipes` with a `search` goes through the `search_recipes` RPC with `p_family_id: null`; without a search it queries `recipes` filtered on `visibility=public`, ordered by `created_at` descending, with `range(offset, offset + limit - 1)`. `authorIds` adds an `in` filter, and an **empty** `authorIds` array returns `[]` without any request at all (following nobody must not degrade into showing everybody).
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.** `getBylines` does ONE `public_recipe_bylines` query with an `in` filter and returns a Map keyed by `recipe_id`; never one request per card.
- [ ] **Step 4: Verify and commit.**

---

### Task 6: The Potluck page, route and nav

**Files:**
- Create: `src/pages/Potluck.tsx`, `src/pages/Potluck.test.tsx`
- Modify: `src/routes.tsx`, `src/components/AppLayout.tsx`, `src/components/AppLayout.test.tsx`
- Modify: `src/components/RecipeCard.tsx`

**Interfaces:**
- Consumes: Tasks 4 and 5.
- Produces: route `/potluck` inside `RequireAuth`; `RecipeCard` gains `showVisibility?: boolean` defaulting to `true`.

- [ ] **Step 1: Write the failing tests.** Potluck renders a grid of public recipes with their bylines; the `Following` toggle with zero follows renders an empty state naming the fix and NOT the full list; searching calls `listPublicRecipes` with the term; "Show more" raises the offset.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
  - `/potluck` goes in the **guarded** route group, not the public one.
  - `AppLayout`'s signed-in nav gains `Potluck` after `My Kitchen`. The signed-out header is unchanged and must stay unchanged; its existing test asserts that.
  - Page size 24, "Show more" mirroring `PEEK_DAYS` in `src/pages/MyKitchen.tsx`.
  - Pass `showVisibility={false}` to `RecipeCard` here: every card in Potluck is public, so the chip is the same word on every tile.
- [ ] **Step 4: Verify and commit.**

---

### Task 7: The follow button

**Files:**
- Modify: `src/pages/CookPage.tsx`, `src/pages/CookPage.test.tsx`

- [ ] **Step 1: Write the failing tests.** Signed out: no button. Your own page (the cook's id equals your user id): no button. Another cook, not followed: "Follow", and clicking calls `follow` and flips to "Following". Followed: "Following", and clicking calls `unfollow`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** using `useAuth()` for the signed-in check. The existing three CookPage tests must keep passing; add the auth mock defaulting to signed out so they are unaffected.
- [ ] **Step 4: Verify and commit.**

---

### Task 8: The reachability fix

**Files:**
- Modify: `src/pages/Settings.tsx`, `src/pages/Settings.test.tsx`
- Modify: `src/pages/RecipeDetail.tsx`, `src/pages/RecipeDetail.test.tsx`

- [ ] **Step 1: Write the failing tests.** Settings shows a "View my public page" link to `/cooks/:handle` once a handle exists, and no link when it does not. A visitor's byline on a recipe links to `/cooks/:handle` when the byline carries one, and stays plain text when `handle` is null.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.** The null-handle case is not hypothetical: `public_recipe_bylines` left-joins the profile precisely so a recipe published by a cook with no handle still renders.
- [ ] **Step 4: Verify and commit.**

---

## Deploy, in this order

**The order is not advice.** Shipping a frontend ahead of its migration broke recipe saving in production on 2026-09-27.

- [ ] `npx supabase db push` (this is Aayush's to run; it was refused to the agent as a production deploy)
- [ ] `npx supabase migration list --linked` shows `0025` remote with no `"remote":""` rows
- [ ] Confirm the cloud project's `max_rows` matches local (1000), in the dashboard API settings
- [ ] Push to master
- [ ] Verify live, signed IN: Potluck lists the public recipe with its byline, search finds it, Following with no follows shows the empty state
- [ ] Verify live, signed OUT: `/potluck` bounces to `/signin`, while a public recipe page and `/cooks/yusha` still render
- [ ] Verify a second account can follow `yusha` and that the Following filter then shows that recipe

## Self-review notes

**Spec coverage.** Follows (1), error_log cap (2), public search (3), follows API (4), feed queries (5), Potluck page and nav (6), follow button (7), reachability (8), `max_rows` (deploy checklist). The accepted scraping residual needs no task by definition.

**Paths checked against the repo**, which is this project's recurring plan failure: `src/pages/MyKitchen.tsx` has `PEEK_DAYS`; `is_published_cook` exists in `0022`; `RecipeCard` takes `{ recipe, photoUrl }` and currently renders a visibility chip unconditionally, hence the new prop; `search_recipes` really is `(p_family_id, p_search, p_tag_id)`; `MAX_REPORTS = 20` is the client cap in `errorLog.ts`.

**Known traps carried forward.** Adding `useAuth()` to a component breaks existing tests that do not mock `AuthContext` (Tasks 6 and 7). Every hook must sit above a component's early returns. A new colour inside a `.plate` is this repo's invisible-text bug, and `.plate h1, h2, h3` is now the rule that covers headings.
