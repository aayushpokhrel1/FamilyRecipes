-- A moderator action names its author.
--
-- Until now a moderator action left its REASON behind and not its ACTOR. `suspended_reason`,
-- `removed_reason` and `name_cleared_reason` all survive; who wrote them does not, except on
-- `reports`, which has carried `resolved_by` since 0028. A reason with no author is the shape of
-- the problem, and it is tolerable with one moderator and not with two. A second one is coming.
--
-- Design: docs/superpowers/specs/2026-10-26-moderation-audit-log-design.md.
--
-- THREE PATHS ACT AS A MODERATOR and this migration makes all three write to one place:
--
--   - `resolve_report` (0055) recorded `resolved_by` and `resolved_at`, but not WHICH of its
--     four actions it took: unpublish, suspend and clear_name all landed as 'actioned'.
--   - `resolve_appeal` (0053) recorded the outcome and a note, and no actor at all.
--   - the `admin` edge function recorded nothing. Its six direct controls wrote only the effect
--     onto the target row. That half is in the function, not here, because it holds the service
--     key; this file is what gives it somewhere to write.

-- ---------------------------------------------------------------------------------------------
-- The trail

create table moderation_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),

  -- PROFILES, NOT auth.users, and the reason is not style. A profile row outlives its login on
  -- purpose (0014), so this keeps the actor's name after that moderator deletes their own
  -- account. A reference to auth.users would instead have been the ninth column to veto an
  -- account deletion: 0059 had to undo eight of those in the kitchen schema, and the refusal
  -- landed with the identity already erased because delete-account blanks the profile FIRST.
  --
  -- Nullable with `set null`, not `cascade`: an event whose actor's profile row is somehow gone
  -- is still a record that the event happened, and losing the row would lose the action too.
  actor_id uuid references profiles(id) on delete set null,

  -- The allowlist is the documentation. `unpublish` is deliberately absent: resolve_report's
  -- unpublish and the console's takedown_recipe do the same thing to the same row, and a reader
  -- asking when a recipe came down should not have to know which door it came through.
  action text not null check (action in (
    'suspend', 'unsuspend',
    'set_moderator', 'unset_moderator',
    'delete_user',
    'takedown_recipe', 'restore_recipe',
    'clear_name', 'restore_name',
    'dismiss_report', 'grant_appeal', 'decline_appeal')),

  -- Which door it came through. Kept even though `action` nearly implies it, because 'suspend'
  -- arrives both ways and "was this a judgement call or a report queue decision" is the first
  -- question anyone reviewing a moderator's work will ask.
  via text not null check (via in ('direct', 'report', 'appeal')),

  -- All four subjects are nullable and at most two are ever set: an action is about a cook, a
  -- recipe, or a cook via a report or an appeal. No check constraint forcing one of them,
  -- deliberately: the writers are three functions in this repo, and a constraint tight enough
  -- to be worth having would have to encode the action-to-subject table, which would then be a
  -- second copy of it that drifts.
  subject_cook uuid references profiles(id) on delete set null,
  subject_recipe uuid references recipes(id) on delete set null,
  report_id uuid references reports(id) on delete set null,
  appeal_id uuid references appeals(id) on delete set null,

  reason text
);

create index moderation_events_at_idx on moderation_events (at desc);
create index moderation_events_subject_cook_idx on moderation_events (subject_cook);

alter table moderation_events enable row level security;

-- ONE SELECT POLICY AND NOTHING ELSE, which is the strictest setting rather than a gap, the same
-- reasoning extract_log carries in rls.test.ts. There is no insert, update or delete policy, so
-- no client can write or alter a row whatever role it holds. The only writers are the two definer
-- functions below, which bypass RLS by definition, and the service-role client in the admin edge
-- function, which bypasses it too.
--
-- An entry a moderator could write by hand, or delete, would be worse than no entry at all,
-- because it would be believed. Same reasoning as record_terms_acceptance in 0047.
--
-- The SUBJECT of an action deliberately cannot read this. It names who acted on them, and
-- handing that over is a safety problem rather than a transparency win.
create policy moderation_events_moderator_read on moderation_events for select
  using (is_moderator());

-- Supabase's `alter default privileges` grants the API roles on every new table, and 0056 is the
-- incident proving a privilege nobody granted is still a privilege: anon held ALL on two views
-- for weeks. RLS already refuses these, so this is the second lock, not the only one.
revoke insert, update, delete on moderation_events from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Promotion is the owner's alone

-- `is_moderator` stays the ONLY answer to "may this person moderate". This narrows one action and
-- adds no third role: there is no surface anywhere that reads is_owner except the set_moderator
-- branch of the admin function.
--
-- IT IS NOT ADDED TO 0047'S UPDATE GRANT, and that omission is the whole mechanism. `profiles`
-- has column-level update grants on six named columns, so a column nobody grants is a column no
-- client can set, and profiles_self_update does not change. That policy gained its `with check`
-- in 0047 precisely because is_moderator had been a one-request path to moderator the day 0028
-- added it to a table whose update policy reused `using` as its check. Do not widen either one.
--
-- There is no action in the admin function that writes this and no UI that offers it. A second
-- owner is a SQL console job, deliberately: the point of the column is that the app cannot hand
-- out the authority that hands out authority.
alter table profiles add column is_owner boolean not null default false;

-- One moderator exists on cloud today, and he is the owner.
--
-- THE ASSERTION IS ONE-SIDED, and the asymmetry is the point. More than one row means this
-- migration just handed the authority that hands out authority to several people, which must
-- never happen quietly, so it refuses. ZERO rows is correct and common: every local `db reset`
-- leaves an empty database with no accounts and no moderator at all, and a fresh clone applies
-- this before anyone has signed up. An `n <> 1` check would have failed every reset.
--
-- Zero on CLOUD would leave set_moderator refusing every caller, which is why this is in the
-- migration output rather than silent: the apply prints the count. It fails loudly at the point
-- of use too, because the function's refusal names the reason.
do $$
declare n int;
begin
  update profiles set is_owner = true where is_moderator = true;
  get diagnostics n = row_count;
  if n > 1 then
    raise exception 'refusing to make % owners; promote one by hand and re-run', n;
  end if;
  raise notice 'is_owner set on % row(s)', n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The two gaps on the existing tables

-- Both are recorded in their own right as well as in the trail, because these are the rows a
-- reader lands on first: the appeals list and the report's own record.

-- `reports` has had resolved_by since 0028. `appeals` never did, so a resolved appeal said what
-- was decided and not by whom.
alter table appeals add column resolved_by uuid references profiles(id) on delete set null;

-- The row said an action happened and not which one. Three of resolve_report's four actions all
-- produced status = 'actioned'.
alter table reports add column resolved_action text;

-- ---------------------------------------------------------------------------------------------
-- resolve_report, restated in full from 0055

-- RESTATED IN FULL, which is how 0055 and 0053 handled these same two functions. Everything is
-- carried over VERBATIM except the two additions marked NEW in 0066. A narrower patch is not
-- available: Postgres has no way to amend a function body.
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
    -- A takedown may lower visibility and never raise it (0055).
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
         resolved_at = now(), resolved_by = auth.uid(),
         -- NEW in 0066. The row said an action happened and not which one.
         resolved_action = p_action
   where id = p_report_id;

  -- NEW in 0066. auth.uid() is the actor, never a parameter: this function takes no actor id and
  -- there is therefore none for a caller to substitute. The subject came out of the report row
  -- above, not out of an argument, for the same reason.
  insert into moderation_events (actor_id, action, via, subject_cook, subject_recipe, report_id, reason)
  values (
    auth.uid(),
    case p_action
      when 'unpublish' then 'takedown_recipe'
      when 'dismiss' then 'dismiss_report'
      else p_action
    end,
    'report',
    v_author,
    -- Only an unpublish is about a specific recipe. A suspension takes several down and naming
    -- one of them would be a claim the row cannot support.
    case when p_action = 'unpublish' then v_recipe else null end,
    p_report_id,
    p_reason);
end; $$;

revoke execute on function resolve_report(uuid, text, text) from public, anon;
grant execute on function resolve_report(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- resolve_appeal, restated in full from 0053

-- Same restatement rule as above. The 0053 guard and its reasoning are carried over verbatim;
-- the additions are marked NEW in 0066.
create or replace function resolve_appeal(p_appeal uuid, p_outcome text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cook uuid;
  v_type text;
  v_subject uuid;
  v_resolved timestamptz;
begin
  if not is_moderator() then
    raise exception 'not a moderator' using errcode = 'insufficient_privilege';
  end if;
  if p_outcome not in ('granted', 'declined') then
    raise exception 'unknown outcome %', p_outcome using errcode = 'check_violation';
  end if;

  select cook_id, subject_type, subject_id, resolved_at
    into v_cook, v_type, v_subject, v_resolved
    from appeals where id = p_appeal;
  if v_cook is null then
    raise exception 'no such appeal' using errcode = 'no_data_found';
  end if;
  -- A declined appeal is final, and a granted one has already done its undo. Resolving
  -- twice would either re-run the undo or overwrite the record of what was decided.
  if v_resolved is not null then
    raise exception 'this appeal is already resolved' using errcode = 'check_violation';
  end if;

  if p_outcome = 'granted' then
    if v_type = 'name' then
      -- The record goes with the remedy: name_cleared_reason is the reason for a clear that
      -- no longer stands, so leaving it would leave a cook carrying a reason for nothing.
      update profiles
         set name_cleared_at = null, name_cleared_reason = null
       where id = v_cook;
    elsif v_type = 'recipe' then
      -- `is distinct from`, not `<>`: a subject whose recipe row is gone gives NULL, and
      -- `NULL <> v_cook` is NULL, which plpgsql skips, so the negated test would not fire for
      -- exactly the rows it is for. That is the 0049 shape (0053).
      if (select author_id from recipes where id = v_subject) is distinct from v_cook then
        raise exception 'that recipe is not this cook''s'
          using errcode = 'insufficient_privilege';
      end if;
      -- removed_at is what enforce_publish_rules (0028) reads, so nulling it is what lets
      -- the recipe be published again. visibility is deliberately NOT touched: the author
      -- decides whether to republish, and this function is not the author.
      update recipes
         set removed_at = null, removed_reason = null
       where id = v_subject;
    elsif v_type = 'suspension' then
      update profiles
         set suspended_at = null, suspended_reason = null
       where id = v_cook;
    end if;
  end if;

  update appeals
     set resolved_at = now(), outcome = p_outcome, moderator_note = p_note,
         -- NEW in 0066. A resolved appeal said what was decided and not by whom.
         resolved_by = auth.uid()
   where id = p_appeal;

  -- NEW in 0066. TWO ROWS for a granted appeal, and that is not duplication: the OUTCOME and the
  -- UNDO it performed are separately interesting. "This appeal was granted" and "this cook's
  -- suspension was lifted on the strength of it" are different facts, and the second is the one
  -- that explains why a suspension in the trail above has no matching unsuspend.
  insert into moderation_events (actor_id, action, via, subject_cook, subject_recipe, appeal_id, reason)
  values (
    auth.uid(),
    case p_outcome when 'granted' then 'grant_appeal' else 'decline_appeal' end,
    'appeal',
    v_cook,
    case when v_type = 'recipe' then v_subject else null end,
    p_appeal,
    p_note);

  if p_outcome = 'granted' then
    insert into moderation_events (actor_id, action, via, subject_cook, subject_recipe, appeal_id, reason)
    values (
      auth.uid(),
      case v_type
        when 'name' then 'restore_name'
        when 'recipe' then 'restore_recipe'
        else 'unsuspend'
      end,
      'appeal',
      v_cook,
      case when v_type = 'recipe' then v_subject else null end,
      p_appeal,
      p_note);
  end if;
end; $$;

-- PUBLIC first, then anon. `create or replace` keeps the existing grants, but restating them
-- costs nothing and a future `drop`/`create` pair here would otherwise silently hand the
-- function back to PUBLIC (0053).
revoke execute on function resolve_appeal(uuid, text, text) from public;
revoke execute on function resolve_appeal(uuid, text, text) from anon;
grant execute on function resolve_appeal(uuid, text, text) to authenticated;
