# Family Recipes v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private multi-family recipe vault (React + Supabase) where families store recipes with photos, story, provenance, in-family comments, a Cook Mode, and easy entry via a guided form or AI pre-fill, with a per-recipe visibility flag that seeds a later public feed.

**Architecture:** React (Vite) SPA talks to Supabase (Postgres + Auth + Storage). Row-Level Security enforces Private/Family/Public visibility at the database. All data access is isolated in `src/lib/api/` so the app never calls `supabase.from()` directly, making a future Node/Express + Postgres backend a bounded swap. One Supabase Edge Function (`extract-recipe`) is the only holder of a model API key and turns raw input into structured recipe JSON.

**Tech Stack:** React 18 + Vite + TypeScript, React Router, Supabase (JS client v2, local CLI for migrations + Edge Functions), Vitest + React Testing Library, Supabase local stack (Docker) for RLS integration tests.

**Spec:** `docs/superpowers/specs/2026-09-16-family-recipes-design.md`

## Global Constraints

- **No em dashes or en dashes** in any code comments, commit messages, docs, or UI copy. Use commas, colons, parentheses, or two sentences. (User global rule.)
- **Never call `supabase.from()`, `supabase.auth`, `supabase.storage`, or `supabase.functions` outside `src/lib/api/`.** Components and pages import typed functions from `src/lib/api/`. This is the portability seam.
- **RLS is defense in depth, not the only check.** Every write path also validates membership in the api layer so the future Express backend inherits the same rules.
- **The AI never saves.** `extract-recipe` returns a draft; a human reviews the form and saves. Unknown fields come back blank, never fabricated.
- **A recipe lives in exactly one `family_id`.** No cross-family recipes in v1 (fork is phase 2).
- **Visibility enum is exactly** `private | family | public`.
- **TDD:** every task writes a failing test first, then the minimal code to pass. Commit at the end of each task.
- **TypeScript strict mode on.** No `any` in the api layer.

---

## File Structure

```
family-recipes/
  supabase/
    migrations/                 # SQL migrations (schema + RLS)
    functions/extract-recipe/   # Edge Function (Deno)
    config.toml
  src/
    lib/
      supabaseClient.ts         # the ONE place the client is created
      api/
        auth.ts                 # sign in/up/out, current user
        families.ts             # create/join/list/switch, invite codes
        recipes.ts              # CRUD, list, search
        ingredients.ts          # nested writes for a recipe
        steps.ts
        comments.ts
        photos.ts               # storage upload + row
        tags.ts
        extract.ts              # calls the extract-recipe function
        types.ts                # shared row/DTO types
    context/
      AuthContext.tsx           # session + current user
      FamilyContext.tsx         # active family + switcher state
    components/                 # dumb, reusable UI
    pages/                      # route-level screens
    routes.tsx
    main.tsx
  tests/
    integration/                # RLS tests against local Supabase
  .env.local.example
  vitest.config.ts
```

---

## Phase 0 — Project setup

### Task 0.1: Scaffold Vite React TS app + Supabase local

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`
- Create: `.env.local.example`, `.gitignore`
- Create: `supabase/config.toml` (via `supabase init`)

**Interfaces:**
- Produces: a running dev server and an initialized Supabase local project.

- [ ] **Step 1: Scaffold the app**

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install @supabase/supabase-js react-router-dom
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @testing-library/user-event
```

- [ ] **Step 2: Init Supabase local (requires Docker + Supabase CLI)**

```bash
npx supabase init
```

- [ ] **Step 3: Add `.gitignore` and env example**

`.gitignore` must include:
```
node_modules
dist
.env.local
supabase/.temp
.env
```

`.env.local.example`:
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-local-anon-key
```

- [ ] **Step 4: Configure Vitest**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
});
```
Create `src/test-setup.ts`:
```ts
import "@testing-library/jest-dom";
```
Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 5: Smoke test**

Create `src/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import App from "./App";
test("app renders", () => {
  render(<App />);
  expect(screen.getByText(/family recipes/i)).toBeInTheDocument();
});
```
Set `App.tsx` to render `<h1>Family Recipes</h1>`.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite React TS app and Supabase local"
```

### Task 0.2: The single Supabase client + env guard

**Files:**
- Create: `src/lib/supabaseClient.ts`
- Test: `src/lib/supabaseClient.test.ts`

**Interfaces:**
- Produces: `export const supabase` (typed `SupabaseClient`). The ONLY module that constructs the client.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
describe("supabaseClient", () => {
  it("throws a clear error when env vars are missing", async () => {
    const prev = import.meta.env.VITE_SUPABASE_URL;
    // @ts-expect-error test override
    import.meta.env.VITE_SUPABASE_URL = "";
    await expect(import("./supabaseClient?bust=" + Date.now())).rejects.toThrow(/VITE_SUPABASE_URL/);
    // @ts-expect-error restore
    import.meta.env.VITE_SUPABASE_URL = prev;
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test src/lib/supabaseClient.test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement**

```ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url) throw new Error("VITE_SUPABASE_URL is not set");
if (!anonKey) throw new Error("VITE_SUPABASE_ANON_KEY is not set");

export const supabase = createClient(url, anonKey);
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test src/lib/supabaseClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add single guarded supabase client"
```

---

## Phase 1 — Database schema + RLS

> This phase produces the whole data model as SQL migrations and proves the visibility rules with integration tests against local Supabase. Run `npx supabase start` before the integration tests; they use the service-role key to seed and anon/user JWTs to assert access.

### Task 1.1: Core tables migration (profiles, families, members)

**Files:**
- Create: `supabase/migrations/0001_core.sql`

**Interfaces:**
- Produces: tables `profiles`, `families`, `family_members`; trigger that inserts a `profiles` row on new auth user.

- [ ] **Step 1: Write the migration**

```sql
-- profiles: one per auth user
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Cook',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- auto-create a profile when an auth user is created
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Cook'));
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references profiles(id),
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_at timestamptz not null default now()
);

create table family_members (
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

-- membership helper used by RLS on other tables
create function is_family_member(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase db reset`
Expected: migration applies with no error; `npx supabase db reset` recreates the DB cleanly.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): core profiles/families/members schema"
```

### Task 1.2: RLS for families + members

**Files:**
- Create: `supabase/migrations/0002_families_rls.sql`

**Interfaces:**
- Produces: RLS policies enforcing that a user sees only families they belong to, and can join/create per rules.

- [ ] **Step 1: Write the migration**

```sql
alter table profiles enable row level security;
alter table families enable row level security;
alter table family_members enable row level security;

-- profiles: a user reads their own profile and profiles of co-members
create policy profiles_self_read on profiles for select
  using (id = auth.uid() or exists (
    select 1 from family_members fm1
    join family_members fm2 on fm1.family_id = fm2.family_id
    where fm1.user_id = auth.uid() and fm2.user_id = profiles.id));
create policy profiles_self_update on profiles for update
  using (id = auth.uid());

-- families: members read; any authed user creates
create policy families_member_read on families for select
  using (is_family_member(id));
create policy families_insert on families for insert
  with check (created_by = auth.uid());
create policy families_owner_update on families for update
  using (exists (select 1 from family_members
    where family_id = families.id and user_id = auth.uid() and role = 'owner'));

-- family_members: members of the family read the roster
create policy members_read on family_members for select
  using (is_family_member(family_id));
-- a user may add THEMSELVES (join); creator handled in api by inserting owner row
create policy members_self_insert on family_members for insert
  with check (user_id = auth.uid());
-- owner may remove members; a user may remove themselves
create policy members_delete on family_members for delete
  using (user_id = auth.uid() or exists (select 1 from family_members m
    where m.family_id = family_members.family_id and m.user_id = auth.uid() and m.role='owner'));
```

- [ ] **Step 2: Apply**

Run: `npx supabase db reset`
Expected: applies cleanly.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): RLS for families and members"
```

### Task 1.3: Recipe tables + RLS

**Files:**
- Create: `supabase/migrations/0003_recipes.sql`

**Interfaces:**
- Produces: `recipes`, `recipe_ingredients`, `recipe_steps`, `recipe_photos`, `comments`, `tags`, `recipe_tags` with RLS.

- [ ] **Step 1: Write the migration**

```sql
create type recipe_visibility as enum ('private','family','public');

create table recipes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  author_id uuid not null references profiles(id),
  title text not null,
  story text,
  provenance text,
  servings int,
  prep_minutes int,
  cook_minutes int,
  visibility recipe_visibility not null default 'family',
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  quantity text, unit text, item text not null
);
create table recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  text text not null
);
create table recipe_photos (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  storage_path text not null,
  is_cover boolean not null default false
);
create table comments (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create table tags (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  unique (family_id, name)
);
create table recipe_tags (
  recipe_id uuid not null references recipes(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (recipe_id, tag_id)
);

-- readability predicate reused across child tables
create function can_read_recipe(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipes r where r.id = rid and (
    r.visibility = 'public'
    or (r.visibility = 'family' and is_family_member(r.family_id))
    or (r.visibility = 'private' and r.author_id = auth.uid())
  ));
$$;

alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_steps enable row level security;
alter table recipe_photos enable row level security;
alter table comments enable row level security;
alter table tags enable row level security;
alter table recipe_tags enable row level security;

-- recipes
create policy recipes_read on recipes for select using (
  visibility = 'public'
  or (visibility = 'family' and is_family_member(family_id))
  or (visibility = 'private' and author_id = auth.uid()));
create policy recipes_insert on recipes for insert with check (
  author_id = auth.uid() and is_family_member(family_id));
create policy recipes_update on recipes for update using (
  author_id = auth.uid() or exists (select 1 from family_members
    where family_id = recipes.family_id and user_id = auth.uid() and role='owner'));
create policy recipes_delete on recipes for delete using (
  author_id = auth.uid() or exists (select 1 from family_members
    where family_id = recipes.family_id and user_id = auth.uid() and role='owner'));

-- child rows: readable if parent readable, writable if author of parent or family owner
create policy ing_read on recipe_ingredients for select using (can_read_recipe(recipe_id));
create policy ing_write on recipe_ingredients for all using (
  exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id=r.family_id and m.user_id=auth.uid() and m.role='owner'))))
  with check (exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id=r.family_id and m.user_id=auth.uid() and m.role='owner'))));
create policy step_read on recipe_steps for select using (can_read_recipe(recipe_id));
create policy step_write on recipe_steps for all using (
  exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id=r.family_id and m.user_id=auth.uid() and m.role='owner'))))
  with check (exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id=r.family_id and m.user_id=auth.uid() and m.role='owner'))));
create policy photo_read on recipe_photos for select using (can_read_recipe(recipe_id));
create policy photo_write on recipe_photos for all using (
  exists (select 1 from recipes r where r.id = recipe_id and r.author_id = auth.uid()))
  with check (exists (select 1 from recipes r where r.id = recipe_id and r.author_id = auth.uid()));

-- comments: read if recipe readable; write if family member of the recipe's family
create policy comments_read on comments for select using (can_read_recipe(recipe_id));
create policy comments_insert on comments for insert with check (
  author_id = auth.uid()
  and exists (select 1 from recipes r where r.id = recipe_id and is_family_member(r.family_id)));
create policy comments_delete on comments for delete using (author_id = auth.uid());

-- tags scoped to family membership
create policy tags_read on tags for select using (is_family_member(family_id));
create policy tags_write on tags for all using (is_family_member(family_id))
  with check (is_family_member(family_id));
create policy rtags_read on recipe_tags for select using (can_read_recipe(recipe_id));
create policy rtags_write on recipe_tags for all using (can_read_recipe(recipe_id))
  with check (can_read_recipe(recipe_id));
```

- [ ] **Step 2: Apply**

Run: `npx supabase db reset`
Expected: applies cleanly.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): recipe tables and visibility RLS"
```

### Task 1.4: RLS integration tests (the highest-risk logic)

**Files:**
- Create: `tests/integration/rls.test.ts`
- Create: `tests/integration/helpers.ts`

**Interfaces:**
- Consumes: local Supabase running (`npx supabase start`), service-role key and URL from `supabase status`.
- Produces: proof that private/family/public reads and writes are allowed/denied per membership.

- [ ] **Step 1: Write helpers**

```ts
import { createClient } from "@supabase/supabase-js";
export const admin = createClient(process.env.SB_URL!, process.env.SB_SERVICE_KEY!);
// create a confirmed user and return a client authed as them
export async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "password123", email_confirm: true,
  });
  if (error) throw error;
  const anon = createClient(process.env.SB_URL!, process.env.SB_ANON_KEY!);
  await anon.auth.signInWithPassword({ email, password: "password123" });
  return { id: data.user!.id, client: anon };
}
```

- [ ] **Step 2: Write the failing tests**

```ts
import { beforeAll, expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

test("family recipe is visible to a member, hidden from a non-member", async () => {
  const alice = await makeUser(`alice${Date.now()}@t.dev`);
  const bob = await makeUser(`bob${Date.now()}@t.dev`);

  // alice creates a family and an owner membership (via service role to bypass ordering)
  const { data: fam } = await admin.from("families")
    .insert({ name: "Alice Fam", created_by: alice.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });

  const { data: rec } = await admin.from("recipes").insert({
    family_id: fam!.id, author_id: alice.id, title: "Dal", visibility: "family",
  }).select().single();

  // alice (member) can read
  const asAlice = await alice.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asAlice.data).toHaveLength(1);

  // bob (non-member) cannot
  const asBob = await bob.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asBob.data).toHaveLength(0);
});

test("private recipe is hidden even from family members", async () => {
  const alice = await makeUser(`a2${Date.now()}@t.dev`);
  const carol = await makeUser(`c2${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families").insert({ name: "F2", created_by: alice.id }).select().single();
  await admin.from("family_members").insert([
    { family_id: fam!.id, user_id: alice.id, role: "owner" },
    { family_id: fam!.id, user_id: carol.id, role: "member" },
  ]);
  const { data: rec } = await admin.from("recipes").insert({
    family_id: fam!.id, author_id: alice.id, title: "Secret", visibility: "private",
  }).select().single();
  const asCarol = await carol.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asCarol.data).toHaveLength(0);
});

test("public recipe is readable by anyone", async () => {
  const alice = await makeUser(`a3${Date.now()}@t.dev`);
  const stranger = await makeUser(`s3${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families").insert({ name: "F3", created_by: alice.id }).select().single();
  await admin.from("family_members").insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });
  const { data: rec } = await admin.from("recipes").insert({
    family_id: fam!.id, author_id: alice.id, title: "Open", visibility: "public",
  }).select().single();
  const asStranger = await stranger.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asStranger.data).toHaveLength(1);
});
```

- [ ] **Step 3: Add an integration test script**

Add to `package.json`: `"test:int": "vitest run tests/integration"`.
Document in a comment at the top of `helpers.ts`: run `npx supabase start`, then export `SB_URL`, `SB_ANON_KEY`, `SB_SERVICE_KEY` from `npx supabase status` before running.

- [ ] **Step 4: Run and verify pass**

Run: `npx supabase start && SB_URL=... SB_ANON_KEY=... SB_SERVICE_KEY=... npm run test:int`
Expected: all three tests PASS. If any fail, the RLS policies are wrong, fix the migration, not the test.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(db): RLS visibility integration tests"
```

---

## Phase 2 — API layer + auth

### Task 2.1: Shared types

**Files:**
- Create: `src/lib/api/types.ts`

**Interfaces:**
- Produces: `Profile`, `Family`, `FamilyMember`, `Recipe`, `Ingredient`, `Step`, `Comment`, `Tag`, `Visibility`, and `RecipeDraft` (the shape `extract-recipe` returns and the form edits).

- [ ] **Step 1: Write the types**

```ts
export type Visibility = "private" | "family" | "public";
export interface Profile { id: string; display_name: string; avatar_url: string | null; }
export interface Family { id: string; name: string; invite_code: string; created_by: string; }
export interface FamilyMember { family_id: string; user_id: string; role: "owner" | "member"; }
export interface Ingredient { id?: string; position: number; quantity: string | null; unit: string | null; item: string; }
export interface Step { id?: string; position: number; text: string; }
export interface Recipe {
  id: string; family_id: string; author_id: string; title: string;
  story: string | null; provenance: string | null; servings: number | null;
  prep_minutes: number | null; cook_minutes: number | null;
  visibility: Visibility; source_url: string | null; created_at: string; updated_at: string;
}
export interface Comment { id: string; recipe_id: string; author_id: string; body: string; created_at: string; }
export interface Tag { id: string; family_id: string; name: string; }
// what the AI returns and the create form binds to (no ids, no server fields)
export interface RecipeDraft {
  title: string; story: string; provenance: string;
  servings: number | null; prep_minutes: number | null; cook_minutes: number | null;
  ingredients: Ingredient[]; steps: Step[]; source_url: string | null;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(api): shared types"
```

### Task 2.2: Auth api + AuthContext

**Files:**
- Create: `src/lib/api/auth.ts`
- Create: `src/context/AuthContext.tsx`
- Test: `src/lib/api/auth.test.ts`

**Interfaces:**
- Produces: `signUp(email,password,displayName)`, `signIn(email,password)`, `signOut()`, `getSession()`, `onAuthChange(cb)`. `AuthProvider` + `useAuth()` returning `{ user, loading }`.

- [ ] **Step 1: Write failing test (mock the client)**

```ts
import { vi, test, expect, beforeEach } from "vitest";
vi.mock("../supabaseClient", () => ({
  supabase: { auth: {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }},
}));
import { signIn, signOut } from "./auth";

test("signIn returns the user on success", async () => {
  const u = await signIn("a@b.dev", "pw");
  expect(u.id).toBe("u1");
});
test("signIn throws on error", async () => {
  const { supabase } = await import("../supabaseClient");
  (supabase.auth.signInWithPassword as any).mockResolvedValueOnce({ data: {}, error: { message: "bad" } });
  await expect(signIn("a@b.dev", "x")).rejects.toThrow("bad");
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test src/lib/api/auth.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `auth.ts`**

```ts
import { supabase } from "../supabaseClient";
import type { Profile } from "./types";

export async function signUp(email: string, password: string, displayName: string) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { display_name: displayName } },
  });
  if (error) throw new Error(error.message);
  return data.user;
}
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.user!;
}
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export function onAuthChange(cb: (userId: string | null) => void) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session?.user.id ?? null));
}
```

- [ ] **Step 4: Implement `AuthContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState } from "react";
import { getSession, onAuthChange } from "../lib/api/auth";

type AuthState = { userId: string | null; loading: boolean };
const Ctx = createContext<AuthState>({ userId: null, loading: true });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ userId: null, loading: true });
  useEffect(() => {
    getSession().then((s) => setState({ userId: s?.user.id ?? null, loading: false }));
    const { data } = onAuthChange((uid) => setState({ userId: uid, loading: false }));
    return () => data.subscription.unsubscribe();
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test src/lib/api/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): auth functions and AuthContext"
```

### Task 2.3: Auth pages + protected routing

**Files:**
- Create: `src/pages/SignIn.tsx`, `src/pages/SignUp.tsx`
- Create: `src/routes.tsx`, `src/components/RequireAuth.tsx`
- Modify: `src/main.tsx` (wrap in `AuthProvider` + `BrowserRouter`)
- Test: `src/components/RequireAuth.test.tsx`

**Interfaces:**
- Consumes: `useAuth()`.
- Produces: `RequireAuth` wrapper that redirects to `/signin` when logged out; routes tree.

- [ ] **Step 1: Failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import { vi } from "vitest";
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ userId: null, loading: false }) }));
test("redirects to signin when logged out", () => {
  render(<MemoryRouter initialEntries={["/app"]}>
    <Routes>
      <Route path="/signin" element={<div>signin page</div>} />
      <Route path="/app" element={<RequireAuth><div>secret</div></RequireAuth>} />
    </Routes>
  </MemoryRouter>);
  expect(screen.getByText("signin page")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail**, then implement:

```tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { userId, loading } = useAuth();
  if (loading) return <p>Loading...</p>;
  if (!userId) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Build SignIn/SignUp forms** calling `signIn`/`signUp`, showing errors, navigating to `/` on success. Wire `routes.tsx` and wrap `main.tsx` with `<BrowserRouter><AuthProvider>`.

- [ ] **Step 4: Run tests, verify pass.**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: auth pages and protected routing"
```

---

## Phase 3 — Families

### Task 3.1: Families api

**Files:**
- Create: `src/lib/api/families.ts`
- Test: `src/lib/api/families.test.ts` (mock client)

**Interfaces:**
- Produces: `createFamily(name)`, `joinByCode(code)`, `listMyFamilies()`, `rotateInviteCode(familyId)`, `leaveFamily(familyId)`.
- Note: `createFamily` inserts the family, then inserts an `owner` `family_members` row for the current user (two writes; the second satisfies `members_self_insert`).

- [ ] **Step 1: Failing test**

```ts
import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { listMyFamilies } from "./families";
test("listMyFamilies returns families for the user", async () => {
  from.mockReturnValueOnce({ select: () => ({ data: [{ family_id: "f1" }], error: null }) });
  from.mockReturnValueOnce({ select: () => ({ in: () => ({ data: [{ id: "f1", name: "Fam" }], error: null }) }) });
  const fams = await listMyFamilies();
  expect(fams[0].name).toBe("Fam");
});
```

- [ ] **Step 2: Run, verify fail; implement `families.ts`:**

```ts
import { supabase } from "../supabaseClient";
import type { Family } from "./types";

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export async function createFamily(name: string): Promise<Family> {
  const uid = await myId();
  const { data: fam, error } = await supabase.from("families")
    .insert({ name, created_by: uid }).select().single();
  if (error) throw new Error(error.message);
  const { error: mErr } = await supabase.from("family_members")
    .insert({ family_id: fam.id, user_id: uid, role: "owner" });
  if (mErr) throw new Error(mErr.message);
  return fam as Family;
}

export async function joinByCode(code: string): Promise<Family> {
  const uid = await myId();
  const { data: fam, error } = await supabase.from("families")
    .select("*").eq("invite_code", code).single();
  if (error || !fam) throw new Error("Invalid invite code");
  const { error: mErr } = await supabase.from("family_members")
    .insert({ family_id: fam.id, user_id: uid, role: "member" });
  if (mErr && !mErr.message.includes("duplicate")) throw new Error(mErr.message);
  return fam as Family;
}

export async function listMyFamilies(): Promise<Family[]> {
  const { data: memberships, error } = await supabase.from("family_members").select("family_id");
  if (error) throw new Error(error.message);
  const ids = (memberships ?? []).map((m: any) => m.family_id);
  if (ids.length === 0) return [];
  const { data, error: fErr } = await supabase.from("families").select("*").in("id", ids);
  if (fErr) throw new Error(fErr.message);
  return (data ?? []) as Family[];
}

export async function rotateInviteCode(familyId: string): Promise<string> {
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const { error } = await supabase.from("families").update({ invite_code: code }).eq("id", familyId);
  if (error) throw new Error(error.message);
  return code;
}

export async function leaveFamily(familyId: string): Promise<void> {
  const uid = await myId();
  const { error } = await supabase.from("family_members")
    .delete().eq("family_id", familyId).eq("user_id", uid);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 3: Run tests, verify pass. Step 4: Commit**

```bash
git add -A && git commit -m "feat(api): families create/join/list"
```

### Task 3.2: FamilyContext + switcher + create/join UI

**Files:**
- Create: `src/context/FamilyContext.tsx` (active family id, persisted to `localStorage`)
- Create: `src/pages/Families.tsx` (list, create form, join-by-code form)
- Create: `src/components/FamilySwitcher.tsx`
- Create: `src/pages/JoinByCode.tsx` (route `/join/:code`)
- Test: `src/context/FamilyContext.test.tsx`

**Interfaces:**
- Consumes: `listMyFamilies`, `createFamily`, `joinByCode`.
- Produces: `useFamily()` returning `{ families, activeFamily, setActiveFamily, reload }`.

- [ ] **Step 1: Failing test** that `useFamily` defaults `activeFamily` to the first family and persists a selection to `localStorage`. **Step 2:** implement provider (load families on mount, read/write `localStorage` key `activeFamilyId`, wrapped in try/catch since storage can throw). **Step 3:** build `Families` page and `FamilySwitcher` (a `<select>`), and `JoinByCode` that calls `joinByCode(params.code)` then navigates home. **Step 4:** run tests. **Step 5:** commit `feat: family context, switcher, join flow`.

---

## Phase 4 — Recipes (CRUD + guided manual form)

### Task 4.1: Recipes api (create with nested ingredients/steps)

**Files:**
- Create: `src/lib/api/recipes.ts`, `src/lib/api/ingredients.ts`, `src/lib/api/steps.ts`
- Test: `src/lib/api/recipes.test.ts`

**Interfaces:**
- Produces:
  - `createRecipe(familyId, draft, visibility)` -> `Recipe` (inserts recipe, then bulk-inserts ingredients and steps with `position` set by array index).
  - `updateRecipe(id, patch)`, `getRecipe(id)` (returns recipe + ingredients + steps + photos + tags), `listRecipes(familyId, { search?, tagId? })`, `deleteRecipe(id)`.
- Consumes: `RecipeDraft`, `Visibility` from types.

- [ ] **Step 1: Failing test** for `createRecipe` asserting it inserts the recipe then inserts ingredients with `position: 0,1,...`. Mock `supabase.from` to capture inserted payloads. **Step 2:** run, verify fail.

- [ ] **Step 3: Implement `recipes.ts`** (excerpt for create; the rest follow the same shape):

```ts
import { supabase } from "../supabaseClient";
import type { Recipe, RecipeDraft, Visibility } from "./types";

export async function createRecipe(familyId: string, draft: RecipeDraft, visibility: Visibility): Promise<Recipe> {
  const { data: user } = await supabase.auth.getUser();
  const { data: rec, error } = await supabase.from("recipes").insert({
    family_id: familyId, author_id: user.user!.id, title: draft.title,
    story: draft.story || null, provenance: draft.provenance || null,
    servings: draft.servings, prep_minutes: draft.prep_minutes, cook_minutes: draft.cook_minutes,
    visibility, source_url: draft.source_url,
  }).select().single();
  if (error) throw new Error(error.message);

  if (draft.ingredients.length) {
    const rows = draft.ingredients.map((g, i) => ({
      recipe_id: rec.id, position: i, quantity: g.quantity, unit: g.unit, item: g.item }));
    const { error: e2 } = await supabase.from("recipe_ingredients").insert(rows);
    if (e2) throw new Error(e2.message);
  }
  if (draft.steps.length) {
    const rows = draft.steps.map((s, i) => ({ recipe_id: rec.id, position: i, text: s.text }));
    const { error: e3 } = await supabase.from("recipe_steps").insert(rows);
    if (e3) throw new Error(e3.message);
  }
  return rec as Recipe;
}

export async function getRecipe(id: string) {
  const [{ data: recipe }, { data: ingredients }, { data: steps }, { data: photos }] = await Promise.all([
    supabase.from("recipes").select("*").eq("id", id).single(),
    supabase.from("recipe_ingredients").select("*").eq("recipe_id", id).order("position"),
    supabase.from("recipe_steps").select("*").eq("recipe_id", id).order("position"),
    supabase.from("recipe_photos").select("*").eq("recipe_id", id),
  ]);
  if (!recipe) throw new Error("Recipe not found");
  return { recipe, ingredients: ingredients ?? [], steps: steps ?? [], photos: photos ?? [] };
}

export async function listRecipes(familyId: string, opts: { search?: string; tagId?: string } = {}) {
  let q = supabase.from("recipes").select("*").eq("family_id", familyId).order("created_at", { ascending: false });
  if (opts.search) q = q.ilike("title", `%${opts.search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Recipe[];
}

export async function deleteRecipe(id: string) {
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
```

`ponytail:` `updateRecipe` for ingredients/steps replaces child rows (delete-all-then-insert) rather than diffing positions. Simple and correct for small lists; revisit only if a recipe has hundreds of lines. Put a `ponytail:` comment on it.

- [ ] **Step 4: Run tests, verify pass. Step 5: Commit** `feat(api): recipe CRUD with nested ingredients/steps`.

### Task 4.2: Recipe list page

**Files:**
- Create: `src/pages/RecipeList.tsx`, `src/components/RecipeCard.tsx`
- Test: `src/pages/RecipeList.test.tsx`

**Interfaces:** Consumes `useFamily()`, `listRecipes`. Renders cards linking to `/recipes/:id`, a search box (debounced), and a "New recipe" button.

- [ ] **Step 1:** failing test: given a mocked `listRecipes` returning two recipes, both titles render. **Step 2:** run/fail. **Step 3:** implement page (loads on active family change + search term). **Step 4:** pass. **Step 5:** commit `feat: recipe list page`.

### Task 4.3: Guided manual create form (ingredients first, then steps, then meta)

**Files:**
- Create: `src/pages/RecipeCreate.tsx`
- Create: `src/components/IngredientEditor.tsx`, `src/components/StepEditor.tsx`, `src/components/VisibilitySelect.tsx`
- Test: `src/components/IngredientEditor.test.tsx`, `src/pages/RecipeCreate.test.tsx`

**Interfaces:**
- Consumes: `createRecipe`, `useFamily`, `RecipeDraft`.
- Produces: a form bound to a `RecipeDraft` state object. Step order in the UI: (1) ingredients list with add/remove/reorder, (2) steps list, (3) metadata (title, servings, times, story, provenance, tags, visibility). Submit calls `createRecipe(activeFamily.id, draft, visibility)` then navigates to the new recipe.

- [ ] **Step 1: Failing test for `IngredientEditor`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import IngredientEditor from "./IngredientEditor";
import type { Ingredient } from "../lib/api/types";
function Harness() {
  const [items, setItems] = useState<Ingredient[]>([]);
  return <IngredientEditor items={items} onChange={setItems} />;
}
test("adds an ingredient row", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: /add ingredient/i }));
  expect(screen.getAllByPlaceholderText(/item/i)).toHaveLength(1);
});
```

- [ ] **Step 2:** run/fail. **Step 3:** implement `IngredientEditor` (controlled list: props `items`, `onChange`; add appends `{position: items.length, quantity:"", unit:"", item:""}`; remove splices; each row has qty/unit/item inputs). `StepEditor` mirrors it with a single `text` field. `RecipeCreate` composes them + metadata and submits. **Step 4:** run tests pass. **Step 5:** commit `feat: guided manual recipe create form`.

### Task 4.4: Recipe detail + edit + delete

**Files:**
- Create: `src/pages/RecipeDetail.tsx`, `src/pages/RecipeEdit.tsx`
- Test: `src/pages/RecipeDetail.test.tsx`

**Interfaces:** Consumes `getRecipe`, `updateRecipe`, `deleteRecipe`. Detail shows cover photo, ingredients, steps, story, provenance, visibility badge, and a "Cook Mode" button. Edit reuses the `RecipeCreate` form components pre-filled from `getRecipe`.

- [ ] **Step 1:** failing test: mocked `getRecipe` renders title + all ingredient items + all step texts. **Step 2:** fail. **Step 3:** implement detail and edit (edit reuses `IngredientEditor`/`StepEditor`; save calls `updateRecipe`; delete confirms then calls `deleteRecipe` and navigates to list). **Step 4:** pass. **Step 5:** commit `feat: recipe detail, edit, delete`.

---

## Phase 5 — AI extract + pre-fill panel

### Task 5.1: `extract-recipe` Edge Function

**Files:**
- Create: `supabase/functions/extract-recipe/index.ts`
- Create: `supabase/functions/extract-recipe/prompt.ts`

**Interfaces:**
- HTTP POST body: `{ mode: "text"|"url"|"image"|"audio", payload: string }` where `payload` is raw text, a URL, a base64 image, or base64 audio. Returns `RecipeDraft` JSON (same shape as `src/lib/api/types.ts`).
- Requires env `MODEL_API_KEY` (set via `npx supabase secrets set`). Requires a signed-in caller (verify JWT via the `Authorization` header; reject anonymous).

- [ ] **Step 1: Implement URL fast-path + model fallback**

```ts
// Deno Edge Function
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildPrompt, DRAFT_SCHEMA } from "./prompt.ts";

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "unauthorized" }, 401);
  const { mode, payload } = await req.json();

  // URL fast path: try embedded JSON-LD Recipe before spending a model call
  if (mode === "url") {
    const draft = await tryJsonLd(payload);
    if (draft) return json(draft, 200);
  }

  const text = mode === "url" ? await (await fetch(payload)).text() : payload;
  const draft = await callModel(mode, text);   // cheap model, returns DRAFT_SCHEMA JSON
  return json(draft, 200);
});

function json(b: unknown, status: number) {
  return new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
}
```

`prompt.ts` holds the system prompt: "Extract a recipe into this exact JSON schema. Leave any field you cannot find blank (empty string / empty array / null). Never invent quantities or steps." and exports `DRAFT_SCHEMA`. `tryJsonLd(url)` fetches the page, finds `<script type="application/ld+json">` with `@type: Recipe`, maps `recipeIngredient`/`recipeInstructions` to the draft, returns null if absent. `callModel` posts to the provider with `mode` (image/audio use the multimodal endpoint) and parses JSON from the response.

- [ ] **Step 2: Local test of the JSON-LD path (no model key needed)**

Create `supabase/functions/extract-recipe/jsonld.test.ts` (Deno test): feed an HTML string containing a JSON-LD Recipe block, assert `tryJsonLd` returns a draft with the right ingredient count. Run: `deno test supabase/functions/extract-recipe/`.
Expected: PASS. (The model path is tested manually once `MODEL_API_KEY` is set, since it needs the key and network. Document this in a comment.)

- [ ] **Step 3: Commit** `feat(fn): extract-recipe function with JSON-LD fast path`.

### Task 5.2: extract api client + pre-fill panel

**Files:**
- Create: `src/lib/api/extract.ts`
- Create: `src/components/AiPrefillPanel.tsx`
- Modify: `src/pages/RecipeCreate.tsx` (mount the panel; on result, merge draft into form state)
- Test: `src/lib/api/extract.test.ts`

**Interfaces:**
- Produces: `extractRecipe(mode, payload): Promise<RecipeDraft>` calling `supabase.functions.invoke("extract-recipe", { body })`.
- `AiPrefillPanel` props: `onDraft(draft: RecipeDraft) => void`. It offers tabs: Paste/Write text, URL, Photo, Voice. On submit it calls `extractRecipe` and passes the result up; the parent fills the form (human then reviews/edits). The panel never saves.

- [ ] **Step 1: Failing test** for `extractRecipe` (mock `supabase.functions.invoke` returning a draft; assert it is returned; assert it throws on `error`). **Step 2:** fail. **Step 3:** implement `extract.ts` and `AiPrefillPanel` (text/url tabs first; photo = file input to base64; voice = `MediaRecorder` to base64, feature-detected with a graceful "not supported" fallback). Wire into `RecipeCreate`: `onDraft` sets the form state, then the existing guided form shows the pre-filled values for review. **Step 4:** tests pass. **Step 5:** commit `feat: AI pre-fill panel and extract client`.

---

## Phase 6 — Comments, photos, Cook Mode

### Task 6.1: Comments api + thread UI

**Files:**
- Create: `src/lib/api/comments.ts`, `src/components/CommentThread.tsx`
- Modify: `src/pages/RecipeDetail.tsx`
- Test: `src/lib/api/comments.test.ts`

**Interfaces:** `listComments(recipeId)`, `addComment(recipeId, body)`, `deleteComment(id)`. `CommentThread` shows comments with author display name and a box to add one (only for signed-in family members; RLS enforces this too).

- [ ] Failing test for `addComment` (mock insert, assert `author_id` is set from `getUser`). Implement, wire into detail page, run, commit `feat: in-family comments`.

### Task 6.2: Photo upload to Storage

**Files:**
- Create: `src/lib/api/photos.ts`
- Create migration: `supabase/migrations/0004_storage.sql` (create a `recipe-photos` bucket + storage RLS: a user may upload to a path under a recipe they can write; anyone who can read the recipe can read the object)
- Modify: `RecipeCreate` / `RecipeEdit` to upload and set cover
- Test: `src/lib/api/photos.test.ts`

**Interfaces:** `uploadRecipePhoto(recipeId, file, isCover)` -> uploads to `recipe-photos/{recipeId}/{uuid}` and inserts a `recipe_photos` row; `getPhotoUrl(path)` returns a public or signed URL depending on recipe visibility.

- [ ] Failing test (mock storage `upload` + insert). Implement. Commit `feat: recipe photo upload`.

`ponytail:` v1 stores one bucket, public-read for `public` recipes via signed URLs for the rest. No image resizing pipeline; add a transform only if payloads get heavy.

### Task 6.3: Cook Mode

**Files:**
- Create: `src/pages/CookMode.tsx` (route `/recipes/:id/cook`)
- Test: `src/pages/CookMode.test.tsx`

**Interfaces:** Consumes `getRecipe`. Shows one big step at a time with next/prev, ingredient list toggle, and calls the Wake Lock API (`navigator.wakeLock.request("screen")`) inside a feature check so unsupported browsers just skip it.

- [ ] Failing test: renders step 1 text, clicking "Next" shows step 2. Implement (large type, keyboard arrows advance, wake lock in try/catch). Commit `feat: cook mode`.

---

## Phase 7 — Tags, search polish, app shell

### Task 7.1: Tags

**Files:** `src/lib/api/tags.ts`, `src/components/TagPicker.tsx`, filter in `RecipeList`.
- [ ] `listTags(familyId)`, `ensureTag(familyId, name)`, `setRecipeTags(recipeId, tagIds)`. TagPicker is a create-or-select input. Filter list by `tagId`. Test the api, commit `feat: tags and tag filter`.

### Task 7.2: App shell + navigation + empty states

**Files:** `src/components/AppLayout.tsx` (header with `FamilySwitcher`, nav, sign out), empty states for "no families yet" (prompt to create/join) and "no recipes yet" (prompt to add).
- [ ] Implement layout, wire all routes under it behind `RequireAuth`. Manual smoke: sign up, create family, add a recipe manually, add one via paste, comment, open cook mode. Commit `feat: app shell and empty states`.

---

## Self-Review (completed during authoring)

**Spec coverage:** auth (2.2-2.3), multiple families + switcher + invite (1.1-1.2, 3.1-3.2), recipes with ingredients/steps/story/provenance/photos (1.3, 4.1-4.4, 6.2), visibility + RLS (1.2-1.4), guided manual entry ingredients-first (4.3), AI pre-fill with text/url/image/audio front doors (5.1-5.2), URL JSON-LD fast path (5.1), comments (6.1), Cook Mode + wake lock (6.3), tags + search (4.2, 7.1), portability seam via `lib/api` (all api tasks), phase-2 public flag present but no feed built (1.3 visibility enum). All spec sections map to a task.

**Placeholder scan:** no TBD/TODO; deferred-by-design items (conversational AI, public feed, image resizing, position-diffing) are marked with `ponytail:` and scoped out explicitly, not left as gaps.

**Type consistency:** `RecipeDraft` shape defined in 2.1 is the exact contract used by `createRecipe` (4.1), `AiPrefillPanel`/`extractRecipe` (5.2), and the Edge Function (5.1). `Visibility` union matches the SQL enum (1.3). `is_family_member`/`can_read_recipe` SQL helpers defined in 1.1/1.3 are reused by all later policies.

**Known external dependency:** Phase 5's model path cannot be end-to-end tested until a Supabase project + `MODEL_API_KEY` exist; the JSON-LD path and everything else is testable locally now. This is called out in Task 5.1 Step 2.
