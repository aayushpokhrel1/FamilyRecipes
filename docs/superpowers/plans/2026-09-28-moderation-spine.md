# Moderation Spine Implementation Plan (sub-project 4a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in cook can report a public recipe; the moderator reviews reports on an in-app page and can unpublish a recipe, suspend a cook, or dismiss; the author is told why; and everyone accepts terms once.

**Architecture:** One migration adds the `reports` table, moderation columns, an `is_moderator()` helper, RLS, and ONE trigger holding both publish rules. Every moderator action goes through a single `security definer` RPC, `resolve_report`, which is also the only place the moderator check lives. The frontend adds an API module, a report control, a `/moderation` page, a removed banner, and a terms gate.

**Tech Stack:** Supabase (Postgres 15, PostgREST, RLS, Edge Functions), React 19 + TypeScript, Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-28-moderation-spine-design.md`

## Global Constraints

- **All Supabase access lives in `src/lib/api/`.** Nothing outside it imports the client. The client import path is `"../supabaseClient"` (NOT `./client`).
- **Verify with `npx tsc -b && npm test`.** Migration changes also need `npx supabase db reset` (Docker running).
- **Integration tests need `// @vitest-environment node` on line 1.** A file missing it fails in CI.
- **Run integration tests:** `SB_URL=http://127.0.0.1:54321 SB_ANON_KEY=<ANON_KEY> SB_SERVICE_KEY=<SERVICE_ROLE_KEY> npm run test:int` (keys from `npx supabase status`).
- **Every object in a PostgREST bulk insert must carry the SAME keys.** PostgREST builds one column list per batch, so a key missing from one row is sent as NULL instead of the column default. Always check `.error` on a test's setup writes.
- **Never build a test fixture where every row shares the value a rule discriminates on.** A Potluck fixture where every recipe had the active family's id made an own-family guard untestable and shipped a bug.
- **Apply migrations to cloud BEFORE the frontend.** Cloudflare deploys the frontend automatically; Supabase deploys nothing.
- **The edge function is never deployed automatically:** `npx supabase functions deploy notify-report`.
- **No em dashes or en dashes** anywhere.
- **Migration numbering:** last applied is `0027`. This plan adds `0028`.
- **Visibility enum values:** `private`, `family`, `public`.

---

### Task 1: The moderation schema, the publish rules, and the one RPC

**Files:**
- Create: `supabase/migrations/0028_moderation.sql`
- Create: `tests/integration/moderation.test.ts`

**Interfaces:**
- Produces: table `reports`; `profiles.is_moderator|suspended_at|suspended_reason|terms_accepted_at|terms_version`; `recipes.removed_at|removed_reason`; `is_moderator()`; `resolve_report(p_report_id uuid, p_action text, p_reason text)`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/moderation.test.ts`:

```ts
// @vitest-environment node
// The DB half of moderation: who may read reports, who may act, and the two publish rules.
// These live in Postgres, so they are tested against a real one.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

async function cookWithPublicRecipe(prefix: string) {
  const cook = await makeUser(`${prefix}-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: cook.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: cook.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: cook.id, title: `R${rand()}`, visibility: "public" })
    .select().single();
  return { cook, fam: fam!, rec: rec! };
}

async function moderator(prefix: string) {
  const m = await makeUser(`${prefix}-mod-${rand()}@t.dev`);
  await admin.from("profiles").update({ is_moderator: true }).eq("id", m.id);
  return m;
}

test("a signed-in user can report a public recipe, but only once while it is open", async () => {
  const { rec } = await cookWithPublicRecipe("md-rep");
  const reporter = await makeUser(`md-rep-${rand()}@t.dev`);
  const row = { recipe_id: rec.id, reporter_id: reporter.id, reason: "not_a_recipe" };
  const first = await reporter.client.from("reports").insert(row);
  expect(first.error).toBeNull();
  const second = await reporter.client.from("reports").insert(row);
  expect(second.error).not.toBeNull();
  expect(second.error!.message).toMatch(/reports_one_open_per_reporter/);
});

test("a non-moderator cannot read anyone else's reports", async () => {
  const { rec } = await cookWithPublicRecipe("md-read");
  const reporter = await makeUser(`md-read-a-${rand()}@t.dev`);
  await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: reporter.id, reason: "offensive" });
  const nosy = await makeUser(`md-read-b-${rand()}@t.dev`);
  const { data } = await nosy.client.from("reports").select("id");
  expect(data).toEqual([]);
  // but a reporter can still see their own, which is what the "Reported" state reads
  const { data: mine } = await reporter.client.from("reports").select("id");
  expect(mine!.length).toBe(1);
});

test("a non-moderator cannot resolve a report", async () => {
  const { rec } = await cookWithPublicRecipe("md-deny");
  const reporter = await makeUser(`md-deny-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: reporter.id, reason: "offensive" })
    .select().single();
  const { error } = await reporter.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "unpublish", p_reason: "offensive",
  });
  expect(error).not.toBeNull();
  const { data: after } = await admin.from("recipes")
    .select("visibility,removed_at").eq("id", rec.id).single();
  expect(after!.visibility).toBe("public");
  expect(after!.removed_at).toBeNull();
});

test("a moderator can take a recipe down, and the author is told why", async () => {
  const { rec } = await cookWithPublicRecipe("md-down");
  const reporter = await makeUser(`md-down-r-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: reporter.id, reason: "not_a_recipe" })
    .select().single();
  const mod = await moderator("md-down");
  const { error } = await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "unpublish", p_reason: "not_a_recipe",
  });
  expect(error).toBeNull();
  const { data: after } = await admin.from("recipes")
    .select("visibility,removed_at,removed_reason").eq("id", rec.id).single();
  expect(after!.visibility).toBe("family");
  expect(after!.removed_at).not.toBeNull();
  expect(after!.removed_reason).toBe("not_a_recipe");
  const { data: r2 } = await admin.from("reports").select("status").eq("id", rep!.id).single();
  expect(r2!.status).toBe("actioned");
}, 30000);

// Without this rule a takedown means nothing: the author flips it straight back.
test("the author cannot re-publish a recipe that was taken down", async () => {
  const { cook, rec } = await cookWithPublicRecipe("md-back");
  await admin.from("recipes")
    .update({ visibility: "family", removed_at: new Date().toISOString(),
              removed_reason: "offensive" }).eq("id", rec.id);
  const { error } = await cook.client.from("recipes")
    .update({ visibility: "public" }).eq("id", rec.id);
  expect(error).not.toBeNull();
  const { data: after } = await admin.from("recipes")
    .select("visibility").eq("id", rec.id).single();
  expect(after!.visibility).toBe("family");
});

test("clearing removed_at lets the recipe be published again", async () => {
  const { cook, rec } = await cookWithPublicRecipe("md-clear");
  await admin.from("recipes")
    .update({ visibility: "family", removed_at: new Date().toISOString() }).eq("id", rec.id);
  await admin.from("recipes")
    .update({ removed_at: null, removed_reason: null }).eq("id", rec.id);
  const { error } = await cook.client.from("recipes")
    .update({ visibility: "public" }).eq("id", rec.id);
  expect(error).toBeNull();
});

test("a suspended cook cannot publish anything, new or existing", async () => {
  const { cook, fam, rec } = await cookWithPublicRecipe("md-susp");
  await admin.from("recipes").update({ visibility: "family" }).eq("id", rec.id);
  await admin.from("profiles")
    .update({ suspended_at: new Date().toISOString(), suspended_reason: "offensive" })
    .eq("id", cook.id);

  const existing = await cook.client.from("recipes")
    .update({ visibility: "public" }).eq("id", rec.id);
  expect(existing.error).not.toBeNull();

  const fresh = await cook.client.from("recipes")
    .insert({ family_id: fam.id, author_id: cook.id, title: "New", visibility: "public" });
  expect(fresh.error).not.toBeNull();
});

// Sub-project 3 promises the original cook cannot reach into your vault. A takedown is the
// case where that promise bites, so it is pinned here as well as in saved_recipes.test.ts.
test("taking a recipe down leaves copies of it untouched", async () => {
  const { rec } = await cookWithPublicRecipe("md-copy");
  await admin.from("recipe_ingredients").insert({
    recipe_id: rec.id, position: 0, quantity: "1", unit: "cup", item: "rice",
    section: null, optional: false,
  });
  const saver = await makeUser(`md-copy-s-${rand()}@t.dev`);
  const { data: sfam } = await admin.from("families")
    .insert({ name: "md-copy-s", created_by: saver.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: sfam!.id, user_id: saver.id, role: "owner" });
  const { data: copyId } = await saver.client.rpc("save_recipe_to_vault", {
    p_source: rec.id, p_family: sfam!.id,
  });

  const reporter = await makeUser(`md-copy-r-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: reporter.id, reason: "offensive" })
    .select().single();
  const mod = await moderator("md-copy");
  await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "unpublish", p_reason: "offensive",
  });

  const { data: copy } = await admin.from("recipes").select("id").eq("id", copyId).single();
  expect(copy).not.toBeNull();
  const { data: ings } = await admin.from("recipe_ingredients")
    .select("item").eq("recipe_id", copyId);
  expect(ings!.map((i: any) => i.item)).toEqual(["rice"]);
}, 30000);
```

- [ ] **Step 2: Run the tests and watch them ALL fail**

Run the integration command. Expected: 8 failed (no `reports` table, no RPC, no columns).

Do not skip. A permission test nobody has seen fail is not evidence, and in sub-project 3 a denial test passed while the function under test did not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0028_moderation.sql`:

```sql
-- 0028: the moderation spine. Report a recipe, review it, act on it.
--
-- Potluck is opening to strangers, and PRODUCT.md has said since Potluck shipped that the
-- absence of any report, review or takedown path is THE gate on doing that.

alter table profiles
  add column is_moderator boolean not null default false,
  add column suspended_at timestamptz,
  add column suspended_reason text,
  add column terms_accepted_at timestamptz,
  add column terms_version text;

-- A takedown is a STATE, not a deletion. The recipe stays in its author's vault, editable and
-- cookable; it simply stops being public, and the author is told why. A mistaken takedown is
-- therefore reversible, which matters when there is exactly one moderator and no appeals.
alter table recipes
  add column removed_at timestamptz,
  add column removed_reason text;

create table reports (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  reporter_id uuid not null references profiles(id),
  -- a check rather than an enum: adding a value to a Postgres enum is a migration, and this
  -- is a label, not a type
  reason text not null check (reason in
    ('not_a_recipe', 'offensive', 'not_theirs', 'impersonation', 'other')),
  note text,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id)
);

-- One OPEN report per person per recipe, so one angry reporter cannot flood the queue. The
-- partial index lets them report again if a previous report was dismissed and the recipe
-- changed.
create unique index reports_one_open_per_reporter
  on reports (recipe_id, reporter_id) where status = 'open';

create index reports_open_first on reports (created_at desc) where status = 'open';

-- security definer, and the ONLY place the moderator flag is read. A policy that selected
-- from profiles directly would recurse through profiles' own RLS.
create or replace function is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_moderator from profiles p where p.id = auth.uid()), false);
$$;

alter table reports enable row level security;

-- Anyone signed in may report, as themselves.
create policy report_insert on reports for insert
  with check (reporter_id = auth.uid());

-- You see your own reports, which is what the "Reported" state on the button reads back.
-- A moderator sees everything.
create policy report_read on reports for select
  using (reporter_id = auth.uid() or is_moderator());

-- Resolution goes through resolve_report() below, never a direct update.
create policy report_moderate on reports for update using (is_moderator());

-- ONE trigger holding BOTH publish rules, so the rules about becoming public live in one
-- place and are read together.
--
-- READ THIS BEFORE MOVING THESE RULES INTO THE RLS POLICIES. The obvious implementation is a
-- clause on the recipes policies, and this repo has paid twice for redefining an existing
-- policy: a policy's definition is whichever migration last touched it, and migration 0009
-- exists only because 0006 silently dropped a column that way. A trigger is a NEW object and
-- cannot silently change the meaning of a policy that something else depends on.
create or replace function enforce_publish_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_suspended timestamptz;
begin
  if new.visibility = 'public' then
    -- Without this a takedown means nothing: the author simply sets it back to public.
    -- Only a moderator clears removed_at, and clearing it in the same statement is allowed.
    if new.removed_at is not null then
      raise exception 'this recipe was removed from Potluck and cannot be published again'
        using errcode = 'check_violation';
    end if;
    -- security definer matters here: profiles_self_read would hide the author's row from
    -- anyone outside their families, so an invoker check would read null and let a suspended
    -- cook publish.
    select p.suspended_at into v_suspended from profiles p where p.id = new.author_id;
    if v_suspended is not null then
      raise exception 'this account is suspended and cannot publish'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$;

create trigger recipes_enforce_publish_rules
before insert or update on recipes
for each row execute function enforce_publish_rules();

-- Every moderator action, in one place, atomic with the report it resolves. A moderator is
-- neither the author nor a family owner of a reported recipe, so the recipes RLS policies
-- would refuse them; this function is security definer precisely so that the moderator check
-- happens ONCE, here, rather than being widened into those policies.
create or replace function resolve_report(p_report_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_recipe uuid;
  v_author uuid;
begin
  if not is_moderator() then
    raise exception 'not a moderator' using errcode = 'insufficient_privilege';
  end if;
  if p_action not in ('unpublish', 'suspend', 'dismiss') then
    raise exception 'unknown action %', p_action using errcode = 'check_violation';
  end if;

  select r.recipe_id, rec.author_id into v_recipe, v_author
  from reports r join recipes rec on rec.id = r.recipe_id
  where r.id = p_report_id;
  if v_recipe is null then
    raise exception 'no such report' using errcode = 'no_data_found';
  end if;

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
  end if;

  update reports
     set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
         resolved_at = now(), resolved_by = auth.uid()
   where id = p_report_id;
end; $$;
```

- [ ] **Step 4: Reset and re-run**

`npx supabase db reset`, then the integration command. Expected: 8 passed in this file, and the whole suite at 76 passed (68 existing plus 8).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0028_moderation.sql tests/integration/moderation.test.ts
git commit -m "feat: the moderation spine in the database"
```

---

### Task 2: The API module

**Files:**
- Create: `src/lib/api/moderation.ts`
- Create: `src/lib/api/moderation.test.ts`
- Modify: `src/lib/api/types.ts`

**Interfaces:**
- Produces:
  - `reportRecipe(recipeId: string, reason: ReportReason, note: string): Promise<void>`
  - `myReportedIds(recipeIds: string[]): Promise<Set<string>>`
  - `listOpenReports(): Promise<Report[]>`
  - `resolveReport(reportId: string, action: "unpublish" | "suspend" | "dismiss", reason: string): Promise<void>`
  - types `ReportReason`, `Report`; `Recipe` gains `removed_at: string | null; removed_reason: string | null`

- [ ] **Step 1: Add the types**

In `src/lib/api/types.ts` add to `Recipe`:

```ts
  removed_at: string | null;
  removed_reason: string | null;
```

and add:

```ts
export type ReportReason =
  | "not_a_recipe" | "offensive" | "not_theirs" | "impersonation" | "other";

export type Report = {
  id: string;
  recipe_id: string;
  reporter_id: string;
  reason: ReportReason;
  note: string | null;
  status: "open" | "actioned" | "dismissed";
  created_at: string;
};
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/api/moderation.test.ts`. Mirror the mock style of `src/lib/api/saves.test.ts` exactly (same `vi.mock("../supabaseClient", ...)` shape). Cover:

```ts
// reportRecipe sends the current user as reporter_id and throws the database message
// myReportedIds asks ONCE for a whole page of ids and returns a Set
// myReportedIds does not query at all for an empty list
// listOpenReports filters to status "open"
// resolveReport calls the rpc with p_report_id, p_action and p_reason
```

Write these as real `test(...)` blocks with real assertions, in the style of `saves.test.ts`.

- [ ] **Step 3: Run it and watch it fail.** Expected: cannot resolve `./moderation`.

- [ ] **Step 4: Write `src/lib/api/moderation.ts`**

Import the client from `"../supabaseClient"`. `reportRecipe` reads the current user id the same way `src/lib/api/recipes.ts` does for `author_id` and inserts one row. `myReportedIds` selects `recipe_id` from `reports` filtered by `.in("recipe_id", ids)` and returns a Set, returning an empty Set without querying for an empty list, exactly like `listSavedSourceIds` in `src/lib/api/saves.ts`. `listOpenReports` selects reports with `status = "open"` ordered by `created_at` descending. `resolveReport` calls `supabase.rpc("resolve_report", { p_report_id, p_action, p_reason })`. Every function throws `new Error(error.message)` on error.

- [ ] **Step 5: Run the tests and `npx tsc -b`.** Both clean.

- [ ] **Step 6: Commit** `feat: the moderation API seam`

---

### Task 3: Reporting a recipe

**Files:**
- Modify: `src/pages/RecipeDetail.tsx`
- Modify: `src/pages/RecipeDetail.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/RecipeDetail.test.tsx`, reusing the existing `baseRecipe` const and the `vi.mocked(getRecipe).mockResolvedValueOnce(...)` pattern:

- a public recipe that is not yours shows a **Report** control
- your own recipe shows no Report control
- choosing a reason and submitting calls `reportRecipe` with the recipe id and that reason
- once reported the control reads "Reported" and is disabled

Mock `../lib/api/moderation` the way the file already mocks `../lib/api/saves`.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** Put the Report control beside the existing Save button and reuse its visibility condition exactly: `recipe.visibility === "public" && activeFamily && recipe.family_id !== activeFamily.id`. The control opens a small form with a `<select>` of the five reasons (labels: "Not a recipe", "Offensive", "Not theirs to publish", "Impersonation", "Something else") and an optional note `<textarea>`, and a submit button. On submit call `reportRecipe`, then set local state so the control reads "Reported" and is disabled.

- [ ] **Step 4: Run the tests.** All pass, including every existing RecipeDetail test.

- [ ] **Step 5: Commit** `feat: report a recipe from its page`

---

### Task 4: The removed banner and the suspended notice

**Files:**
- Modify: `src/pages/RecipeDetail.tsx`
- Modify: `src/pages/RecipeDetail.test.tsx`

- [ ] **Step 1: Write the failing tests**

- a recipe with `removed_at` set shows "Removed from Potluck" and its reason
- a recipe with no `removed_at` shows no such banner

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** Below the title, when `recipe.removed_at` is set:

```tsx
{recipe.removed_at && (
  // Silent removal is the thing people find most unfair, and this costs one field rendered
  // on a page the author already visits. The recipe is still theirs and still in their vault.
  <p className="removed-banner">
    Removed from Potluck{recipe.removed_reason ? `: ${REASON_LABELS[recipe.removed_reason]}` : ""}.
    It is still in your vault.
  </p>
)}
```

Define `REASON_LABELS` once, in `src/lib/api/types.ts` beside `ReportReason`, and import it in both places rather than writing the five labels twice.

- [ ] **Step 4: Run the tests. Step 5: Commit** `feat: tell the author when their recipe was taken down`

---

### Task 5: The /moderation page

**Files:**
- Create: `src/pages/Moderation.tsx`
- Create: `src/pages/Moderation.test.tsx`
- Modify: `src/routes.tsx`

- [ ] **Step 1: Write the failing test**

Cover, mocking `../lib/api/moderation`:

- a non-moderator sees "Not found" and no report list (the ROUTE checks, it does not rely on the nav hiding it)
- a moderator sees each open report with its recipe title, reason and note
- Unpublish calls `resolveReport(id, "unpublish", reason)` and the row leaves the list
- Suspend cook calls `resolveReport(id, "suspend", reason)`
- Dismiss calls `resolveReport(id, "dismiss", reason)`

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.** `Moderation.tsx` reads the current profile (the app already loads it; follow how `src/pages/Settings.tsx` gets it) and renders "Not found" unless `is_moderator`. Otherwise it lists `listOpenReports()` newest first, each row showing the recipe title as a link, the reason label, the note, and three buttons. After a successful `resolveReport`, drop that row from local state rather than refetching.

Add to `src/routes.tsx` inside the `RequireAuth` group, beside `potluck`:

```tsx
<Route path="moderation" element={<Moderation />} />
```

Do not add it to the nav.

- [ ] **Step 4: Run tests and `npx tsc -b`. Step 5: Commit** `feat: the moderation review page`

---

### Task 6: Terms, and the gate after authentication

**Files:**
- Create: `src/pages/Terms.tsx`
- Create: `src/components/TermsGate.tsx`
- Create: `src/components/TermsGate.test.tsx`
- Modify: `src/routes.tsx`, `src/lib/api/profile.ts`

- [ ] **Step 1: Write the failing test** for `TermsGate`:

- a profile with `terms_accepted_at` null shows the accept screen and not its children
- a profile whose `terms_version` is behind the current version shows the accept screen
- a profile that has accepted the current version shows its children
- clicking Accept calls `acceptTerms` and then reveals the children

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.**

`src/pages/Terms.tsx` is a static page: what may be published, what gets removed, and how to reach a human. Keep it plain and short; it is a document, not a design exercise.

`src/components/TermsGate.tsx` exports `TERMS_VERSION = "2026-09-28"` and wraps its children:

```tsx
// The gate sits AFTER authentication, not on the signup form. A signup checkbox would miss
// Google sign-in, which never touches that form, and would miss every account that already
// exists. One gate covers email signup, Google signup and existing users.
```

Add `acceptTerms(version: string)` to `src/lib/api/profile.ts`, updating `terms_accepted_at` and `terms_version` for the current user.

In `src/routes.tsx`, wrap the existing `RequireAuth` group's element in `<TermsGate>`, and add `<Route path="/terms" element={<Terms />} />` OUTSIDE `RequireAuth`, so the gate can link to it and a signed-out visitor can read it.

- [ ] **Step 4: Run the whole unit suite**, not just the new test: the gate wraps every authed route, so this is the change most likely to break unrelated page tests. Fix any test that now needs a profile that has accepted.

- [ ] **Step 5: Commit** `feat: terms, and a gate that catches every way in`

---

### Task 7: The email nudge

**Files:**
- Create: `supabase/functions/notify-report/index.ts`
- Modify: `src/lib/api/moderation.ts`

- [ ] **Step 1: Write the edge function.** Mirror the structure of `supabase/functions/extract-recipe/index.ts` for CORS, auth and error shape. It:
  - requires an authenticated caller
  - takes `{ reportId }`
  - reads the report and its recipe with the service role
  - sends one mail through Resend to `MODERATION_EMAIL` from the environment
  - never sends to a user-supplied address, and never puts the reporter's identity in the body

- [ ] **Step 2: Call it from `reportRecipe`**, after the insert succeeds:

```ts
// ponytail: best-effort notify. The report ROW is the record; this is only a nudge, so a
// failure here must never fail the report. Calling from the client avoids pg_net, a service
// key stored in the database and a webhook. The cost is that a tab closed at the wrong
// moment loses the EMAIL, never the report, and /moderation still shows it. Move this to a
// database trigger only if a missed email ever actually matters.
void supabase.functions.invoke("notify-report", { body: { reportId } }).catch(() => {});
```

- [ ] **Step 3: Add a unit test** that a failing `notify-report` does NOT make `reportRecipe` throw. This is the whole point of best-effort and it is easy to regress.

- [ ] **Step 4: Run tests and `npx tsc -b`. Step 5: Commit** `feat: email the moderator when a report lands`

---

### Task 8: Deploy

- [ ] **Step 1: Migration to cloud FIRST:** `npx supabase db push`, then `npx supabase migration list` to confirm `0028` is remote. Getting this order backwards has broken production here before.
- [ ] **Step 2: Set the secrets:** `npx supabase secrets set RESEND_API_KEY=... MODERATION_EMAIL=...`
- [ ] **Step 3: Deploy the edge function:** `npx supabase functions deploy notify-report`. It is never deployed automatically, and `ACTIVE` means deployed, not runnable.
- [ ] **Step 4: Make yourself a moderator** on cloud: `update profiles set is_moderator = true where handle = 'yusha';`
- [ ] **Step 5: Push the frontend** and let Cloudflare build.
- [ ] **Step 6: Verify on production, signed in:** report a recipe from another cook, confirm the email arrives, open `/moderation`, take it down, confirm it leaves Potluck and that the author's page shows the banner. Confirm `/moderation` is "Not found" for a non-moderator.
- [ ] **Step 7: Update `HANDOVER.md`, `PRODUCT.md`** (moderation is no longer absent) and set the spec's status to shipped.

## Self-Review

**Spec coverage.** reports table, RLS and both publish rules to Task 1; the API seam to Task 2; reporting to Task 3; the author's banner to Task 4; the review page to Task 5; terms and the gate to Task 6; the email nudge to Task 7; deploy order, secrets and the production pass to Task 8.

**Known gaps, deliberate.** The moderator flag is set by hand in SQL, with no UI, while there is one moderator. Reporting a COOK rather than a recipe is 4b. Blocking, muting and handle rules are 4b. There is no audit log of moderator actions and no appeal path.

**Type consistency.** `resolve_report(p_report_id, p_action, p_reason)` matches between Task 1's SQL and Task 2's `resolveReport`. `ReportReason` and `REASON_LABELS` are defined once in `types.ts` and used by Tasks 3, 4 and 5.
