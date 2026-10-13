-- 0047: the six holes a security audit found on 2026-10-12, and the shape that stops each
-- one coming back. The matching locks are the two new checks in supabase/rls.test.ts.
--
-- FIVE OF THE SIX WERE THE SAME MISTAKE: a policy written before the column it needed to
-- constrain existed. Postgres silently reuses the `using` expression as the check when
-- `with check` is omitted, so each of these policies read correctly and constrained only
-- which rows you could TOUCH, never what you could turn them INTO. `profiles_self_update`
-- was written in 0002, when profiles had four harmless columns. 0028 added `is_moderator`
-- to the same table four years of migrations later. Nobody reopened 0002, because nobody
-- ever reopens a policy when they add a column.
--
-- So the rule this migration adopts, and rls.test.ts now enforces: WRITE `with check` ON
-- EVERY UPDATE POLICY, even when it duplicates `using` word for word. An explicit redundant
-- clause is a decision somebody can review. A missing one is indistinguishable from an
-- accident, and here it was always an accident.

-- ---------------------------------------------------------------------------------------
-- 1. ANYONE COULD JOIN ANY FAMILY, AS OWNER.
--
-- `members_self_insert` checked `user_id = auth.uid()` and nothing else: who you are, never
-- which family you are joining or what role you are claiming. `family_id` is not a secret,
-- since `recipes_read` hands every column of every public recipe to anon. Two requests made
-- any stranger an owner of any family: read the whole vault, rewrite or delete its recipes,
-- and remove the real owners via `members_delete`.
--
-- The fix is not a cleverer check. BOTH legitimate ways into this table are already SECURITY
-- DEFINER functions, so the table needs no insert policy at all: `join_family_by_code` for
-- the invite path, and `create_family` below for the creator path, which had no function
-- only because the client inserted the owner row itself. RLS with no insert policy denies
-- every direct insert. That is the strictest setting available and the one that cannot rot
-- as columns are added.
--
-- CORRECTION, later the same day, after a full audit: this paragraph claimed that the
-- venue families of 0044 were now unjoinable BY CONSTRUCTION. THAT WAS FALSE. Dropping the
-- direct insert policy closes one of the two ways into family_members and leaves
-- join_family_by_code, which is SECURITY DEFINER and had no venue exclusion. Every family
-- gets a default invite_code and families_member_read lets the row's CREATOR read it, and
-- the publishing user is the venue family's `created_by`, so they could read their own
-- venue family's code and join it. Migration 0051 actually enforces the invariant.
-- The lesson is kept here deliberately: a comment asserting a guarantee the code does not
-- enforce is worse than no comment, because 0050 was later built on exactly this one.
drop policy members_self_insert on family_members;
drop policy families_insert on families;

-- Replaces the client's two-step create (insert family, then insert owner row), which was
-- also not atomic: the second insert failing left an orphan family nobody could join or see.
create function create_family(p_name text) returns families
language plpgsql security definer set search_path = public as $$
declare f families;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a family needs a name' using errcode = 'check_violation';
  end if;
  insert into families (name, created_by) values (trim(p_name), auth.uid()) returning * into f;
  insert into family_members (family_id, user_id, role) values (f.id, auth.uid(), 'owner');
  return f;
end; $$;
revoke execute on function create_family(text) from public, anon;
grant execute on function create_family(text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. ANY USER COULD MAKE THEMSELVES A MODERATOR.
--
-- One PATCH to your OWN row, which the policy was perfectly happy to allow:
--   PATCH /rest/v1/profiles?id=eq.<me>  {"is_moderator": true}
-- `is_moderator()` then returned true for the attacker, and that flag is the only gate on
-- the admin edge function's service-role client (listUsers, delete_user, set_moderator,
-- suspend, takedown_recipe) as well as on report_moderate, appeal_moderate, resolve_report
-- and resolve_appeal. The same hole let a suspended cook write {"suspended_at": null} and
-- lift their own sanction, which is the entire moderation spine of 0028, 0030 and 0035.
--
-- COLUMN PRIVILEGES, NOT A CLEVERER POLICY. A `with check` that froze today's privileged
-- columns would have to be reopened every time a column is added to profiles, which is
-- exactly the thing that did not happen for four years. A grant list fails CLOSED instead:
-- the next privileged column added to this table is unwritable by anyone until somebody
-- names it here on purpose.
revoke update on profiles from anon, authenticated;
grant update (display_name, avatar_url, preferences, handle, public_name, bio)
  on profiles to authenticated;

drop policy profiles_self_update on profiles;
create policy profiles_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Terms acceptance is deliberately NOT in the grant above. It is a legal record, and a cook
-- must not be able to write "I accepted v3" without having been shown v3. The whole
-- TERMS_VERSION mechanism in TermsGate.tsx, and the fingerprint test that guards it, are
-- worthless if the row they read back is forgeable by the person it describes.
create function record_terms_acceptance(p_version text) returns void
language sql security definer set search_path = public as $$
  update profiles set terms_accepted_at = now(), terms_version = p_version
  where id = auth.uid();
$$;
revoke execute on function record_terms_acceptance(text) from public, anon;
grant execute on function record_terms_acceptance(text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. YOU COULD MOVE YOUR OWN ROW INTO A STRANGER'S FAMILY.
--
-- `recipes_insert` checks `is_family_member(family_id)`. `recipes_update` did not, and with
-- no `with check` the insert-time guarantee was undone one statement later:
--   PATCH /rest/v1/recipes?id=eq.<my recipe>  {"family_id":"<victim>","visibility":"family"}
-- The row then sat in a vault the author had never joined, in its search results and on its
-- shelves, carrying whatever `story` and `source_url` the attacker wanted in front of them.
-- `meal_plans` had the identical hole with `is_shared`.
--
-- The check requires membership of the DESTINATION family, which is what makes moving a row
-- impossible rather than merely awkward.
--
-- CORRECTION, later the same day, after a full audit: this paragraph concluded that a
-- kitchen publisher "can no longer edit that public snapshot directly". THAT WAS TRUE ONLY
-- OF THE recipes ROW. ing_write, step_write, photo_write and rtags_write were author-or-owner
-- with no membership test, and recipes_delete was author-or-owner, so the publisher could
-- still rewrite the published ingredients and steps and delete the recipe outright, which
-- cascades kitchen.published_snapshots. Migration 0050 gives those five the same
-- requirement. Tightening one policy and leaving its five siblings is what left the gap.
drop policy recipes_update on recipes;
create policy recipes_update on recipes for update
  using (author_id = auth.uid() or exists (select 1 from family_members
    where family_id = recipes.family_id and user_id = auth.uid() and role = 'owner'))
  with check (is_family_member(family_id)
    and (author_id = auth.uid() or exists (select 1 from family_members
      where family_id = recipes.family_id and user_id = auth.uid() and role = 'owner')));

drop policy plans_update on meal_plans;
create policy plans_update on meal_plans for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and is_family_member(family_id));

-- ---------------------------------------------------------------------------------------
-- 4. AN AUTHOR COULD UNDO A MODERATOR'S TAKEDOWN.
--
-- enforce_publish_rules says in its own comment "Only a moderator clears removed_at", and
-- nothing anywhere enforced that. `removed_at` and `removed_reason` were ordinary columns
-- on a row the author may update, so a taken-down recipe went back up with one request:
--   PATCH /rest/v1/recipes?id=eq.<mine>  {"removed_at":null,"visibility":"public"}
-- The trigger only ever fired on the way IN to public with removed_at still set, so clearing
-- both in the same statement sailed through the check that existed to stop precisely this.
--
-- WHO IS ALLOWED, AND WHY IT IS NOT JUST is_moderator(). The first version of this guard
-- was `and not is_moderator()` alone, and the integration test caught it refusing the
-- SERVICE ROLE: supabase/functions/admin takes a recipe down with a service-role client,
-- which is not a moderator and never will be, so takedown_recipe would have started failing
-- in production the day this shipped. The moderator check belongs to that function's own
-- gate, not to this trigger.
--
-- The role has to come out of the JWT claims and NOT out of `current_user`, which is the
-- trap underneath the first version: inside a SECURITY DEFINER function current_user is the
-- function's OWNER, so every caller looks like postgres and the guard would never fire at
-- all. `request.jwt.claims` is set by PostgREST per request and survives into here.
--
-- So three callers get through, and nobody else:
--   - a moderator, which is the intended path, via resolve_report (0030) or resolve_appeal
--     (0035). Those are definer functions that already demanded is_moderator() of the person
--     who called them, and is_moderator() is only trustworthy at all because section 2 above
--     made the flag unforgeable.
--   - the service role, which is the admin console's own key. It never reaches a browser and
--     it bypasses RLS by design, so it is already trusted with strictly more than this.
--   - a direct database session, where there are no JWT claims at all: a migration, psql, or
--     a maintenance script. Anyone holding that already holds the whole database.
create or replace function enforce_publish_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_suspended timestamptz;
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if tg_op = 'UPDATE'
     and (new.removed_at is distinct from old.removed_at
          or new.removed_reason is distinct from old.removed_reason)
     and v_claims is not null
     and coalesce(v_claims::json ->> 'role', '') <> 'service_role'
     and not is_moderator() then
    raise exception 'only a moderator may change a takedown'
      using errcode = 'insufficient_privilege';
  end if;
  if new.visibility = 'public' then
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

-- ---------------------------------------------------------------------------------------
-- 5. ANYONE COULD ASK WHETHER ANY TWO PEOPLE HAD BLOCKED EACH OTHER.
--
-- These three are SECURITY DEFINER, so they bypass RLS by design, and they took the subject
-- of the question as a parameter without ever tying it to the caller. 0029's comment claims
-- they are safe because they "never reveal WHO blocked whom". That is true when the app
-- calls them and false when the caller picks both arguments:
--   POST /rest/v1/rpc/hidden_from_feed {"p_viewer":"<victim>","p_author":"<target>"}
-- answered, for any stranger with no account at all, whether one person had blocked or muted
-- another. `blocks` is specified as "a block the other person can discover is not a block",
-- so this broke a product promise and not merely a boundary.
--
-- Pinning the viewer side to auth.uid() keeps every real caller working, because the app
-- only ever asks about the person doing the looking. A caller still learns whether someone
-- blocked THEM, which is inherent to a symmetric hiding rule and is accepted in the spec.
-- The third-party probe is what closes.
-- COALESCE IS LOAD-BEARING, not tidiness. `auth.uid()` is NULL for a signed-out visitor, and
-- `null in (a, b)` is NULL, not false. Both of these are consumed with `not` in front of them
-- (0023's follow policy reads `not blocked_between(...)`, and search_recipes reads
-- `or not hidden_from_feed(auth.uid(), r.author_id)`), and `not null` is null, which a WHERE
-- clause drops exactly as if it were false. The first version of this fix returned NULL to
-- anonymous callers and would therefore have HIDDEN PUBLIC RECIPES FROM SIGNED-OUT VISITORS,
-- silently, in the public feed. An integration test caught it. A three-valued boolean leaking
-- into a policy is its own category of bug: pin the result to true or false at the boundary.
create or replace function blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() = a or auth.uid() = b, false) and exists (
    select 1 from blocks bl where bl.kind = 'block'
      and ((bl.blocker_id = a and bl.blocked_id = b)
        or (bl.blocker_id = b and bl.blocked_id = a)));
$$;

create or replace function hidden_from_feed(p_viewer uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_viewer = auth.uid(), false) and exists (
    select 1 from blocks bl
    where (bl.blocker_id = p_viewer and bl.blocked_id = p_author)
       or (bl.blocker_id = p_author and bl.blocked_id = p_viewer and bl.kind = 'block'));
$$;

-- name_cleared_and_unset is the third function of this shape and is deliberately NOT pinned.
-- It cannot be: search_recipes passes the AUTHOR of each row it renders, never the caller,
-- and it has to stay callable by anon for the public feed to work at all. It is also not an
-- oracle in the way the other two were, because a cleared-and-unset cook's byline is visibly
-- absent from that same feed: it answers a question anyone can already answer by looking,
-- about a cook whose row they can already see. It is named in DELIBERATELY_UNCHECKED in
-- rls.test.ts with that reasoning, so the lock stays on and the exception is written down.
-- The grant is narrowed off the `public` pseudo-role all the same, so a role added later
-- does not silently inherit execute on it.
revoke execute on function name_cleared_and_unset(uuid) from public;
grant execute on function name_cleared_and_unset(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 6. THE SIX UPDATE POLICIES THAT WERE RIGHT BY LUCK.
--
-- None of these six is exploitable: for each, the `using` expression happens to also forbid
-- the harmful new row when Postgres reuses it as the check. That is luck, and it is exactly
-- the luck that ran out on profiles, recipes and meal_plans above when a column was added.
-- Restated with the clause written out, so the next reader sees a decision.
drop policy families_owner_update on families;
create policy families_owner_update on families for update
  using (exists (select 1 from family_members
    where family_id = families.id and user_id = auth.uid() and role = 'owner'))
  with check (exists (select 1 from family_members
    where family_id = families.id and user_id = auth.uid() and role = 'owner'));

drop policy avatars_update on storage.objects;
create policy avatars_update on storage.objects for update
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1])::uuid = auth.uid())
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1])::uuid = auth.uid());

drop policy report_moderate on reports;
create policy report_moderate on reports for update
  using (is_moderator()) with check (is_moderator());

drop policy drafts_update on recipe_drafts;
create policy drafts_update on recipe_drafts for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy appeal_moderate on appeals;
create policy appeal_moderate on appeals for update
  using (is_moderator()) with check (is_moderator());

-- kitchen.orgs has the same shape and is fixed in 0048, which is kept separate so this
-- migration never names the other schema: supabase/kitchen_seal.test.ts allows exactly the
-- two bridge files to mention both, and this is not one of them.

-- ---------------------------------------------------------------------------------------
-- 7. UPLOADS COULD DECLARE ANY CONTENT TYPE, AND THE WORKER SERVED IT BACK.
--
-- Neither bucket restricted its types, so the Storage REST API accepted an object with
-- `Content-Type: text/html` and stored that type. The Worker proxies these objects FROM THE
-- APP ORIGIN at /og/recipe/<id>.jpg and /avatar/<handle>.jpg, so that HTML came back as a
-- same-origin document, and `script-src 'self'` then permitted a second uploaded object
-- served as text/javascript to run inside it. Serving user content from the app origin is
-- what turns the CSP's no-inline-script guarantee into no guarantee.
--
-- This is the database half. The Worker half is the allowlist in worker/meta.ts, and BOTH
-- are needed: this one cannot fix objects already stored, and the Worker one cannot stop a
-- bucket from accepting the next bad upload.
--
-- image/svg+xml is deliberately absent. An SVG is a document that can carry script, so it
-- is not a safe type to serve from this origin however it was uploaded.
update storage.buckets
  set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
                                 'image/avif']
  where id in ('recipe-photos', 'avatars');
