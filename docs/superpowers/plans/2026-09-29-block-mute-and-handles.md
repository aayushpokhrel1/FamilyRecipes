# Block, Mute and Handles Implementation Plan (sub-project 4b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cook can mute or block another cook without involving a moderator, and impersonation can be reported and remedied by clearing a public name.

**Architecture:** Migration `0029` adds the `blocks` table and wires it into the two places that must respect it: the `follows` insert policy and `search_recipes`. Both are RESTATED IN FULL because they already exist. Migration `0030` lets a report target a cook and adds the `clear_name` action. The frontend adds a blocks API, controls on the cook page, a list in Settings, and a cook-report path.

**Tech Stack:** Supabase (Postgres 15, PostgREST, RLS), React 19 + TypeScript, Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-block-mute-and-handles-design.md`

## Global Constraints

- **All Supabase access lives in `src/lib/api/`.** The client import path is `"../supabaseClient"`.
- **Verify with `npx tsc -b && npm test`.** Migration changes also need `npx supabase db reset` (Docker running).
- **Integration tests need `// @vitest-environment node` on line 1.**
- **Run integration tests:** `SB_URL=http://127.0.0.1:54321 SB_ANON_KEY=<ANON_KEY> SB_SERVICE_KEY=<SERVICE_ROLE_KEY> npm run test:int` (keys from `npx supabase status`).
- **Every object in a PostgREST bulk insert must carry the SAME keys**, and setup writes must check `.error`. A ragged insert failed silently once and made a correct function look broken.
- **Never build a fixture where every row shares the value a rule discriminates on.** Twice now that has made a real rule untestable and shipped a bug.
- **Never write a test term as `prefix + Date.now()`.** `search_recipes` matches with pg_trgm and two timestamps score above the 0.3 threshold. Use random letters.
- **Apply migrations to cloud BEFORE the frontend.**
- **No em dashes or en dashes** anywhere.
- **Migration numbering:** last applied is `0028`. This plan adds `0029` and `0030`.
- **The block copy must say "will not see your recipes in Potluck", never "cannot see".** Public rows stay anon-readable; a promise the architecture cannot keep is worse than the honest weaker feature.

---

### Task 1: Blocks, the follows rule, and the feed filter

**Files:**
- Create: `supabase/migrations/0029_blocks.sql`
- Create: `tests/integration/blocks.test.ts`

**Interfaces:**
- Produces: table `blocks(blocker_id, blocked_id, kind, created_at)`; a restated `follows_write` policy; a restated `search_recipes`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/blocks.test.ts`:

```ts
// @vitest-environment node
// Mute and block, and the two places they must be respected: the follows policy and the
// public catalogue. Both of those already existed, so this file also re-asserts what they
// did BEFORE, not only what is new.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

// A published cook with one public recipe whose title is a random word, so the catalogue
// search below cannot fuzzy-match anything else.
async function cook(prefix: string) {
  const u = await makeUser(`${prefix}-${rand()}@t.dev`);
  const handle = (prefix + rand()).replace(/[^a-z0-9_]/g, "").slice(0, 30);
  await admin.from("profiles").update({ handle, public_name: prefix }).eq("id", u.id);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: u.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: u.id, role: "owner" });
  const title = rand();
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: u.id, title, visibility: "public" })
    .select().single();
  return { u, fam: fam!, rec: rec!, title, handle };
}

const titles = (rows: any[] | null) => (rows ?? []).map((r: any) => r.title);

test("a muted cook's recipes leave your catalogue, and yours stay in theirs", async () => {
  const me = await cook("bm-me");
  const them = await cook("bm-them");
  const { error } = await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "mute" });
  expect(error).toBeNull();

  const mine = await me.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: them.title, p_tag_id: null,
  });
  expect(titles(mine.data)).not.toContain(them.title);

  // mute is ONE WAY: they still see me
  const theirs = await them.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: me.title, p_tag_id: null,
  });
  expect(titles(theirs.data)).toContain(me.title);
}, 30000);

test("a blocked cook's recipes leave your catalogue AND yours leave theirs", async () => {
  const me = await cook("bb-me");
  const them = await cook("bb-them");
  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "block" });

  const mine = await me.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: them.title, p_tag_id: null,
  });
  expect(titles(mine.data)).not.toContain(them.title);

  const theirs = await them.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: me.title, p_tag_id: null,
  });
  expect(titles(theirs.data)).not.toContain(me.title);
}, 30000);

// A block must never reach inside a household. Hiding a recipe from its own family would
// quietly break the vault for everyone in it.
test("a block never hides a recipe inside your own family's vault", async () => {
  const me = await cook("bv-me");
  const them = await makeUser(`bv-them-${rand()}@t.dev`);
  await admin.from("family_members")
    .insert({ family_id: me.fam.id, user_id: them.id, role: "member" });
  const title = rand();
  const { error: recErr } = await admin.from("recipes")
    .insert({ family_id: me.fam.id, author_id: them.id, title, visibility: "family" });
  expect(recErr).toBeNull();

  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.id, kind: "block" });

  const vault = await me.u.client.rpc("search_recipes", {
    p_family_id: me.fam.id, p_search: title, p_tag_id: null,
  });
  expect(titles(vault.data)).toContain(title);
}, 30000);

test("blocking removes an existing follow in both directions", async () => {
  const me = await cook("bf-me");
  const them = await cook("bf-them");
  const a = await me.u.client.from("follows")
    .insert({ follower_id: me.u.id, cook_id: them.u.id });
  expect(a.error).toBeNull();
  const b = await them.u.client.from("follows")
    .insert({ follower_id: them.u.id, cook_id: me.u.id });
  expect(b.error).toBeNull();

  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "block" });

  const { data: left } = await admin.from("follows").select("follower_id,cook_id")
    .or(`and(follower_id.eq.${me.u.id},cook_id.eq.${them.u.id}),and(follower_id.eq.${them.u.id},cook_id.eq.${me.u.id})`);
  expect(left).toEqual([]);
}, 30000);

test("a blocked pair cannot create a follow in either direction", async () => {
  const me = await cook("bn-me");
  const them = await cook("bn-them");
  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "block" });

  const mine = await me.u.client.from("follows")
    .insert({ follower_id: me.u.id, cook_id: them.u.id });
  expect(mine.error).not.toBeNull();
  const theirs = await them.u.client.from("follows")
    .insert({ follower_id: them.u.id, cook_id: me.u.id });
  expect(theirs.error).not.toBeNull();
}, 30000);

// The follows policy is RESTATED by this migration, so what it always did is re-asserted
// here. Migration 0009 exists only because redefining something silently dropped behaviour.
test("an ordinary follow between unblocked cooks still works", async () => {
  const me = await cook("bo-me");
  const them = await cook("bo-them");
  const { error } = await me.u.client.from("follows")
    .insert({ follower_id: me.u.id, cook_id: them.u.id });
  expect(error).toBeNull();
  const { data } = await me.u.client.from("follows").select("cook_id");
  expect((data ?? []).map((r: any) => r.cook_id)).toContain(them.u.id);
}, 30000);

// Unchanged from 0023 and re-asserted for the same reason: you may only follow a cook who
// has published (has a handle).
test("you still cannot follow an unpublished cook", async () => {
  const me = await cook("bu-me");
  const nobody = await makeUser(`bu-nobody-${rand()}@t.dev`);
  const { error } = await me.u.client.from("follows")
    .insert({ follower_id: me.u.id, cook_id: nobody.id });
  expect(error).not.toBeNull();
}, 30000);

// A block the other person can discover is not a block. The read policy is the blocker's
// alone, which is also why nothing notifies them.
test("a blocked cook cannot see that they were blocked", async () => {
  const me = await cook("bs-me");
  const them = await cook("bs-them");
  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "block" });
  const { data } = await them.u.client.from("blocks").select("*");
  expect(data).toEqual([]);
}, 30000);
```

- [ ] **Step 2: Run the tests and watch them ALL fail.** Expected: 8 failed, no `blocks` table.

Do not skip. A policy test nobody has seen fail is not evidence, and in sub-project 3 a denial test passed while the function under test did not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0029_blocks.sql`:

```sql
-- 0029: mute and block. A viewer preference, not moderation: no moderator sees these and the
-- blocked cook is never told.

create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  -- One table with a kind, not two tables. Mute and block differ in what they DO, not in
  -- what they are, and two tables would mean two policies, two queries, and a way to be in
  -- both at once. Changing a mute to a block is then an update, not a delete and an insert.
  kind text not null check (kind in ('mute', 'block')),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

alter table blocks enable row level security;

-- Private to the blocker, exactly like follows. A block the other person can discover is not
-- a block, and this policy is the only reason that holds.
create policy block_own on blocks for all
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- Blocking severs an existing follow in BOTH directions. A trigger rather than application
-- code, so it holds no matter which client does the insert.
create or replace function sever_follows_on_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'block' then
    delete from follows
    where (follower_id = new.blocker_id and cook_id = new.blocked_id)
       or (follower_id = new.blocked_id and cook_id = new.blocker_id);
  end if;
  return new;
end; $$;

create trigger blocks_sever_follows
after insert or update on blocks
for each row execute function sever_follows_on_block();

-- RESTATED IN FULL from 0023. This repo has been bitten twice by redefining something and
-- silently losing part of it: migration 0009 exists only because 0006 dropped a column that
-- way. Everything below except the final `and not exists` is carried over VERBATIM from
-- 0023, including the note about write predicates.
--
-- NOTE the write predicate is about WRITE rights, not readability. Guarding a write with a
-- read predicate is the bug 0003 shipped on recipe_tags and 0005 had to fix.
drop policy follows_write on follows;
create policy follows_write on follows for all
  using (follower_id = auth.uid())
  with check (
    follower_id = auth.uid()
    and is_published_cook(cook_id)
    -- NEW in 0029: a blocked pair cannot follow either way. A check constraint cannot see
    -- another table, so this has to live in the policy.
    and not exists (
      select 1 from blocks b
      where b.kind = 'block'
        and ((b.blocker_id = cook_id and b.blocked_id = follower_id)
          or (b.blocker_id = follower_id and b.blocked_id = cook_id))
    )
  );

-- RESTATED IN FULL from 0025, for the same reason. Everything is carried over verbatim
-- except the single `and not exists` block marked NEW below.
create or replace function search_recipes(p_family_id uuid, p_search text, p_tag_id uuid default null)
returns setof recipes
language sql stable security invoker set search_path = public, extensions as $$
  -- Normalize the term once: trim it, and treat whitespace-only as "no search".
  -- Trimming has to apply to the MATCHING too, not just the is-it-blank test:
  -- a trailing space (mobile keyboards add one) would otherwise turn into
  -- ilike '%chicken %' and match nothing.
  with q as (select nullif(trim(coalesce(p_search, '')), '') as term)
  select r.*
  from recipes r, q
  where (
      -- A null family id means the public catalogue rather than one household's vault.
      -- Stated explicitly even though RLS would refuse a non-public row to a stranger: RLS
      -- decides what you MAY see, this decides what the query IS. Without it, a signed-in
      -- member calling with null would get their own family's private recipes mixed in.
      (p_family_id is null and r.visibility = 'public')
      or r.family_id = p_family_id
    )
    -- NEW in 0029: mute and block hide the PUBLIC CATALOGUE only, never a household's own
    -- vault. `p_family_id is null` guards that: a block must not reach inside a family and
    -- quietly hide a relative's recipe from the people who live with them.
    and (
      p_family_id is not null
      or not exists (
        select 1 from blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = r.author_id)
           -- the second line is BLOCK only: mute is deliberately one way, so a muted cook
           -- still sees the muter's recipes
           or (b.blocker_id = r.author_id and b.blocked_id = auth.uid() and b.kind = 'block')
      )
    )
    -- Tags stay family-scoped: they are unreadable to a stranger, so a public tag filter
    -- would filter on something the caller cannot see.
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
    case when q.term is null then 0
      else greatest(
        similarity(r.title, q.term),
        coalesce((select max(similarity(i.item, q.term))
          from recipe_ingredients i where i.recipe_id = r.id), 0))
    end desc,
    r.created_at desc;
$$;
```

- [ ] **Step 4: Reset and re-run.** `npx supabase db reset`, then the integration command. Expected: 8 passed in this file, and the whole suite at 84 (76 existing plus 8).

- [ ] **Step 5: Commit** `feat: mute and block, and the two rules that must respect them`

---

### Task 2: Reporting a cook, and clearing a name

**Files:**
- Create: `supabase/migrations/0030_cook_reports.sql`
- Modify: `tests/integration/moderation.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/moderation.test.ts`:

```ts
test("a cook can be reported, and one reporter cannot flood cook reports", async () => {
  const { cook } = await cookWithPublicRecipe("cr-target");
  const reporter = await makeUser(`cr-rep-${rand()}@t.dev`);
  const row = { cook_id: cook.id, reporter_id: reporter.id, reason: "impersonation" };
  const first = await reporter.client.from("reports").insert(row);
  expect(first.error).toBeNull();
  const second = await reporter.client.from("reports").insert(row);
  expect(second.error).not.toBeNull();
}, 30000);

// Exactly one target. A report naming both, or neither, is a bug in whatever wrote it.
test("a report must name exactly one target", async () => {
  const { cook, rec } = await cookWithPublicRecipe("cr-both");
  const reporter = await makeUser(`cr-both-r-${rand()}@t.dev`);
  const both = await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, cook_id: cook.id, reporter_id: reporter.id, reason: "other" });
  expect(both.error).not.toBeNull();
  const neither = await reporter.client.from("reports")
    .insert({ reporter_id: reporter.id, reason: "other" });
  expect(neither.error).not.toBeNull();
}, 30000);

test("a moderator can clear an impersonating public name, and the cook is told", async () => {
  const { cook } = await cookWithPublicRecipe("cr-clear");
  await admin.from("profiles").update({ public_name: "Someone Else" }).eq("id", cook.id);
  const reporter = await makeUser(`cr-clear-r-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ cook_id: cook.id, reporter_id: reporter.id, reason: "impersonation" })
    .select().single();
  const mod = await moderator("cr-clear");
  const { error } = await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "clear_name", p_reason: "impersonation",
  });
  expect(error).toBeNull();
  const { data: p } = await admin.from("profiles")
    .select("public_name,name_cleared_at,name_cleared_reason").eq("id", cook.id).single();
  expect(p!.public_name).toBeNull();
  expect(p!.name_cleared_at).not.toBeNull();
  expect(p!.name_cleared_reason).toBe("impersonation");
}, 30000);

// The handle is the identity in every public URL, so it is deliberately NOT released.
test("clearing a name leaves the handle alone", async () => {
  const { cook } = await cookWithPublicRecipe("cr-handle");
  await admin.from("profiles").update({ handle: `keep${rand()}` }).eq("id", cook.id);
  const { data: before } = await admin.from("profiles").select("handle").eq("id", cook.id).single();
  const reporter = await makeUser(`cr-handle-r-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ cook_id: cook.id, reporter_id: reporter.id, reason: "impersonation" })
    .select().single();
  const mod = await moderator("cr-handle");
  await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "clear_name", p_reason: "impersonation",
  });
  const { data: after } = await admin.from("profiles").select("handle").eq("id", cook.id).single();
  expect(after!.handle).toBe(before!.handle);
}, 30000);
```

`cookWithPublicRecipe` in that file returns `{ cook, fam, rec }`; use it as written.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0030_cook_reports.sql`:

```sql
-- 0030: let a report name a COOK as well as a recipe, and add the remedy for a public name
-- that pretends to be someone else.
--
-- handle is already unique and constrained to ^[a-z0-9_]{3,30}$ by 0020. public_name is free
-- text and always was, which is why the display name, not the handle, is the impersonation
-- vector and the thing this migration can clear.

alter table profiles
  add column name_cleared_at timestamptz,
  add column name_cleared_reason text;

alter table reports
  alter column recipe_id drop not null,
  add column cook_id uuid references profiles(id) on delete cascade,
  add constraint report_has_one_target check (num_nonnulls(recipe_id, cook_id) = 1);

-- The existing reports_one_open_per_reporter index is on (recipe_id, reporter_id) and does
-- NOT cover cook reports: without this sibling, one reporter could flood the queue with cook
-- reports while recipe reports stayed rate limited.
create unique index reports_one_open_cook_per_reporter
  on reports (cook_id, reporter_id) where status = 'open' and cook_id is not null;

-- Restated from 0028 to add one action. Everything else is carried over verbatim.
create or replace function resolve_report(p_report_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_recipe uuid;
  v_cook uuid;
  v_author uuid;
begin
  if not is_moderator() then
    raise exception 'not a moderator' using errcode = 'insufficient_privilege';
  end if;
  if p_action not in ('unpublish', 'suspend', 'dismiss', 'clear_name') then
    raise exception 'unknown action %', p_action using errcode = 'check_violation';
  end if;

  select r.recipe_id, r.cook_id into v_recipe, v_cook
  from reports r where r.id = p_report_id;
  if v_recipe is null and v_cook is null then
    raise exception 'no such report' using errcode = 'no_data_found';
  end if;

  -- The cook to act on: the reported cook, or the reported recipe's author.
  v_author := coalesce(v_cook, (select rec.author_id from recipes rec where rec.id = v_recipe));

  if p_action = 'unpublish' then
    update recipes set visibility = 'family', removed_at = now(), removed_reason = p_reason
    where id = v_recipe;
  elsif p_action = 'suspend' then
    update profiles set suspended_at = now(), suspended_reason = p_reason where id = v_author;
    -- Suspension takes their existing public recipes down too. A cook who may not publish
    -- but whose published recipes stay up is not suspended in any sense a reader would
    -- recognise.
    update recipes set visibility = 'family', removed_at = now(), removed_reason = p_reason
    where author_id = v_author and visibility = 'public';
  elsif p_action = 'clear_name' then
    -- The HANDLE is deliberately untouched. It is the identity in every /cooks/<handle> URL,
    -- so releasing it would break every existing link to that cook, including links their own
    -- family holds. The display name is the lie, not the handle.
    update profiles
       set public_name = null, name_cleared_at = now(), name_cleared_reason = p_reason
     where id = v_author;
  end if;

  update reports
     set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
         resolved_at = now(), resolved_by = auth.uid()
   where id = p_report_id;
end; $$;
```

- [ ] **Step 4: Reset and re-run.** Expected: the whole integration suite at 88 passed.

- [ ] **Step 5: Commit** `feat: report a cook, and clear an impersonating name`

---

### Task 3: The blocks API

**Files:**
- Create: `src/lib/api/blocks.ts`, `src/lib/api/blocks.test.ts`
- Modify: `src/lib/api/types.ts`, `src/lib/api/moderation.ts`, `src/lib/api/moderation.test.ts`

**Interfaces:**
- Produces:
  - `setBlock(cookId: string, kind: "mute" | "block"): Promise<void>` (upsert on the primary key, so changing a mute to a block is one call)
  - `removeBlock(cookId: string): Promise<void>`
  - `listMyBlocks(): Promise<Block[]>`
  - `reportCook(cookId: string, reason: ReportReason, note: string): Promise<void>` in `moderation.ts`, mirroring `reportRecipe` including the best-effort notify
  - type `Block = { blocker_id: string; blocked_id: string; kind: "mute" | "block"; created_at: string }`
  - `Profile` gains `name_cleared_at: string | null; name_cleared_reason: string | null`
  - `ReportRow` gains `cook_id: string | null`

- [ ] **Step 1: Write the failing tests** in `src/lib/api/blocks.test.ts`, mirroring the mock style of `src/lib/api/saves.test.ts` exactly. Cover: `setBlock` upserts with the current user as `blocker_id`; `setBlock` throws the database message; `removeBlock` deletes by `blocked_id`; `listMyBlocks` returns the rows. Add to `moderation.test.ts`: `reportCook` inserts with `cook_id` and no `recipe_id`, and a failing notify does not make it throw.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement**, reading the current user id the way `reportRecipe` in `src/lib/api/moderation.ts` does.
- [ ] **Step 4: Run the tests and `npx tsc -b`.**
- [ ] **Step 5: Commit** `feat: the blocks API seam`

---

### Task 4: Mute, block and report on the cook page

**Files:**
- Modify: `src/pages/CookPage.tsx`, `src/pages/CookPage.test.tsx`

- [ ] **Step 1: Write the failing tests.** Read `src/pages/CookPage.tsx` in full first. Cover:
  - your own cook page offers none of Mute, Block or Report
  - another cook's page offers all three
  - Mute calls `setBlock(cookId, "mute")` and the control then reads "Muted"
  - Block calls `setBlock(cookId, "block")` and the control then reads "Blocked"
  - the block control's copy contains "will not see" and does NOT contain "cannot see"
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** The block control's explanatory line must read:
  `They will not see your recipes in Potluck.`
  **Never "cannot see".** Public recipes stay readable to anyone signed out, so the stronger claim would be false. The test above exists to keep it true.
- [ ] **Step 4: Run the tests. Step 5: Commit** `feat: mute, block and report a cook`

---

### Task 5: Settings, and the cleared-name notice

**Files:**
- Modify: `src/pages/Settings.tsx`, `src/pages/Settings.test.tsx`

- [ ] **Step 1: Write the failing tests.** Cover:
  - the muted and blocked cooks are listed, each with an Undo
  - Undo calls `removeBlock(cookId)` and the row leaves the list
  - an empty list renders a plain line, not an empty box
  - a profile with `name_cleared_at` set shows that the public name was removed, and the reason
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** A block you cannot find again is a trap, which is why the list exists.
- [ ] **Step 4: Run the tests. Step 5: Commit** `feat: manage who you have muted or blocked`

---

### Task 6: Cook reports in the moderation queue

**Files:**
- Modify: `src/pages/Moderation.tsx`, `src/pages/Moderation.test.tsx`, `src/lib/api/moderation.ts`

- [ ] **Step 1: Write the failing tests.** Cover:
  - a cook report renders the cook's name and links to `/cooks/<handle>` rather than a recipe
  - a cook report offers **Clear name**, **Suspend cook** and **Dismiss**, and NOT Unpublish
  - a recipe report still offers Unpublish and not Clear name
  - Clear name calls `resolveReport(id, "clear_name", reason)`
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** `listOpenReports` must also embed the cook: extend its select to `"*, recipes(title), profiles:cook_id(handle,public_name)"` and widen `ReportRow`. Choose the row's actions from whether `cook_id` is set.
- [ ] **Step 4: Run tests and `npx tsc -b`. Step 5: Commit** `feat: act on a reported cook`

---

### Task 7: Deploy

- [ ] **Step 1: Migrations to cloud FIRST:** `npx supabase db push`, then `npx supabase migration list` to confirm `0029` and `0030` are remote.
- [ ] **Step 2: Push the frontend** and let Cloudflare build.
- [ ] **Step 3: Verify on production, signed in:** mute a cook and confirm their recipes leave Potluck; block another and confirm the follow is severed; report a cook and clear the name from `/moderation`; confirm the cleared cook sees the notice in Settings.
- [ ] **Step 4: Update `HANDOVER.md` and `PRODUCT.md`** (4b is no longer missing) and set the spec status to shipped.

## Self-Review

**Spec coverage.** blocks table, the follows rule and the feed filter to Task 1; cook reports and `clear_name` to Task 2; the API to Task 3; the cook page controls to Task 4; Settings to Task 5; the moderation queue to Task 6; deploy to Task 7. The honest-copy rule is enforced by a test in Task 4, not only by prose.

**Known gaps, deliberate.** Nothing tells a cook they were blocked, permanently. There is no blocking of a whole family. No appeals and no audit log, as in 4a.

**Type consistency.** `setBlock(cookId, kind)` and `removeBlock(cookId)` keep the same signatures in Tasks 3, 4 and 5. `resolve_report(p_report_id, p_action, p_reason)` matches between Task 2's SQL and Task 6's call. `kind` is `"mute" | "block"` everywhere.
