# Public identity and public pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a published recipe a reachable signed-out page and a cook to be attributed to, and close the two RLS holes that publishing would otherwise open.

**Architecture:** `recipes/:id` moves outside `RequireAuth` and `RecipeDetail` degrades when there is no session, so one URL and one implementation serve both audiences. Public reads of otherwise-private tables go through column-narrowing views (`public_cooks`, `public_recipe_bylines`) because RLS is row-level and cannot hide `display_name`. Avatars keep their private bucket and are served through a stable Worker route that signs server-side, reusing the pattern `/og/recipe/:id.jpg` already established.

**Tech Stack:** React 19 + React Router 6, Supabase (Postgres + RLS + Storage), Cloudflare Workers, Vitest, oxlint.

**Spec:** `docs/superpowers/specs/2026-09-27-public-identity-and-pages-design.md`

## Global Constraints

- **ALL supabase access lives in `src/lib/api/`.** Nothing outside it imports the client. This is the portability seam and it is not negotiable.
- **Verify with `npx tsc -b && npm test`** (NOT `tsc --noEmit`). Migration changes also need `npx supabase db reset` (needs Docker). Integration tests: `npm run test:int`.
- **`npm run lint` must pass.** oxlint covers `supabase/functions/` and `worker/` too.
- **Apply a migration to cloud BEFORE the frontend that needs it reaches production.** Cloudflare deploys the frontend on push; Supabase deploys nothing. Check with `npx supabase migration list --linked`.
- **No em dashes or en dashes** in code comments, commit messages or docs.
- **Handles are stored lowercase**, matching `^[a-z0-9_]{3,30}$`.
- **A private recipe and a missing one must be indistinguishable.** Never let a status code reveal which.
- **Run the security tests red first.** A policy test nobody has seen fail is not evidence.

### Deviations from the spec, decided while planning

1. **Three migrations, not one** (`0020`, `0021`, `0022`), one per task, so each ships with its own test cycle and can be reviewed and reverted alone.
2. **The avatar storage policy is a PREREQUISITE of the Worker proxy, not an alternative to it.** `worker/index.ts` holds only the anon key by design ("the anon key is the whole security model here"), so it cannot sign an avatar the anon role may not read. The spec presented these as either/or; both are needed.
3. **`public_cooks` also exposes `avatar_url`**, because the Worker needs it to resolve a handle to a storage path. It is a path, not a URL, and is useless without the storage policy from Task 3.
4. **`can_read_recipe_privately` has two arms, not three.** The spec's three-arm version was redundant; two arms say the same thing and cannot drift.

---

### Task 1: Public identity columns and the two public views

**Files:**
- Create: `supabase/migrations/0020_public_identity.sql`
- Create: `tests/integration/public_identity.test.ts`
- Modify: `tests/integration/helpers.ts` (add an anon, session-less client)

**Interfaces:**
- Consumes: nothing.
- Produces: `profiles.handle text unique`, `profiles.public_name text`, `profiles.bio text`; views `public_cooks(id, handle, public_name, bio, avatar_url)` and `public_recipe_bylines(recipe_id, handle, public_name, family_name)`; test helper `anonClient(): SupabaseClient`.

- [ ] **Step 1: Add the session-less client helper**

`tests/integration/helpers.ts`, appended:

```ts
// A client with the anon key and NO session, which is what a stranger on the internet is.
// makeUser's client is also built from the anon key but is signed in, so it cannot prove
// anything about anonymous access.
export function anonClient() {
  return createClient(process.env.SB_URL!, process.env.SB_ANON_KEY!, noPersist);
}
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/public_identity.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

describe("public identity", () => {
  let cookId: string;
  let familyId: string;
  let publicRecipeId: string;
  const anon = anonClient();

  beforeAll(async () => {
    const cook = await makeUser(`cook-${Date.now()}@test.dev`);
    cookId = cook.id;
    // Families are made with the admin client and two inserts, which is how every existing
    // integration test does it. There is no create_family_with_owner RPC; the only family
    // RPC is join_family_by_code.
    const { data: family } = await admin.from("families")
      .insert({ name: "Pokhrel", created_by: cookId }).select().single();
    familyId = family!.id;
    await admin.from("family_members")
      .insert({ family_id: familyId, user_id: cookId, role: "owner" });
    const { data: recipe } = await cook.client.from("recipes")
      .insert({ family_id: familyId, author_id: cookId, title: "Momo", visibility: "public" })
      .select("id").single();
    publicRecipeId = (recipe as { id: string }).id;
    await admin.from("profiles")
      .update({ handle: "aayush", public_name: "Aayush", bio: "Cooks momo." })
      .eq("id", cookId);
  });

  it("lets a stranger read a published cook from the view", async () => {
    const { data } = await anon.from("public_cooks").select("handle,public_name,bio")
      .eq("handle", "aayush").single();
    expect(data).toMatchObject({ handle: "aayush", public_name: "Aayush" });
  });

  it("never lets a stranger read profiles directly", async () => {
    // display_name and preferences must not be reachable. RLS gives anon no policy on
    // profiles at all, so this is an empty result rather than an error.
    const { data } = await anon.from("profiles").select("id,display_name").eq("id", cookId);
    expect(data).toEqual([]);
  });

  it("hides cooks who have not claimed a handle", async () => {
    const quiet = await makeUser(`quiet-${Date.now()}@test.dev`);
    const { data } = await anon.from("public_cooks").select("id").eq("id", quiet.id);
    expect(data).toEqual([]);
  });

  it("gives a stranger the byline for a public recipe", async () => {
    const { data } = await anon.from("public_recipe_bylines")
      .select("handle,public_name,family_name").eq("recipe_id", publicRecipeId).single();
    expect(data).toMatchObject({ public_name: "Aayush", family_name: "Pokhrel" });
  });

  it("never lets a stranger read families directly", async () => {
    const { data } = await anon.from("families").select("name").eq("id", familyId);
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:int -- public_identity`
Expected: FAIL. The first test errors because relation `public_cooks` does not exist.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0020_public_identity.sql`:

```sql
-- 0020: a public identity for a cook, and the two narrow views that are the ONLY way an
-- anonymous stranger can read anything out of profiles or families.

-- handle IS the opt-in: null means "I do not publish". A separate boolean could disagree
-- with it, this cannot. Stored lowercase, which the check enforces, so case-insensitive
-- uniqueness needs neither citext nor a functional index.
alter table profiles
  add column handle text unique
    check (handle is null or handle ~ '^[a-z0-9_]{3,30}$'),
  add column public_name text,
  add column bio text;

-- SECURITY DEFINER BY DEFAULT (security_invoker is off unless asked for), AND DELIBERATELY
-- SO. anon has no policy on profiles and must never get one: RLS is row-level, so a policy
-- exposing a published cook's row would expose display_name and preferences with it.
-- This view is the ONLY public path into profiles. The explicit column list is the column
-- gate and `handle is not null` is the row gate.
-- NEVER write select * here, and never add a column without deciding it is public.
-- avatar_url is a storage PATH, not a URL, and is useless without the avatars policy in 0022.
create view public_cooks as
  select id, handle, public_name, bio, avatar_url
  from profiles
  where handle is not null;

grant select on public_cooks to anon, authenticated;

-- Same reasoning for the byline: families is member-only, so a stranger cannot read the
-- family name off a public recipe without a narrow path to it.
-- The left join is deliberate: a recipe can be public while its author has not claimed a
-- handle, and that must render as the family name alone rather than break the page. The UI
-- requires a handle before publishing, but the database must not assume the UI is the only
-- writer.
create view public_recipe_bylines as
  select r.id as recipe_id, p.handle, p.public_name, f.name as family_name
  from recipes r
  join families f on f.id = r.family_id
  left join profiles p on p.id = r.author_id and p.handle is not null
  where r.visibility = 'public';

grant select on public_recipe_bylines to anon, authenticated;
```

- [ ] **Step 5: Apply and run the test to verify it passes**

Run: `npx supabase db reset`
Then: `npm run test:int -- public_identity`
Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm nothing else broke**

Run: `npm run test:int`
Expected: PASS, all previous integration tests plus the 5 new ones.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0020_public_identity.sql tests/integration/public_identity.test.ts tests/integration/helpers.ts
git commit -m "feat: a public identity for a cook, behind two narrow views

RLS is row-level, so a policy letting anon read a published cook's profile
row would hand over display_name and preferences too. The views are the
column gate; profiles keeps having no anon policy at all."
```

---

### Task 2: Close the two RLS holes

**Files:**
- Create: `supabase/migrations/0021_tighten_public_access.sql`
- Create: `tests/integration/public_access.test.ts`

**Interfaces:**
- Consumes: Task 1's migration must already exist so the numbering is sequential.
- Produces: SQL function `can_read_recipe_privately(rid uuid) returns boolean`; replaced policies `rtags_write` on `recipe_tags` and `comments_read` on `comments`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/public_access.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

// Both holes below are invisible while nothing is published. They become real the moment a
// public page exists, which is what this sub-project builds.
describe("public recipes do not over-share", () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let stranger: Awaited<ReturnType<typeof makeUser>>;
  let recipeId: string;
  let tagId: string;
  const anon = anonClient();

  beforeAll(async () => {
    owner = await makeUser(`owner-${Date.now()}@test.dev`);
    stranger = await makeUser(`stranger-${Date.now()}@test.dev`);
    // Two admin inserts, matching every existing integration test. There is no
    // create_family_with_owner RPC.
    const { data: family } = await admin.from("families")
      .insert({ name: "Owner Family", created_by: owner.id }).select().single();
    const familyId = family!.id;
    await admin.from("family_members")
      .insert({ family_id: familyId, user_id: owner.id, role: "owner" });

    const { data: recipe } = await owner.client.from("recipes")
      .insert({ family_id: familyId, author_id: owner.id, title: "Dal", visibility: "public" })
      .select("id").single();
    recipeId = (recipe as { id: string }).id;

    const { data: tag } = await owner.client.from("tags")
      .insert({ family_id: familyId, name: "everyday" }).select("id").single();
    tagId = (tag as { id: string }).id;
    await owner.client.from("recipe_tags").insert({ recipe_id: recipeId, tag_id: tagId });

    await owner.client.from("comments")
      .insert({ recipe_id: recipeId, author_id: owner.id, body: "Mum's version is saltier" });
  });

  it("does not leak family comments to a stranger", async () => {
    const { data } = await stranger.client.from("comments").select("body").eq("recipe_id", recipeId);
    expect(data).toEqual([]);
  });

  it("does not leak family comments to an anonymous visitor", async () => {
    const { data } = await anon.from("comments").select("body").eq("recipe_id", recipeId);
    expect(data).toEqual([]);
  });

  it("still lets the recipe's own family read its comments", async () => {
    const { data } = await owner.client.from("comments").select("body").eq("recipe_id", recipeId);
    expect(data).toHaveLength(1);
  });

  it("does not let a stranger delete a public recipe's tags", async () => {
    await stranger.client.from("recipe_tags").delete().eq("recipe_id", recipeId);
    // Read back as the owner: RLS makes a refused delete look like a no-op to the caller,
    // so the only honest assertion is that the row survived.
    const { data } = await owner.client.from("recipe_tags").select("tag_id").eq("recipe_id", recipeId);
    expect(data).toHaveLength(1);
  });

  it("does not let a stranger attach a tag to a public recipe", async () => {
    await stranger.client.from("recipe_tags").insert({ recipe_id: recipeId, tag_id: tagId });
    const { data } = await owner.client.from("recipe_tags").select("tag_id").eq("recipe_id", recipeId);
    expect(data).toHaveLength(1);
  });

  it("still lets the recipe's own family tag it", async () => {
    const { error } = await owner.client.from("recipe_tags").delete().eq("recipe_id", recipeId);
    expect(error).toBeNull();
    const { data } = await owner.client.from("recipe_tags").select("tag_id").eq("recipe_id", recipeId);
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails, and note WHICH tests fail**

Run: `npm run test:int -- public_access`
Expected: FAIL on exactly four of the six: the two comment-leak tests and the two stranger-tag tests. The two "still lets the owner" tests must PASS already, which is what proves the fix does not simply lock everyone out. **If all six fail, stop: the test setup is wrong, not the policy.**

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0021_tighten_public_access.sql`:

```sql
-- 0021: two policies from 0003 that were wrong in ways nothing could notice while no recipe
-- was ever published. Both become real holes the moment public pages exist.

-- HOLE 1: rtags_write guarded WRITES with can_read_recipe, a READ predicate. Any stranger
-- who could see a public recipe could insert and, worse, DELETE its tag rows.
-- The right predicate is family membership, matching tags_write on the tags table itself.
drop policy rtags_write on recipe_tags;
create policy rtags_write on recipe_tags for all
  using (exists (select 1 from recipes r
                 where r.id = recipe_id and is_family_member(r.family_id)))
  with check (exists (select 1 from recipes r
                      where r.id = recipe_id and is_family_member(r.family_id)));

-- HOLE 2: comments_read inherited can_read_recipe, which grants on PUBLIC grounds, so
-- publishing a recipe silently published the family's conversation about it.
-- Comments are readable on FAMILY or PRIVATE grounds only. Note the family arm covers
-- 'public' as well: a family must keep reading comments on its own recipe after publishing
-- it. What must never grant access is PUBLIC-ness alone.
create function can_read_recipe_privately(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipes r where r.id = rid and (
    (r.visibility in ('family','public') and is_family_member(r.family_id))
    or (r.visibility = 'private' and r.author_id = auth.uid())
  ));
$$;

drop policy comments_read on comments;
create policy comments_read on comments for select using (can_read_recipe_privately(recipe_id));
```

- [ ] **Step 4: Apply and verify all six pass**

Run: `npx supabase db reset`
Then: `npm run test:int -- public_access`
Expected: PASS, 6 tests.

- [ ] **Step 5: Confirm the whole integration suite still passes**

Run: `npm run test:int`
Expected: PASS. Pay attention to `rls.test.ts` and `child_replace.test.ts`, which exercise the policies this touches.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0021_tighten_public_access.sql tests/integration/public_access.test.ts
git commit -m "fix: two RLS policies that publishing would turn into holes

rtags_write guarded writes with a read predicate, so any stranger who could
see a public recipe could delete its tags. comments_read inherited public
grounds, so publishing a recipe published the family's conversation too.
Both tests were run red against the old policies first."
```

---

### Task 3: Let a published cook's avatar be read

**Files:**
- Create: `supabase/migrations/0022_public_avatars.sql`
- Modify: `tests/integration/public_identity.test.ts` (add one test)

**Interfaces:**
- Consumes: `profiles.handle` from Task 1.
- Produces: storage policy `avatars_public_read`, which is what makes Task 9's Worker route possible at all.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/public_identity.test.ts`, inside the existing `describe`:

```ts
  it("lets a stranger read the avatar object of a published cook only", async () => {
    // The Worker signs avatars with the ANON key, by design: it holds no service key, so a
    // path the anon role cannot select is a path the Worker cannot serve.
    await admin.storage.from("avatars").upload(`${cookId}/a.png`, new Blob(["x"]));
    const { data, error } = await anon.storage.from("avatars")
      .createSignedUrl(`${cookId}/a.png`, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toContain("token");
  });

  it("does not let a stranger read the avatar of a cook with no handle", async () => {
    const quiet = await makeUser(`quiet-av-${Date.now()}@test.dev`);
    await admin.storage.from("avatars").upload(`${quiet.id}/a.png`, new Blob(["x"]));
    const { error } = await anon.storage.from("avatars")
      .createSignedUrl(`${quiet.id}/a.png`, 60);
    expect(error).not.toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:int -- public_identity`
Expected: FAIL on the first new test. `createSignedUrl` returns an error because no policy lets anon select that object. The second new test PASSES already, which is correct and must keep passing.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0022_public_avatars.sql`:

```sql
-- 0022: a published cook's avatar has to be readable by the anonymous role, because the
-- Worker route that serves it holds only the anon key. 0015 made this bucket private on
-- the grounds that "a public object URL is readable by anyone who ever sees it, forever,
-- outside RLS". That reasoning is untouched here: the bucket stays private, every URL is
-- still signed and short-lived, and unpublishing (clearing the handle) revokes access
-- immediately because the policy is evaluated per request.
create policy avatars_public_read on storage.objects for select using (
  bucket_id = 'avatars'
  and exists (select 1 from profiles p
              where p.id = ((storage.foldername(name))[1])::uuid
                and p.handle is not null));
```

- [ ] **Step 4: Apply and verify**

Run: `npx supabase db reset`
Then: `npm run test:int -- public_identity`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0022_public_avatars.sql tests/integration/public_identity.test.ts
git commit -m "feat: a published cook's avatar is readable by the anon role

Prerequisite for the Worker avatar route, which holds only the anon key.
0015's private bucket and short-lived signed URLs are both preserved:
clearing a handle revokes access on the next request."
```

---

### Task 4: The public profile API

**Files:**
- Modify: `src/lib/api/profile.ts`
- Modify: `src/lib/api/profile.test.ts`
- Modify: `src/lib/api/types.ts`

**Interfaces:**
- Consumes: `public_cooks`, `public_recipe_bylines` from Task 1.
- Produces:
  - `export interface PublicCook { id: string; handle: string; public_name: string | null; bio: string | null; avatar_url: string | null }`
  - `export interface Byline { handle: string | null; public_name: string | null; family_name: string }`
  - `export function handleError(handle: string): string | null` (null means valid)
  - `export async function updatePublicProfile(p: { handle: string; public_name: string; bio: string }): Promise<void>`
  - `export async function unpublishProfile(): Promise<void>`
  - `export async function getPublicCook(handle: string): Promise<PublicCook | null>`
  - `export async function getByline(recipeId: string): Promise<Byline | null>`
  - `getMyProfile` gains `handle`, `public_name`, `bio` in its select.

- [ ] **Step 1: Add the types**

In `src/lib/api/types.ts`, extend `Profile` and add the two new interfaces:

```ts
export interface Profile {
  id: string; display_name: string; avatar_url: string | null;
  // every field is optional: a profile created before the column existed reads back as {}
  preferences: Preferences;
  // null handle means "I do not publish". It IS the opt-in.
  handle: string | null; public_name: string | null; bio: string | null;
}
export interface PublicCook {
  id: string; handle: string; public_name: string | null;
  bio: string | null; avatar_url: string | null;
}
export interface Byline {
  handle: string | null; public_name: string | null; family_name: string;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/api/profile.test.ts`:

```ts
import { handleError } from "./profile";

describe("handleError", () => {
  it("accepts a plain lowercase handle", () => {
    expect(handleError("aayush")).toBeNull();
    expect(handleError("cook_2")).toBeNull();
  });
  it("rejects one that is too short or too long", () => {
    expect(handleError("ab")).toMatch(/3/);
    expect(handleError("a".repeat(31))).toMatch(/30/);
  });
  it("rejects uppercase rather than silently lowercasing it", () => {
    // Silently rewriting what someone typed means the handle they were shown is not the one
    // they got. Tell them instead.
    expect(handleError("Aayush")).toMatch(/lowercase/);
  });
  it("rejects characters that would need escaping in a URL", () => {
    expect(handleError("a b")).not.toBeNull();
    expect(handleError("a/b")).not.toBeNull();
    expect(handleError("a.b")).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- profile`
Expected: FAIL, `handleError` is not exported.

- [ ] **Step 4: Implement**

Append to `src/lib/api/profile.ts`:

```ts
// Mirrors the check constraint in 0020 exactly. Kept as a validator rather than a
// transformer: silently lowercasing what someone typed means the handle they were shown is
// not the handle they got.
const HANDLE = /^[a-z0-9_]{3,30}$/;

export function handleError(handle: string): string | null {
  if (handle.length < 3) return "A handle needs at least 3 characters.";
  if (handle.length > 30) return "A handle can be at most 30 characters.";
  if (handle !== handle.toLowerCase()) return "A handle must be lowercase.";
  if (!HANDLE.test(handle)) return "Use only letters, numbers and underscores.";
  return null;
}

export async function updatePublicProfile(
  p: { handle: string; public_name: string; bio: string },
): Promise<void> {
  const problem = handleError(p.handle);
  if (problem) throw new Error(problem);
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles").update({
    handle: p.handle,
    public_name: p.public_name.trim() || null,
    bio: p.bio.trim() || null,
  }).eq("id", data.user.id);
  // The unique constraint is the only authority on whether a handle is free. Checking first
  // and inserting second is a race; letting the constraint answer is not.
  if (error) {
    if (error.code === "23505") throw new Error("That handle is taken.");
    throw new Error(error.message);
  }
}

// Clearing the handle is what unpublishing IS: every public view and the avatars policy are
// gated on `handle is not null`, so this revokes all of them at once.
export async function unpublishProfile(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles")
    .update({ handle: null }).eq("id", data.user.id);
  if (error) throw new Error(error.message);
}

// Reads the view, never the table: a stranger has no policy on profiles.
export async function getPublicCook(handle: string): Promise<PublicCook | null> {
  const { data, error } = await supabase.from("public_cooks")
    .select("id,handle,public_name,bio,avatar_url").eq("handle", handle).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PublicCook | null) ?? null;
}

// A missing byline is normal, not an error: the recipe may not be public, and the caller
// must not be able to tell those two cases apart.
export async function getByline(recipeId: string): Promise<Byline | null> {
  const { data } = await supabase.from("public_recipe_bylines")
    .select("handle,public_name,family_name").eq("recipe_id", recipeId).maybeSingle();
  return (data as Byline | null) ?? null;
}
```

Also extend the select in `getMyProfile`:

```ts
    .select("id,display_name,avatar_url,preferences,handle,public_name,bio").eq("id", data.user.id).single();
```

Add `PublicCook` and `Byline` to the existing type import at the top of the file.

- [ ] **Step 5: Run the tests**

Run: `npm test -- profile`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc -b && npm run lint`

```bash
git add src/lib/api/profile.ts src/lib/api/profile.test.ts src/lib/api/types.ts
git commit -m "feat: public profile API, with the unique constraint as the only judge

Checking whether a handle is free and then claiming it is a race. The
constraint answers instead, and 23505 becomes a readable message."
```

---

### Task 5: Claim a handle from Settings

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/Settings.test.tsx`

**Interfaces:**
- Consumes: `updatePublicProfile`, `unpublishProfile`, `handleError`, `Profile.handle` from Task 4.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Read the existing page before editing it**

Run: `sed -n '1,80p' src/pages/Settings.tsx`
The page is built from `section.plate` blocks. **Match that structure.** Note the standing trap: `.plate` overrides wall colours by specificity, and a new heading or note inside a plate must use the existing `.plate h2` / `.plate .vault-note` rules rather than inventing a colour. Light mode is where a mistake shows.

- [ ] **Step 2: Write the failing test**

Append to `src/pages/Settings.test.tsx`:

```ts
it("claims a handle and reports a taken one", async () => {
  vi.mocked(updatePublicProfile).mockRejectedValueOnce(new Error("That handle is taken."));
  render(<Settings />);
  const input = await screen.findByLabelText(/handle/i);
  fireEvent.change(input, { target: { value: "aayush" } });
  fireEvent.click(screen.getByRole("button", { name: /publish my profile/i }));
  expect(await screen.findByText(/that handle is taken/i)).toBeInTheDocument();
});

it("rejects an invalid handle before calling the API", async () => {
  render(<Settings />);
  const input = await screen.findByLabelText(/handle/i);
  fireEvent.change(input, { target: { value: "Aayush" } });
  fireEvent.click(screen.getByRole("button", { name: /publish my profile/i }));
  expect(await screen.findByText(/lowercase/i)).toBeInTheDocument();
  expect(updatePublicProfile).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- Settings`
Expected: FAIL, no handle field exists.

- [ ] **Step 4: Add the section**

Add a new `section.plate` to `Settings.tsx`, following the existing sections' shape:

```tsx
      <section className="plate">
        <h2>Public profile</h2>
        <p className="vault-note">
          A handle publishes you. Recipes you set to Public show your public name and family,
          and get a page anyone can open. Clearing your handle takes all of that back.
        </p>
        <label htmlFor="handle">Handle</label>
        <input
          id="handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="aayush"
        />
        <p className="vault-note">Your page will be at /cooks/{handle || "your-handle"}</p>
        <label htmlFor="public-name">Public name</label>
        <input id="public-name" value={publicName} onChange={(e) => setPublicName(e.target.value)} />
        <label htmlFor="bio">Bio</label>
        <textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
        {publicError && <p className="form-error" role="alert">{publicError}</p>}
        <button type="button" onClick={handlePublish}>Publish my profile</button>
        {savedHandle && (
          <button type="button" onClick={handleUnpublish}>Stop publishing</button>
        )}
      </section>
```

With the handler, which validates before calling out:

```tsx
  async function handlePublish() {
    setPublicError(null);
    const problem = handleError(handle);
    if (problem) { setPublicError(problem); return; }
    try {
      await updatePublicProfile({ handle, public_name: publicName, bio });
      setSavedHandle(handle);
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUnpublish() {
    setPublicError(null);
    try {
      await unpublishProfile();
      setSavedHandle(null);
      setHandle("");
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : String(err));
    }
  }
```

State, initialised from the profile the page already loads: `handle`, `publicName`, `bio`, `savedHandle`, `publicError`.

- [ ] **Step 5: Run the tests**

Run: `npm test -- Settings`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc -b && npm run lint && npm test`

```bash
git add src/pages/Settings.tsx src/pages/Settings.test.tsx
git commit -m "feat: claim a public handle from Settings

The copy says what publishing exposes and that clearing the handle takes it
back, because the handle is the whole opt-in."
```

---

### Task 6: Let the public routes exist

**Files:**
- Modify: `src/routes.tsx`
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/components/AppLayout.test.tsx` (it already exists, with 1 test)

**READ THIS BEFORE EDITING THE TEST.** `AppLayout.test.tsx` already mocks `../context/FamilyContext` and `../lib/api/auth`, and does **not** mock `AuthContext`. The moment `AppLayout` calls `useAuth()`, that existing test gets the context default of `{ userId: null, loading: true }`, renders the signed-out branch, and its assertion on the Sign out button **fails**. That is a real regression in an existing test, not a flake: add the auth mock and keep the existing test as the signed-in case rather than deleting it.

**Interfaces:**
- Consumes: `useAuth()` from `src/context/AuthContext.tsx`, which returns `{ userId: string | null; loading: boolean }`.
- Produces: `recipes/:id` and `cooks/:handle` reachable with no session, both inside `AppLayout`.

- [ ] **Step 1: Write the failing test**

Add to the EXISTING `src/components/AppLayout.test.tsx`, keeping its `FamilyContext` and `auth` mocks. Add an auth mock whose value the tests reassign, and keep the existing "renders the app shell" test working by setting `mockAuth` to a signed-in value before it:

```tsx
// Hoisted by vi.mock, so mockAuth is read at render time, not at mock time.
let mockAuth: { userId: string | null; loading: boolean } = { userId: "u1", loading: false };
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockAuth }));
vi.mock("./FamilySwitcher", () => ({ default: () => <div>switcher</div> }));

describe("AppLayout", () => {
  it("shows a Sign in link and no family controls when signed out", () => {
    mockAuth = { userId: null, loading: false };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText("switcher")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /my kitchen/i })).not.toBeInTheDocument();
  });

  it("shows the full nav when signed in", () => {
    mockAuth = { userId: "u1", loading: false };
    render(<MemoryRouter><AppLayout /></MemoryRouter>);
    expect(screen.getByText("switcher")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- AppLayout`
Expected: FAIL. The signed-out case renders the family switcher and Sign out, because the layout has never had to consider a visitor.

- [ ] **Step 3: Make the layout session-aware**

In `src/components/AppLayout.tsx`, take `userId` from `useAuth()` and split the header:

```tsx
export default function AppLayout() {
  const navigate = useNavigate();
  const { userId } = useAuth();

  async function handleSignOut() {
    await signOut();
    navigate("/signin");
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/">Family Recipes</Link>
        {/* A visitor arrives here from a shared recipe link. Everything in the signed-in nav
            would bounce them to /signin, so the public header offers the one thing that
            works: signing in. */}
        {userId ? (
          <>
            <nav>
              <NavLink to="/" end>Recipes</NavLink>
              <NavLink to="/kitchen">My Kitchen</NavLink>
              <NavLink to="/families">Families</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </nav>
            <FamilySwitcher />
            <button type="button" onClick={handleSignOut}>Sign out</button>
          </>
        ) : (
          <nav>
            <Link to="/signin" className="action">Sign in</Link>
          </nav>
        )}
      </header>
      <main className="app-main"><Outlet /></main>
    </div>
  );
}
```

- [ ] **Step 4: Split the routes**

In `src/routes.tsx`, add a public group ABOVE the guarded one and remove `recipes/:id` from the guarded group:

```tsx
      {/* Public, and outside RequireAuth for the same family of reasons as /recover above:
          a published recipe must be readable with no session. The Worker already injects
          OpenGraph tags for /recipes/:id, so guarding this route meant every shared link
          advertised a page that answered with a sign-in wall.
          Only these two are public. recipes/:id/edit and recipes/:id/cook stay guarded. */}
      <Route element={<AppLayout />}>
        <Route path="recipes/:id" element={<RecipeDetail />} />
        <Route path="cooks/:handle" element={<CookPage />} />
      </Route>
```

Import `CookPage` from `./pages/CookPage` (Task 8 creates it; create a one-line placeholder component now if Task 8 has not run yet, and delete it there).

- [ ] **Step 5: Run the tests**

Run: `npm test -- AppLayout`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full check and commit**

Run: `npx tsc -b && npm run lint && npm test`

```bash
git add src/routes.tsx src/components/AppLayout.tsx src/components/AppLayout.test.tsx
git commit -m "feat: a published recipe is reachable with no session

The Worker has been injecting OpenGraph tags for /recipes/:id while the
route sat inside RequireAuth, so every shared link previewed correctly and
then showed the person a sign-in wall."
```

---

### Task 7: RecipeDetail degrades for a visitor

**Files:**
- Modify: `src/pages/RecipeDetail.tsx`
- Modify: `src/pages/RecipeDetail.test.tsx` (it already exists, 85 lines, and already mocks `../lib/api/recipes`, `../lib/api/mealPlans`, `../lib/api/photos` and the rest)

**READ THIS BEFORE EDITING THE TEST.** Same trap as Task 6: the existing tests do not mock `AuthContext`, so once `RecipeDetail` calls `useAuth()` they render as a visitor, lose the actions block, and their existing assertions fail. Add `let mockAuth = { userId: "u1", loading: false }` plus `vi.mock("../context/AuthContext", () => ({ useAuth: () => mockAuth }))` so the existing tests stay signed in, and set `mockAuth.userId = null` only inside the new visitor tests. **Reuse the existing mocks; do not rewrite the file.** Add `../lib/api/profile` to the mocked modules for `getByline`.

**Interfaces:**
- Consumes: `useAuth()`; `getByline(recipeId)` from Task 4.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to the existing `src/pages/RecipeDetail.test.tsx`. Its mocked recipe is titled **"Dal"**, not "Momo", so use that title in assertions or the tests will fail for the wrong reason:

```tsx
it("shows a visitor the recipe and the byline, and none of the owner controls", async () => {
  mockAuth = { userId: null, loading: false };
  vi.mocked(getByline).mockResolvedValue({
    handle: "aayush", public_name: "Aayush", family_name: "Pokhrel",
  });
  render(<MemoryRouter initialEntries={["/recipes/r1"]}>
    <Routes><Route path="/recipes/:id" element={<RecipeDetail />} /></Routes>
  </MemoryRouter>);

  expect(await screen.findByText("Dal")).toBeInTheDocument();
  expect(screen.getByText(/Aayush/)).toBeInTheDocument();
  expect(screen.getByText(/Pokhrel/)).toBeInTheDocument();
  // Every one of these would bounce a visitor to /signin, so none may render.
  expect(screen.queryByRole("link", { name: /cook mode/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /add to plan/i })).not.toBeInTheDocument();
  // Comments are gone by RLS, but the section must not render an empty shell either.
  expect(screen.queryByText(/comments/i)).not.toBeInTheDocument();
  // The visibility chip is meaningless to a stranger.
  expect(screen.queryByText("public")).not.toBeInTheDocument();
});

it("does not ask for plans when there is no session", async () => {
  mockAuth = { userId: null, loading: false };
  render(/* as above */);
  await screen.findByText("Dal");
  expect(listPlans).not.toHaveBeenCalled();
});

it("still shows the owner controls when signed in", async () => {
  mockAuth = { userId: "u1", loading: false };
  render(/* as above */);
  expect(await screen.findByRole("link", { name: /cook mode/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- RecipeDetail`
Expected: FAIL. The controls render regardless of session, and `listPlans` is called on mount unconditionally.

- [ ] **Step 3: Implement the degradation**

In `src/pages/RecipeDetail.tsx`:

```tsx
  const { userId } = useAuth();
  const [byline, setByline] = useState<Byline | null>(null);
```

Gate the plans effect, so a visitor makes no request that can only fail:

```tsx
  useEffect(() => {
    if (!userId) { setPlans([]); return; }
    listPlans().then(setPlans).catch(() => setPlans([]));
  }, [userId]);
```

Load the byline for a visitor only. A signed-in member already sees the family context in the nav, and the byline is the thing a stranger lacks:

```tsx
  useEffect(() => {
    if (!id || userId) { setByline(null); return; }
    let ignore = false;
    getByline(id).then((b) => { if (!ignore) setByline(b); }).catch(() => { if (!ignore) setByline(null); });
    return () => { ignore = true; };
  }, [id, userId]);
```

Wrap the whole `div.recipe-actions` block and the `CommentThread` in `{userId && ( ... )}`, wrap the visibility chip in `{userId && ...}`, and render the byline for a visitor:

```tsx
      {byline && (
        <p className="vault-note">
          {byline.public_name ?? "A cook"} &middot; {byline.family_name}
        </p>
      )}
```

**The `?? "A cook"` is load-bearing:** `public_recipe_bylines` left-joins the profile, so a recipe published by a cook who never claimed a handle yields a row with a null name, and the page must still render.

- [ ] **Step 4: Run the tests**

Run: `npm test -- RecipeDetail`
Expected: PASS, 3 tests.

- [ ] **Step 5: Full check and commit**

Run: `npx tsc -b && npm run lint && npm test`

```bash
git add src/pages/RecipeDetail.tsx src/pages/RecipeDetail.test.tsx
git commit -m "feat: RecipeDetail renders for a visitor with no session

Owner controls are absent rather than disabled, because every one of them
would bounce a visitor to /signin. The byline falls back to 'A cook' since
the byline view left-joins a profile that may not exist."
```

---

### Task 8: The cook page

**Files:**
- Create: `src/pages/CookPage.tsx`
- Create: `src/pages/CookPage.test.tsx`
- Modify: `src/lib/api/recipes.ts`
- Modify: `src/lib/api/recipes.test.ts`

**Interfaces:**
- Consumes: `getPublicCook(handle)` from Task 4.
- Produces: `export async function listPublicRecipesByAuthor(authorId: string): Promise<Recipe[]>`.

- [ ] **Step 1: Write the failing API test**

Append to `src/lib/api/recipes.test.ts` a test asserting `listPublicRecipesByAuthor` filters on both `author_id` and `visibility = 'public'`, following the shape the existing tests in that file use for asserting on the query builder.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- recipes`
Expected: FAIL, not exported.

- [ ] **Step 3: Implement the query**

Append to `src/lib/api/recipes.ts`:

```ts
// Both filters are stated even though RLS would refuse a non-public row anyway. RLS decides
// what a stranger MAY see; this decides what the cook page IS, which is their published work
// and not their whole vault as it would appear to a family member calling this.
export async function listPublicRecipesByAuthor(authorId: string): Promise<Recipe[]> {
  const { data, error } = await supabase.from("recipes")
    .select("*").eq("author_id", authorId).eq("visibility", "public")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Recipe[];
}
```

- [ ] **Step 4: Write the failing page test**

Create `src/pages/CookPage.test.tsx`:

```tsx
it("shows a cook and their published recipes", async () => {
  vi.mocked(getPublicCook).mockResolvedValue({
    id: "c1", handle: "aayush", public_name: "Aayush", bio: "Cooks momo.", avatar_url: "c1/a.png",
  });
  vi.mocked(listPublicRecipesByAuthor).mockResolvedValue([
    { id: "r1", title: "Momo" } as Recipe,
  ]);
  render(<MemoryRouter initialEntries={["/cooks/aayush"]}>
    <Routes><Route path="/cooks/:handle" element={<CookPage />} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByText("Aayush")).toBeInTheDocument();
  expect(screen.getByText("Cooks momo.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Momo" })).toHaveAttribute("href", "/recipes/r1");
});

it("says not found for an unknown or unpublished handle", async () => {
  vi.mocked(getPublicCook).mockResolvedValue(null);
  render(/* as above */);
  expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  // An unknown handle and an unpublished cook must read identically.
  expect(screen.queryByText(/unpublished|private/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm test -- CookPage`
Expected: FAIL, the module does not exist.

- [ ] **Step 6: Implement the page**

Create `src/pages/CookPage.tsx`. It loads the cook, then their recipes, renders `public_name`, `bio`, an `<img src={"/avatar/" + handle + ".jpg"}>` (Task 9 serves it; a broken image before then is acceptable and must not break the page), and a list of links to `/recipes/:id`. An unknown handle and an unpublished cook both render the same "Cook not found." note. Use the existing `section.plate` structure.

- [ ] **Step 7: Run the tests**

Run: `npm test -- CookPage`
Expected: PASS.

- [ ] **Step 8: Full check and commit**

Run: `npx tsc -b && npm run lint && npm test`

```bash
git add src/pages/CookPage.tsx src/pages/CookPage.test.tsx src/lib/api/recipes.ts src/lib/api/recipes.test.ts
git commit -m "feat: a public cook page at /cooks/:handle

An unknown handle and an unpublished cook render identically, so the page
cannot be used to discover who exists."
```

---

### Task 9: The Worker avatar route

**Files:**
- Modify: `worker/meta.ts`
- Modify: `worker/meta.test.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: `avatars_public_read` from Task 3; `public_cooks.avatar_url` from Task 1.
- Produces: `export function avatarHandleFromPath(pathname: string): string | null`; the route `/avatar/:handle.jpg`.

- [ ] **Step 1: Write the failing test**

Append to `worker/meta.test.ts`:

```ts
describe("avatarHandleFromPath", () => {
  it("matches a handle", () => {
    expect(avatarHandleFromPath("/avatar/aayush.jpg")).toBe("aayush");
    expect(avatarHandleFromPath("/avatar/cook_2.jpg")).toBe("cook_2");
  });
  it("refuses anything that is not a handle", () => {
    // Anchored, and the same character class as the DB constraint, so a path cannot smuggle
    // a traversal or a query into the PostgREST filter this value is interpolated into.
    expect(avatarHandleFromPath("/avatar/../secret.jpg")).toBeNull();
    expect(avatarHandleFromPath("/avatar/Aayush.jpg")).toBeNull();
    expect(avatarHandleFromPath("/avatar/a.jpg")).toBeNull();
    expect(avatarHandleFromPath("/avatar/aayush.png")).toBeNull();
    expect(avatarHandleFromPath("/avatar/aayush.jpg/more")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- worker/meta`
Expected: FAIL, not exported.

- [ ] **Step 3: Implement the matcher**

In `worker/meta.ts`, beside the existing `OG_PATH`:

```ts
// Same character class as the handle check constraint in 0020, and anchored. This value is
// interpolated into a PostgREST filter, so the pattern is the sanitiser: nothing outside
// [a-z0-9_] can reach it.
const AVATAR_PATH = new RegExp("^/avatar/([a-z0-9_]{3,30})\\.jpg$");

export function avatarHandleFromPath(pathname: string): string | null {
  const match = AVATAR_PATH.exec(pathname);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Run the matcher tests**

Run: `npm test -- worker/meta`
Expected: PASS.

- [ ] **Step 5: Add the route**

In `worker/index.ts`, add the serve function next to `serveOgImage`, reusing its structure and its reasoning:

```ts
// Same shape and the same security model as serveOgImage: the anon key is the only
// credential, so a row coming back from public_cooks IS the proof this cook publishes, and
// a signable avatar object IS the proof the 0022 policy allows it. The image is proxied
// rather than redirected, so clearing a handle revokes this URL on the next request instead
// of leaving a signed URL working in someone's cache.
async function serveAvatar(env: Env, handle: string): Promise<Response> {
  try {
    const cookUrl = `${env.SUPABASE_URL}/rest/v1/public_cooks?handle=eq.${handle}&select=avatar_url&limit=1`;
    const cookResponse = await fetch(cookUrl, { headers: supabaseHeaders(env) });
    if (!cookResponse.ok) return notFound();
    const cooks = (await cookResponse.json()) as Array<{ avatar_url: string | null }>;
    const path = cooks.length > 0 ? cooks[0].avatar_url : null;
    if (!path) return notFound();

    const signUrl = `${env.SUPABASE_URL}/storage/v1/object/sign/avatars/${path}`;
    const signResponse = await fetch(signUrl, {
      method: "POST",
      headers: { ...supabaseHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!signResponse.ok) return notFound();
    const signed = (await signResponse.json()) as { signedURL?: string };
    if (!signed.signedURL) return notFound();

    const imageResponse = await fetch(`${env.SUPABASE_URL}/storage/v1${signed.signedURL}`);
    if (!imageResponse.ok) return notFound();
    return new Response(imageResponse.body, {
      headers: {
        "Content-Type": imageResponse.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return notFound();
  }
}
```

And in the `fetch` handler, after the `ogId` branch:

```ts
    const avatarHandle = avatarHandleFromPath(pathname);
    if (avatarHandle) return serveAvatar(env, avatarHandle);
```

Add `avatarHandleFromPath` to the existing import from `./meta`.

- [ ] **Step 6: Full check and commit**

Run: `npx tsc -b && npm run lint && npm test`

```bash
git add worker/meta.ts worker/meta.test.ts worker/index.ts
git commit -m "feat: serve a published cook's avatar from a stable Worker URL

Anon key only, same as the OG image route: a row from public_cooks is the
proof the cook publishes. Proxied rather than redirected, so clearing a
handle revokes the URL on the next request."
```

---

### Task 10: Publishing a recipe requires a handle

**Files:**
- Modify: `src/components/VisibilitySelect.tsx`
- Create: `src/components/VisibilitySelect.test.tsx`

**Interfaces:**
- Consumes: `getMyProfile()` (now returning `handle`) from Task 4.
- Produces: nothing.

- [ ] **Step 1: Read the component first**

Run: `cat src/components/VisibilitySelect.tsx`
Note its existing props before changing its signature; `RecipeCreate` and `RecipeEdit` both render it.

- [ ] **Step 2: Write the failing test**

Create `src/components/VisibilitySelect.test.tsx`:

```tsx
it("warns instead of publishing when the cook has no handle", async () => {
  vi.mocked(getMyProfile).mockResolvedValue({ handle: null } as Profile);
  const onChange = vi.fn();
  render(<MemoryRouter><VisibilitySelect value="family" onChange={onChange} /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText(/visibility/i), { target: { value: "public" } });
  expect(await screen.findByText(/claim a handle/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
});

it("publishes without complaint once a handle exists", async () => {
  vi.mocked(getMyProfile).mockResolvedValue({ handle: "aayush" } as Profile);
  const onChange = vi.fn();
  render(<MemoryRouter><VisibilitySelect value="family" onChange={onChange} /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText(/visibility/i), { target: { value: "public" } });
  expect(onChange).toHaveBeenCalledWith("public");
  expect(screen.queryByText(/claim a handle/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- VisibilitySelect`
Expected: FAIL, no warning exists.

- [ ] **Step 4: Implement**

Load the profile once, and when `public` is chosen with a null handle, show a note linking to Settings. **Still call `onChange`**: the recipe is genuinely public either way because `recipes_read` does not consult the handle, and blocking the selection would be a lie about what the database does. The byline view's left join is what makes this safe, and the note is what makes it honest.

- [ ] **Step 5: Run the tests, then everything**

Run: `npm test -- VisibilitySelect`
Then: `npx tsc -b && npm run lint && npm test && npm run test:int`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/VisibilitySelect.tsx src/components/VisibilitySelect.test.tsx
git commit -m "feat: prompt for a handle when publishing a recipe

The selection still goes through, because recipes_read does not consult the
handle and pretending otherwise would misstate what the database does. The
byline view's left join covers the no-handle case."
```

---

## Deploy, in this order

**The order is not advice.** Shipping a frontend ahead of its migration broke recipe saving in production on 2026-09-27.

- [ ] Apply migrations to cloud: `npx supabase db push`
- [ ] Verify: `npx supabase migration list --linked` shows `0022` remote, with no `"remote":""` rows
- [ ] Push to master, which is what deploys the frontend
- [ ] Verify live, signed OUT, in a real browser: open a public recipe's URL and confirm the page renders with a byline and no owner controls; open `/cooks/<handle>`; confirm the avatar loads from `/avatar/<handle>.jpg`
- [ ] Verify the negative case: a `family` recipe's URL signed out must show "Recipe not found", not its contents
- [ ] Verify in the SQL editor that comments on a published recipe are still visible to the family and invisible to `anon`

## Self-review notes

**Four errors found by grepping the paths, and fixed before this plan was committed.** The
handover names "a plan's self-review must grep the paths, not just check type consistency" as
a repeated failure here, and it caught all four:
1. `create_family_with_owner` does not exist. The only family RPC is `join_family_by_code`;
   families are made with two `admin` inserts. Both integration test setups were wrong.
2. `src/components/AppLayout.test.tsx` already exists and was marked Create.
3. `src/pages/RecipeDetail.test.tsx` already exists (85 lines) and was marked Create.
4. Neither existing test file mocks `AuthContext`, so adding `useAuth()` to those two
   components breaks tests that pass today. Both tasks now say so explicitly.


**Spec coverage.** Every spec section maps to a task: data model (1), the two views (1), RLS fixes (2), avatars (3 + 9), routes (6), degradation (7), cook page (8), error handling (7, 8, 9), testing (throughout). The publish guard (10) is not in the spec; it was implied by "the UI will require a handle before letting you publish" and is now explicit.

**Deliberately not built**, all recorded in the spec's Out of scope: follow, feed, save, fork, moderation, browse and search across public recipes, a reserved-handle blocklist, cook page OpenGraph.

**Known risk to watch during execution.** `RecipeDetail` has four `useEffect` blocks and Task 7 adds a fifth. The hooks-order bug this repo already hit (`8ac01b2`, sensors declared after an early return) is the failure mode here too. Every new hook must sit above the `if (loading)` / `if (!recipe)` returns at lines 115 to 116.
