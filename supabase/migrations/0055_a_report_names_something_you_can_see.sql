-- 0055: the other identity-only insert policies, and a takedown that could WIDEN a recipe.
--
-- `0053` closed `appeal_insert` and named its siblings. This is them. The shape is the same
-- every time: **identity on the owner column is not authority over the subject.** A policy
-- that checks `reporter_id = auth.uid()` is correct about who wrote the row and says nothing
-- about the ids the row carries, which are what the moderator tools later act on.
--
-- `terms_insert_own` (0046) was examined in the same pass and is DELIBERATELY LEFT ALONE. Its
-- row carries no id at all: a `version` string and a timestamp, both of which 0046's own
-- header calls client-side facts on purpose, because the record is of which text the client
-- rendered. Forging it is equivalent to clicking Accept, which the same user may do anyway,
-- and the kitchen gate compares the version string rather than the date, so a forged
-- `accepted_at` passes nothing. The thing actually worth auditing there is that the gate is
-- client-side at all, which is its own unit on the list in `HANDOVER.md`.

-- 1. A REPORT MUST NAME SOMETHING THE REPORTER CAN SEE.
--
-- `report_insert` (0028, extended by 0030 to carry `cook_id` as well) checked only the
-- reporter. So any signed-in account could push ANY recipe id or ANY profile id into the
-- moderation queue: a private recipe, a family recipe belonging to a household they are not
-- in, or a cook with no public presence of any kind. The queue renders `recipes(title)`
-- through the moderator's own RLS, so an unreadable recipe arrives with a NULL title, and the
-- moderator is then asked to judge a report whose subject they cannot see. Acting on it is
-- the damage: `unpublish` sets `removed_at`, and `enforce_publish_rules` (0028) makes that
-- permanent until an appeal reverses it, on a recipe that was never public.
--
-- `can_read_recipe` (0003) and `is_published_cook` (0022) are both security definer and both
-- resolve the caller internally, which is what makes them usable here: a plain subquery on
-- `recipes` inside this policy would answer under the caller's own RLS and could not see a
-- `family` row at all, so it would refuse a legitimate report instead of a forged one.
-- `is_published_cook` is the right question for a cook report rather than "does this profile
-- exist": the report button lives on `/cooks/:handle`, and a cook with no handle has no
-- public surface to have done anything on. `profile.ts` says it outright at `clearHandle`:
-- clearing the handle IS unpublishing, and every public view of a cook is gated on it. The
-- one legitimate casualty is a report submitted in a tab left open after the cook cleared
-- their handle, which is refused. That is the right answer rather than an edge case to
-- apologise for: there is no longer anything public to report.
--
-- Two tests in `moderation.test.ts` reported a cook with no handle and passed, because the
-- old policy looked only at the reporter. They were reporting a cook the UI could not have
-- shown them, and they now publish the cook first.
--
-- 2. THE RESOLUTION COLUMNS ARE NOT THE REPORTER'S TO WRITE.
--
-- `status`, `resolved_at` and `resolved_by` were all insertable by whoever filed the report.
-- Two consequences. A report could be filed already `actioned` or `dismissed`, which keeps it
-- out of `reports_one_open_per_reporter` (partial, `where status = 'open'`) and out of the
-- queue, so a reporter could write unlimited rows that no rate limit saw. And `resolved_by`
-- could name any profile, so the audit trail of who decided what was writable by the person
-- being adjudicated. Nothing in this app reads `resolved_by` yet, which is precisely the
-- argument for pinning it now: it will be read as a record of a decision, and it has never
-- been one.
--
-- RESTATED IN FULL from 0028. `reporter_id = auth.uid()` is carried over verbatim.
drop policy report_insert on reports;
create policy report_insert on reports for insert
  with check (
    reporter_id = auth.uid()
    -- Each target is checked only when present: 0030's `report_has_one_target` constraint
    -- already guarantees exactly one of the two is non-null, and repeating that rule here
    -- would be a second copy of it, which is the copy that drifts.
    and (recipe_id is null or can_read_recipe(recipe_id))
    and (cook_id is null or is_published_cook(cook_id))
    -- A new report is open and unresolved, by anyone's definition of new.
    and status = 'open'
    and resolved_at is null
    and resolved_by is null
  );

-- The same pinning on appeals, which has the same three columns under different names and
-- the same partial index (`appeals_one_open_per_subject`, `where resolved_at is null`) that a
-- pre-resolved row walks straight past. `outcome = 'granted'` on insert also reads back to
-- the cook's own Settings page as a granted appeal, since that page shows them their own
-- rows: a lie the cook tells only themselves, but the undo never happened, so what they are
-- being shown is simply false.
--
-- RESTATED IN FULL from 0035, as amended by 0053. The first two conditions are verbatim.
drop policy appeal_insert on appeals;
create policy appeal_insert on appeals for insert
  with check (
    cook_id = auth.uid()
    and (subject_type <> 'recipe' or own_recipe(subject_id))
    and resolved_at is null
    and outcome is null
    and moderator_note is null
  );

-- 3. A TAKEDOWN MUST NEVER INCREASE WHO CAN SEE A RECIPE.
--
-- `unpublish` wrote `visibility = 'family'` unconditionally. On a PRIVATE recipe that is not a
-- takedown, it is a disclosure: the row moves from "the author alone" to "everyone in the
-- author's household", as the direct result of a moderation action, and the author is then
-- shown a takedown notice on a recipe that was never public. It was only reachable through
-- the hole above, which is exactly why this is fixed as well as that: the guard that depends
-- on another guard is the one that fails when somebody reopens the first.
--
-- `case` rather than `and visibility = 'public'` in the WHERE: `removed_at` must still be set
-- on a non-public recipe, or an unpublish on one would silently do nothing at all and the
-- report would read as actioned. The suspend branch below needs no change, because it already
-- selects `visibility = 'public'` rows only.
--
-- RESTATED IN FULL from 0030, which is the live definition, with that one clause changed.
-- Everything else is carried over VERBATIM.
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
    -- NEW in 0055: a takedown may lower visibility and never raise it.
    update recipes
       set visibility = case when visibility = 'public' then 'family' else visibility end,
           removed_at = now(), removed_reason = p_reason
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

revoke execute on function resolve_report(uuid, text, text) from public, anon;
grant execute on function resolve_report(uuid, text, text) to authenticated, service_role;
