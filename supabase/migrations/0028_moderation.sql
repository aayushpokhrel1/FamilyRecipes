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
